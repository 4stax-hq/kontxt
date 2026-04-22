import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_PATH, KONTXT_DIR, DAEMON_PORT, EXTRACTION_MODEL_ANTHROPIC, EMBEDDING_MODEL, MAX_CONTEXT_TOKENS } from './constants'

export interface Config {
  anthropicKey?: string
  openaiKey?: string
  extractionModel?: string
  embeddingModel?: string
  daemonPort?: number
  autoInjectOnOpen?: boolean
  maxContextTokens?: number
  // Auto-refresh controls
  autoRefresh?: boolean            // watch for file changes and extract automatically
  autoRefreshQuietMinutes?: number // minutes of no changes before firing (default 5)
  autoRefreshCooldownMinutes?: number // min minutes between auto calls (default 30)
  autoRefreshMinScore?: number     // min significance score to trigger (default 4)
}

const DEFAULTS: Required<Config> = {
  anthropicKey: '',
  openaiKey: '',
  extractionModel: EXTRACTION_MODEL_ANTHROPIC,
  embeddingModel: EMBEDDING_MODEL,
  daemonPort: DAEMON_PORT,
  autoInjectOnOpen: true,
  maxContextTokens: MAX_CONTEXT_TOKENS,
  autoRefresh: true,
  autoRefreshQuietMinutes: 5,
  autoRefreshCooldownMinutes: 30,
  autoRefreshMinScore: 4,
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(KONTXT_DIR)) {
    fs.mkdirSync(KONTXT_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function setConfigKey(key: string, value: string): void {
  const config = loadConfig()
  const keyMap: Record<string, keyof Config> = {
    'anthropic-key': 'anthropicKey',
    'openai-key': 'openaiKey',
    'extraction-model': 'extractionModel',
    'embedding-model': 'embeddingModel',
    'daemon-port': 'daemonPort',
    'auto-inject': 'autoInjectOnOpen',
    'max-tokens': 'maxContextTokens',
    'auto-refresh': 'autoRefresh',
    'auto-refresh-quiet-minutes': 'autoRefreshQuietMinutes',
    'auto-refresh-cooldown-minutes': 'autoRefreshCooldownMinutes',
    'auto-refresh-min-score': 'autoRefreshMinScore',
  }
  const configKey = keyMap[key]
  if (!configKey) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(keyMap).join(', ')}`)
  }
  const numKeys = new Set<keyof Config>(['daemonPort', 'maxContextTokens', 'autoRefreshQuietMinutes', 'autoRefreshCooldownMinutes', 'autoRefreshMinScore'])
  const boolKeys = new Set<keyof Config>(['autoInjectOnOpen', 'autoRefresh'])
  if (numKeys.has(configKey)) {
    ;(config as Record<string, unknown>)[configKey] = parseInt(value, 10)
  } else if (boolKeys.has(configKey)) {
    ;(config as Record<string, unknown>)[configKey] = value === 'true'
  } else {
    ;(config as Record<string, unknown>)[configKey] = value
  }
  saveConfig(config)
}

export function ensureKontxtDir(): void {
  if (!fs.existsSync(KONTXT_DIR)) {
    fs.mkdirSync(KONTXT_DIR, { recursive: true })
    console.log(`Created kontxt directory at ${KONTXT_DIR}`)
    console.log('Set your API keys to enable extraction:')
    console.log('  kontxt config set anthropic-key <your-key>')
    console.log('  kontxt config set openai-key <your-key>')
  }
}
