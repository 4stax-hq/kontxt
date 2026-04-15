import fs from 'fs'
import path from 'path'
import os from 'os'
import { ensurePrivateDir, writePrivateFile } from './security.js'

export interface SessionRecord {
  project_key: string
  project: string
  repo_root?: string
  provider?: string
  last_started_at?: string
  last_ended_at?: string
  last_query?: string
  last_action?: 'inject' | 'ask' | 'skip'
  last_injection_preview?: string
  last_session_summary?: string
}

interface SessionStateFile {
  projects: Record<string, SessionRecord>
}

const STATE_PATH = path.join(os.homedir(), '.kontxt', 'session-state.json')

function defaultState(): SessionStateFile {
  return { projects: {} }
}

function ensureStateDir() {
  ensurePrivateDir(path.dirname(STATE_PATH))
}

export function readSessionState(): SessionStateFile {
  try {
    if (!fs.existsSync(STATE_PATH)) return defaultState()
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as SessionStateFile
    return parsed && parsed.projects ? parsed : defaultState()
  } catch {
    return defaultState()
  }
}

export function writeSessionState(state: SessionStateFile) {
  ensureStateDir()
  writePrivateFile(STATE_PATH, JSON.stringify(state, null, 2))
}

export function getProjectKey(repoRoot?: string, project?: string): string {
  if (repoRoot) return path.resolve(repoRoot)
  return (project || 'default').trim().toLowerCase()
}

export function getSessionRecord(repoRoot?: string, project?: string): SessionRecord | null {
  const state = readSessionState()
  const key = getProjectKey(repoRoot, project)
  return state.projects[key] || null
}

export function upsertSessionRecord(
  partial: Omit<SessionRecord, 'project_key'> & { project_key?: string }
): SessionRecord {
  const state = readSessionState()
  const key = partial.project_key || getProjectKey(partial.repo_root, partial.project)
  const next: SessionRecord = {
    ...(state.projects[key] || { project_key: key, project: partial.project }),
    ...partial,
    project_key: key,
  }
  state.projects[key] = next
  writeSessionState(state)
  return next
}
