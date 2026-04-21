import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { test, before, after } from 'node:test'
import { getDb } from '../storage/db'
import { processEvent } from '../pipeline/writer'
import { buildContextPacket } from '../retrieval/engine'
import type { Config } from '../config'
import type { RawEvent } from '../types'

const SAMPLE_CONVERSATION = `
Developer: I've been thinking about the API layer. We have too many round trips with REST because of the nested data shapes in the dashboard.
AI: You could consider switching to tRPC — it collapses those round trips and gives you end-to-end type safety.
Developer: Let's do it. We'll switch from REST to tRPC for the internal API. The nested data shapes are the key reason.
AI: Good call. What about auth?
Developer: We're going with Supabase for auth. JWT secret is in the environment as SUPABASE_JWT_SECRET. Auth service runs on port 3001.
AI: Got it. Any other considerations?
Developer: Yes — I'm hitting a wall with Prisma. It won't generate the correct type for our self-referential user-manager relation. The generated types are wrong and I can't figure out how to override them.
AI: That's a known Prisma limitation. You might need to use raw SQL for that relation or manually patch the generated types.
Developer: Still unresolved. Also, I finished the profile endpoint today — all 14 tests are passing now.
`

let tmpDir: string
let dbPath: string

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kontxt-test-'))
  dbPath = path.join(tmpDir, 'test.db')
})

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('core loop: processEvent extracts and stores entries', async () => {
  const db = getDb(dbPath)
  const config: Config = {
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
  }

  if (!config.anthropicKey && !config.openaiKey) {
    console.log('Skipping extraction test — no API keys set (set ANTHROPIC_API_KEY or OPENAI_API_KEY)')
    return
  }

  const event: RawEvent = {
    text: SAMPLE_CONVERSATION,
    source: 'ingest',
    workspacePath: tmpDir,
    projectName: 'test-project',
    timestamp: new Date().toISOString(),
  }

  const result = await processEvent(event, db, config)

  assert.ok(result.stored >= 1, `Expected at least 1 stored entry, got ${result.stored}`)
  console.log(`Stored: ${result.stored}, Merged: ${result.merged}, Skipped: ${result.skipped}`)

  const decisionsPath = path.join(tmpDir, '.kontxt', 'DECISIONS.md')
  const factsPath = path.join(tmpDir, '.kontxt', 'FACTS.md')
  const contextPath = path.join(tmpDir, '.kontxt', 'CONTEXT.md')

  assert.ok(fs.existsSync(decisionsPath), 'DECISIONS.md should exist')
  assert.ok(fs.existsSync(factsPath), 'FACTS.md should exist')
  assert.ok(fs.existsSync(contextPath), 'CONTEXT.md should exist')

  const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8').toLowerCase()
  const factsContent = fs.readFileSync(factsPath, 'utf-8').toLowerCase()
  const contextContent = fs.readFileSync(contextPath, 'utf-8').toLowerCase()

  assert.ok(
    decisionsContent.includes('trpc') || decisionsContent.includes('rest'),
    `DECISIONS.md should mention tRPC decision. Content:\n${decisionsContent}`
  )

  assert.ok(
    factsContent.includes('supabase') || factsContent.includes('3001') || factsContent.includes('jwt'),
    `FACTS.md should contain Supabase fact. Content:\n${factsContent}`
  )

  assert.ok(
    contextContent.includes('prisma') || contextContent.includes('blocker'),
    `CONTEXT.md should mention Prisma blocker. Content:\n${contextContent}`
  )
})

test('core loop: buildContextPacket returns blockers', async () => {
  const db = getDb(dbPath)
  const config: Config = {
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
  }

  if (!config.anthropicKey && !config.openaiKey) {
    console.log('Skipping context packet test — no API keys set')
    return
  }

  const packet = await buildContextPacket(db, 'test-project', '', config)

  assert.strictEqual(packet.project, 'test-project')
  assert.ok(Array.isArray(packet.blockers), 'blockers should be an array')
  assert.ok(Array.isArray(packet.recentDecisions), 'recentDecisions should be an array')
  assert.ok(Array.isArray(packet.relevantFacts), 'relevantFacts should be an array')

  const allContent = [
    ...packet.blockers,
    ...packet.recentDecisions,
    ...packet.relevantFacts,
    packet.focus ?? '',
  ].join(' ').toLowerCase()

  console.log('Context packet:', JSON.stringify(packet, null, 2))

  assert.ok(packet.tokenEstimate > 0, 'Token estimate should be positive')
  assert.ok(packet.tokenEstimate <= (config.maxContextTokens ?? 600) + 50, 'Token estimate should be within budget')
})
