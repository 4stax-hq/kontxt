export type MemoryType =
  | 'preference'
  | 'fact'
  | 'project'
  | 'decision'
  | 'skill'
  | 'episodic'

export type PrivacyLevel = 'private' | 'anonymizable' | 'shareable'

export interface Memory {
  id: string
  content: string
  summary: string
  source: string
  type: MemoryType
  embedding: number[]
  tags: string[]
  project?: string
  related_ids: string[]
  privacy_level: PrivacyLevel
  importance_score: number
  access_count: number
  created_at: string
  accessed_at: string
}

export interface SearchResult {
  memory: Memory
  score: number
}
