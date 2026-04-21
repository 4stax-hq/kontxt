import type * as http from 'http'
import type { Database } from '../storage/db'
import { buildContextPacket, formatContextPacket } from '../retrieval/engine'
import type { Config } from '../config'
import type { DaemonEvent, RawEvent } from '../types'

export function handleRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: Database.Database,
  config: Config,
  bus: { emitEvent(e: DaemonEvent): boolean }
): void {
  const url = new URL(req.url ?? '/', `http://localhost`)

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/ingest') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { text?: string; source?: string; workspacePath?: string }
        if (!parsed.text) {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, error: 'Missing text field' }))
          return
        }
        const event: RawEvent = {
          text: parsed.text,
          source: (parsed.source as RawEvent['source']) ?? 'browser',
          workspacePath: parsed.workspacePath,
          timestamp: new Date().toISOString(),
        }
        const daemonEvent: DaemonEvent = { type: 'raw_event', payload: event }
        bus.emitEvent(daemonEvent)
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }))
      }
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200)
    res.end(JSON.stringify({
      running: true,
      lastActivity: new Date().toISOString(),
    }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/context') {
    const project = url.searchParams.get('project') ?? 'default'
    buildContextPacket(db, project, '', config).then(packet => {
      const formatted = formatContextPacket(packet)
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, context: formatted }))
    }).catch(err => {
      res.writeHead(500)
      res.end(JSON.stringify({ ok: false, error: String(err) }))
    })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
}
