import * as fs from 'fs'
import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { processEvent } from '../../pipeline/writer'
import type { RawEvent } from '../../types'

export async function ingestCommand(filePath?: string, workspacePath?: string): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  let text: string
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`)
      process.exit(1)
    }
    text = fs.readFileSync(filePath, 'utf-8')
  } else {
    text = fs.readFileSync('/dev/stdin', 'utf-8')
  }

  if (!text.trim()) {
    console.error('No text to ingest')
    process.exit(1)
  }

  const event: RawEvent = {
    text,
    source: 'ingest',
    workspacePath: workspacePath ?? process.cwd(),
    timestamp: new Date().toISOString(),
  }

  console.log('Extracting knowledge...')
  const result = await processEvent(event, db, config)
  console.log(`Done: ${result.stored} stored, ${result.merged} merged, ${result.skipped} skipped`)
}
