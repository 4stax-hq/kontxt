import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, getAllMemories, insertMemory, incrementAccess, findSimilarMemory, updateMemoryContent } from './vault/db.js'
import { embedText, cosineSimilarity, scoreMemory } from './vault/embed.js'
import { extractMemoriesFromTranscript } from '../../core/src/extractor.js'

type MemoryType = 'preference' | 'fact' | 'project' | 'decision' | 'skill' | 'episodic'

const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

const server = new McpServer({
  name: 'mnemix',
  version: '0.1.0',
})

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
        content: [{ type: 'text' as const, text: 'No relevant memories found.' }]
      }
    }

    const byType: Record<string, string[]> = {}
    for (const { memory } of scored) {
      if (!byType[memory.type]) byType[memory.type] = []
      byType[memory.type].push(memory.content)
    }

    const sections = Object.entries(byType)
      .map(([type, items]) =>
        type.toUpperCase() + ':\n' + items.map(i => '  - ' + i).join('\n')
      )
      .join('\n\n')

    return {
      content: [{
        type: 'text' as const,
        text: 'Relevant context from user memory vault:\n\n' + sections + '\n\nUse this to personalize your response. Do not mention the memory system unless asked.'
      }]
    }
  }
)

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
        content: [{ type: 'text' as const, text: 'Updated existing memory: "' + content + '"' }]
      }
    }

    const now = new Date().toISOString()
    insertMemory(db, {
      id: uuid(),
      content,
      summary: content.slice(0, 100),
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
      content: [{ type: 'text' as const, text: 'Stored: "' + content + '"' }]
    }
  }
)

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
        content: [{ type: 'text' as const, text: 'No durable facts found in conversation.' }]
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
        type: 'text' as const,
        text: 'Memory update complete: ' + stored + ' new facts stored, ' + updated + ' updated.'
      }]
    }
  }
)

server.tool(
  'get_user_profile',
  'Get a complete summary of everything known about the user — skills, preferences, ongoing projects, decisions.',
  {},
  async () => {
    const db = getDb()
    const memories = getAllMemories(db)

    if (!memories.length) {
      return {
        content: [{ type: 'text' as const, text: 'No profile data yet. The vault is empty.' }]
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
      content: [{ type: 'text' as const, text: profile }]
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)