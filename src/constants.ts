import * as os from 'os'
import * as path from 'path'

export const KONTXT_DIR = path.join(os.homedir(), '.kontxt')
export const DB_PATH = path.join(KONTXT_DIR, 'vault.db')
export const CONFIG_PATH = path.join(KONTXT_DIR, 'config.json')
export const SOCKET_PATH = path.join(KONTXT_DIR, 'daemon.sock')
export const PID_PATH = path.join(KONTXT_DIR, 'daemon.pid')

export const DAEMON_PORT = 7842

export const EXTRACTION_MODEL_ANTHROPIC = 'claude-haiku-4-5'
export const EXTRACTION_MODEL_OPENAI = 'gpt-4o-mini'
export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIM = 1536

export const MIN_CONFIDENCE = 0.7
export const DEDUPE_SKIP_THRESHOLD = 0.90
export const DEDUPE_MERGE_THRESHOLD = 0.75

export const MAX_CONTEXT_TOKENS = 600
export const MAX_INPUT_CHARS = 8000

export const MD_DIR_NAME = '.kontxt'
export const CONTEXT_MD = 'CONTEXT.md'
export const DECISIONS_MD = 'DECISIONS.md'
export const FACTS_MD = 'FACTS.md'
export const TIMELINE_MD = 'TIMELINE.md'
