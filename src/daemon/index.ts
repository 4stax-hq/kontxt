import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { getDb } from '../storage/db'
import { loadConfig, ensureKontxtDir } from '../config'
import { processEvent } from '../pipeline/writer'
import { eventBus } from './event-bus'
import { startSession, endSession, getActiveSessionId } from './session'
import { createHttpServer } from '../http/server'
import { SOCKET_PATH, PID_PATH, KONTXT_DIR } from '../constants'
import type { DaemonEvent, RawEvent } from '../types'
import { watchAgentFiles } from './agent-watcher'

interface QueueItem {
  event: RawEvent
  sessionId?: string
}

const queue: QueueItem[] = []
let processing = false

// Agent file watchers per workspace — cleaned up on session_end / shutdown
const agentWatchers = new Map<string, () => void>()

async function drainQueue(db: ReturnType<typeof getDb>, config: ReturnType<typeof loadConfig>): Promise<void> {
  if (processing || queue.length === 0) return
  processing = true
  while (queue.length > 0) {
    const item = queue.shift()!
    try {
      const result = await processEvent(item.event, db, config, item.sessionId)
      console.log(`[daemon] processed: +${result.stored} stored, ${result.merged} merged, ${result.skipped} skipped`)
    } catch (err) {
      console.error('[daemon] error processing event:', err)
    }
  }
  processing = false
}

export async function startDaemon(): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  if (!fs.existsSync(KONTXT_DIR)) {
    fs.mkdirSync(KONTXT_DIR, { recursive: true })
  }

  fs.writeFileSync(PID_PATH, String(process.pid), 'utf-8')

  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH)
  }

  const httpServer = createHttpServer(db, config, eventBus)
  const httpPort = config.daemonPort ?? 7842
  httpServer.listen(httpPort, '127.0.0.1', () => {
    console.log(`[daemon] HTTP server listening on localhost:${httpPort}`)
  })

  const socketServer = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        handleSocketMessage(line, socket, db, config)
      }
    })
    socket.on('error', () => {})
  })

  socketServer.listen(SOCKET_PATH, () => {
    console.log(`[daemon] Unix socket listening at ${SOCKET_PATH}`)
  })

  setInterval(() => drainQueue(db, config), 200)

  // Bootstrap agent watchers for all known workspaces from the DB
  const knownProjects = db.prepare(
    "SELECT workspace_path FROM projects WHERE workspace_path != '' AND workspace_path IS NOT NULL"
  ).all() as Array<{ workspace_path: string }>

  for (const { workspace_path: wp } of knownProjects) {
    if (!agentWatchers.has(wp)) {
      try {
        const stop = watchAgentFiles(wp, (change) => {
          const sessionId = getActiveSessionId(wp)
          const event: RawEvent = {
            text: change.content,
            source: 'agent-file',
            workspacePath: change.workspacePath,
            timestamp: new Date().toISOString(),
          }
          queue.push({ event, sessionId })
          console.log(`[daemon] agent file changed: ${change.filePath} (${change.agent})`)
        })
        agentWatchers.set(wp, stop)
        console.log(`[daemon] watching agent files in ${wp}`)
      } catch {}
    }
  }

  eventBus.onEvent(async (daemonEvent: DaemonEvent) => {
    if (daemonEvent.type === 'raw_event') {
      const event = daemonEvent.payload as RawEvent
      const workspaceKey = event.workspacePath ?? event.projectName ?? 'default'
      const sessionId = getActiveSessionId(workspaceKey)
      queue.push({ event, sessionId })
    } else if (daemonEvent.type === 'session_start') {
      const payload = daemonEvent.payload as { workspacePath: string; projectName?: string }
      const project = payload.projectName ?? path.basename(payload.workspacePath) ?? 'default'
      startSession(db, project, payload.workspacePath)

      // Start watching agent files for this workspace (if not already watching)
      if (payload.workspacePath && !agentWatchers.has(payload.workspacePath)) {
        const stop = watchAgentFiles(payload.workspacePath, (change) => {
          const sessionId = getActiveSessionId(payload.workspacePath)
          const event: RawEvent = {
            text: change.content,
            source: 'agent-file',
            workspacePath: change.workspacePath,
            timestamp: new Date().toISOString(),
          }
          queue.push({ event, sessionId })
          console.log(`[daemon] agent file changed: ${change.filePath} (${change.agent})`)
        })
        agentWatchers.set(payload.workspacePath, stop)
      }
    } else if (daemonEvent.type === 'session_end') {
      const payload = daemonEvent.payload as { workspacePath?: string; projectName?: string }
      const workspaceKey = payload.workspacePath ?? payload.projectName ?? 'default'
      await endSession(db, workspaceKey, config)

      // Stop watching agent files for this workspace
      if (payload.workspacePath) {
        const stop = agentWatchers.get(payload.workspacePath)
        if (stop) { stop(); agentWatchers.delete(payload.workspacePath) }
      }
    } else if (daemonEvent.type === 'shutdown') {
      await shutdown(db, config, socketServer, httpServer)
    }
  })

  process.on('SIGTERM', () => shutdown(db, config, socketServer, httpServer))
  process.on('SIGINT', () => shutdown(db, config, socketServer, httpServer))

  console.log('[daemon] kontxt daemon started')
}

function handleSocketMessage(
  line: string,
  socket: net.Socket,
  db: ReturnType<typeof getDb>,
  config: ReturnType<typeof loadConfig>
): void {
  let parsed: DaemonEvent
  try {
    parsed = JSON.parse(line) as DaemonEvent
  } catch {
    socket.write(JSON.stringify({ ok: false, error: 'Invalid JSON' }) + '\n')
    return
  }

  eventBus.emitEvent(parsed)
  socket.write(JSON.stringify({ ok: true }) + '\n')
}

async function shutdown(
  db: ReturnType<typeof getDb>,
  config: ReturnType<typeof loadConfig>,
  socketServer: net.Server,
  httpServer: import('http').Server
): Promise<void> {
  console.log('[daemon] Shutting down...')

  while (queue.length > 0) {
    await drainQueue(db, config)
    await new Promise(r => setTimeout(r, 100))
  }

  for (const stop of agentWatchers.values()) { try { stop() } catch {} }
  agentWatchers.clear()

  socketServer.close()
  httpServer.close()

  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH)
  if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH)

  process.exit(0)
}
