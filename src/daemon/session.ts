import { v4 as uuidv4 } from 'uuid'
import type { Database } from '../storage/db'
import { insertSession, updateSessionEnd, getAllActiveEntries } from '../storage/db'
import type { Config } from '../config'
import type { Session } from '../types'

const activeSessions = new Map<string, { session: Session; entryCount: number }>()

export function startSession(
  db: Database.Database,
  project: string,
  workspacePath?: string
): string {
  void workspacePath
  const id = uuidv4()
  const now = new Date().toISOString()
  const session: Session = {
    id,
    project,
    startedAt: now,
    endedAt: null,
    summary: null,
    entryCount: 0,
  }
  insertSession(db, session)
  activeSessions.set(workspacePath ?? project, { session, entryCount: 0 })
  return id
}

export function incrementSessionEntries(workspaceKey: string): void {
  const active = activeSessions.get(workspaceKey)
  if (active) {
    active.entryCount++
  }
}

export async function endSession(
  db: Database.Database,
  workspaceKey: string,
  config: Config
): Promise<void> {
  const active = activeSessions.get(workspaceKey)
  if (!active) return

  const { session, entryCount } = active
  activeSessions.delete(workspaceKey)

  const summary = await generateSessionSummary(db, session.project, session.id, config)
  const now = new Date().toISOString()
  updateSessionEnd(db, session.id, now, summary, entryCount)
}

async function generateSessionSummary(
  db: Database.Database,
  project: string,
  sessionId: string,
  config: Config
): Promise<string | null> {
  const sessionEntries = db.prepare(`
    SELECT content, type FROM entries WHERE session_id = ? ORDER BY created_at ASC
  `).all(sessionId) as Array<{ content: string; type: string }>

  if (sessionEntries.length === 0) return null

  const entryText = sessionEntries
    .map(e => `[${e.type}] ${e.content}`)
    .join('\n')

  const prompt = `Summarize this development session in 2-3 sentences. Focus on what was accomplished, what was decided, and what problems were encountered. Be specific.\n\nEntries:\n${entryText}`

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: config.extractionModel ?? 'claude-3-haiku-20240307',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      })
      const content = response.content[0]
      if (content.type === 'text') return content.text
    } catch (err) {
      console.error('[session] Failed to generate summary:', err)
    }
  }

  if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
      })
      return response.choices[0]?.message?.content ?? null
    } catch (err) {
      console.error('[session] Failed to generate summary (OpenAI):', err)
    }
  }

  return `Session captured ${sessionEntries.length} entries for project ${project}.`
}

export function getActiveSessionId(workspaceKey: string): string | undefined {
  return activeSessions.get(workspaceKey)?.session.id
}
