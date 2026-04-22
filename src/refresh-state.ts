import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const STATE_FILE = path.join(os.homedir(), '.kontxt', 'refresh-state.json')

export interface WorkspaceRefreshState {
  lastFire?: number
  lastAttempt?: number
  lastSuccess?: number
  lastOutcome?: 'success' | 'no_change' | 'skipped' | 'error'
  lastError?: string
}

interface RefreshStateFile {
  workspaces: Record<string, number | WorkspaceRefreshState>
}

export function getWorkspaceRefreshState(workspacePath: string): WorkspaceRefreshState {
  const raw = readState().workspaces[workspacePath]
  if (typeof raw === 'number') {
    return { lastFire: raw, lastSuccess: raw, lastOutcome: 'success' }
  }
  return raw ?? {}
}

export function getLastAutoRefresh(workspacePath: string): number {
  const state = getWorkspaceRefreshState(workspacePath)
  return state.lastFire ?? state.lastSuccess ?? 0
}

export function markRefreshTriggered(workspacePath: string): void {
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastFire = Date.now()
  writeWorkspaceState(workspacePath, state)
}

export function markRefreshAttempt(workspacePath: string): void {
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastAttempt = Date.now()
  writeWorkspaceState(workspacePath, state)
}

export function markRefreshSuccess(workspacePath: string): void {
  const now = Date.now()
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastSuccess = now
  state.lastOutcome = 'success'
  state.lastError = undefined
  writeWorkspaceState(workspacePath, state)
}

export function markRefreshNoChange(workspacePath: string): void {
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastOutcome = 'no_change'
  state.lastError = undefined
  writeWorkspaceState(workspacePath, state)
}

export function markRefreshSkipped(workspacePath: string): void {
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastOutcome = 'skipped'
  state.lastError = undefined
  writeWorkspaceState(workspacePath, state)
}

export function markRefreshError(workspacePath: string, error: unknown): void {
  const state = getWorkspaceRefreshState(workspacePath)
  state.lastOutcome = 'error'
  state.lastError = normalizeError(error)
  writeWorkspaceState(workspacePath, state)
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 240 ? message.slice(0, 237) + '...' : message
}

function readState(): RefreshStateFile {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as RefreshStateFile
  } catch {
    return { workspaces: {} }
  }
}

function writeWorkspaceState(workspacePath: string, state: WorkspaceRefreshState): void {
  try {
    const file = readState()
    file.workspaces[workspacePath] = state
    fs.writeFileSync(STATE_FILE, JSON.stringify(file, null, 2), 'utf-8')
  } catch {}
}
