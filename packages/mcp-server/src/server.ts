import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, getAllMemories, insertMemory, incrementAccess, findSimilarMemory, updateMemoryContent } from './vault/db.js'
import { embedText, cosineSimilarity, scoreMemory } from './vault/embed.js'
import { extractMemoriesFromTranscript } from '@mnemix/core'
import { MemoryType } from '@mnemix/core'

const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

const server = new McpServer({
  name: 'mnemix',
  version: '0.1.0',
})

// Tool 1: get relevant context — smarter, pre-digested
server.tool(
  'get_relevant_context',
  'Retrieve memories from the user vault relevant to the current task. Call this at the start of any conversation or when you need context about the user.',
  {
    query: z.string().describe('current task or question to find relevant memories for'),
    limit: z.number().optional().describe('max memories to return, default 5'),
    project: z.string().optional().describe('filter to a specific project'),
  },
  async ({ query, limit = 5, project }) => {
    const db = getDb()
    const queryEmbedding = await embedText(query)
    let memories = getAllMemories(db)
    if (project) memories = memories.filter(m => m.project === project)

    const scored = memories
      .map(m => ({
        memory: m,
        score: scoreMemory(
          cosineSimilarity(m.embedding, queryEmbedding),
          m.created_at,
          m.access_count,
          m.importance_score
        )
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    scored.forEach(({ memory }) => incrementAccess(db, memory.id))

    if (scored.length === 0) {
      return {
        content: [{ type: 'text', text: 'No relevant memories found. The user has not stored any context yet.' }]
      }
    }

    // group by type for a more useful pre-digested format
    const byType: Record<string, string[]> = {}
    for (const { memory } of scored) {
      if (!byType[memory.type]) byType[memory.type] = []
      byType[memory.type].push(memory.content)
    }

    const sections = Object.entries(byType)
      .map(([type, items]) => {
        const label = type.toUpperCase()
        return label + ':\n' + items.map(i => '  - ' + i).join('\n')
      })
      .join('\n\n')

    return {
      content: [{
        type: 'text',
        text: 'Relevant context from user memory vault:\n\n' + sections + '\n\nUse this to personalize your response. Do not mention that you retrieved this from a memory system unless asked.'
      }]
    }
  }
)

// Tool 2: store a single memory
server.tool(
  'store_memory',
  'Save an important fact about the user to long-term memory. Use this when the user shares preferences, makes decisions, mentions projects, or reveals skills.',
  {
    content: z.string().describe('the fact to store, phrased as a statement about the user'),
    type: z.enum(['preference', 'fact', 'project', 'decision', 'skill', 'episodic']),
    project: z.string().optional().describe('associate with a specific project'),
  },
  async ({ content, type, project }) => {
    const db = getDb()
    const embedding = await embedText(content)

    const duplicate = findSimilarMemory(db, embedding, 0.92)
    if (duplicate) {
      updateMemoryContent(db, duplicate.id, content, embedding)
      return {
        content: [{ type: 'text', text: 'Updated existing memory: "' + content + '"' }]
      }
    }

    const now = new Date().toISOString()
    insertMemory(db, {
      id: uuid(),
      content,
      summary: content.slice( 100),
      source: 'ai-captured',
      type: type as MemoryType,
      embedding,
      tags: [],
      project,
      related_ids: [],
      privacy_level: 'private',
      importance_score: 0.7,
      access_count: 0,
      created_at: now,
      accessed_at: now,
    })

    return {
      content: [{ type: 'text', text: 'Stored: "' + content + '"' }]
    }
  }
)

// Tool 3: auto-extract from full conversation — the key new tool
server.tool(
  'store_conversation_summary',
  'Extract and store durable facts from a full conversation transcript. Call this at the END of every conversation with the complete conversation text.',
  {
    transcript: z.string().describe('the full conversation text to extract memories from'),
    project: z.string().optional().describe('associate extracted memories with a project'),
  },
  async ({ transcript, project }) => {
    const config = getConfig()
    const extracted = await extractMemoriesFromTranscript(transcript, config.openai_api_key)

    if (!extracted.length) {
      return {
        content: [{ type: 'text', text: 'No durable facts found in conversation.' }]
      }
    }

    const db = getDb()
    let stored = 0
    let updated = 0

    for (const item of extracted) {
      if (!item.content || !item.type) continue
      try {
        const embedding = await embedText(item.content)
        const duplicate = findSimilarMemory(db, embedding, 0.92)

        if (duplicate) {
          updateMemoryContent(db, duplicate.id, item.content, embedding)
          updated++
        } else {
          const now = new Date().toISOString()
          insertMemory(db, {
            id: uuid(),
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-extracted',
            type: item.type as MemoryType,
            embedding,
            tags: [],
            project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.6,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
          stored++
        }
      } catch {}
    }

    return {
      content: [{
        type: 'text',
        text: 'Memory update complete: ' + stored + ' new facts stored, ' + updated + ' updated.'
      }]
    }
  }
)

// Tool 4: get user profile
server.tool(
  'get_user_profile',
  'Get a complete summary of everything known about the user — skills, preferences, ongoing projects, decisions.',
  {},
  async () => {
    const db = getDb()
    const memories = getAllMemories(db)

    if (!memories.length) {
      return {
        content: [{ type: 'text', text: 'No profile data yet. The vault is empty.' }]
      }
    }

    const byType: Record<string, string[]> = {}
    memories.forEach(m => {
      if (!byType[m.type]) byType[m.type] = []
      byType[m.type].push(m.content)
    })

    const profile = Object.entries(byType)
      .map(([type, items]) =>
        type.toUpperCase() + ':\n' + items.map(i => '  - ' + i).join('\n')
      )
      .join('\n\n')

    return {
      content: [{ type: 'text', text: profile }]
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
