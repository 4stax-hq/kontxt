export type EntryType = 'decision' | 'fact' | 'blocker' | 'progress' | 'focus'
export type SourceSurface = 'vscode' | 'cursor' | 'browser' | 'cli' | 'ingest' | 'mcp'
export type EntryScope = 'project' | 'global'
export type DedupeAction = 'insert' | 'merge' | 'skip'

export interface RawEvent {
  text: string
  source: SourceSurface
  workspacePath?: string
  projectName?: string
  timestamp: string
}

export interface ExtractedItem {
  type: EntryType
  content: string
  confidence: number
}

export interface Entry {
  id: string
  content: string
  type: EntryType
  project: string
  scope: EntryScope
  sourceSurface: SourceSurface
  sessionId: string | null
  confidence: number
  embedding: Float32Array | null
  supersededBy: string | null
  versionCount: number
  createdAt: string
  updatedAt: string
  accessCount: number
}

export interface Session {
  id: string
  project: string
  startedAt: string
  endedAt: string | null
  summary: string | null
  entryCount: number
}

export interface Project {
  id: string
  name: string
  workspacePath: string
  currentFocus: string | null
  createdAt: string
  lastActiveAt: string
}

export interface ContextPacket {
  project: string
  focus: string | null
  blockers: string[]
  recentDecisions: string[]
  relevantFacts: string[]
  lastSessionSummary: string | null
  tokenEstimate: number
}

export interface DaemonEvent {
  type: 'raw_event' | 'session_start' | 'session_end' | 'shutdown'
  payload: RawEvent | { workspacePath: string; projectName?: string } | Record<string, never>
}
