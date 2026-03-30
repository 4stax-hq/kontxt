import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, getAllMemories, insertMemory, incrementAccess, findSimilarMemory, supersedeMemory, deleteMemory } from './vault/db.js'
import { embedText, cosineSimilarity, scoreMemory } from './vault/embed.js'
import { extractMemoriesFromTranscript } from '../../core/dist/extractor.js'

type MemoryType = 'preference' | 'fact' | 'project' | 'decision' | 'skill' | 'episodic'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

const server = new McpServer({
  name: 'kontxt',
  version: '0.1.0',
})

function scoreMemories(memories: any[], queryEmbedding: number[], limit: number) {
  return memories
    .map(m => ({
      memory: m,
      score: scoreMemory(
        cosineSimilarity(m.embedding, queryEmbedding),
        m.created_at,
        m.access_count,
        m.importance_score
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

server.registerPrompt(
  'kontxt_context',
  {
    title: 'kontxt Context',
    description: 'Fetches the most relevant memories from your local kontxt vault.',
    argsSchema: ({
      query: z.string().describe('current task or question to find relevant memories for'),
      limit: z.number().optional().describe('max memories to return, default 5'),
      project: z.string().optional().describe('filter to a specific project'),
    } as any),
  },
  async (args: any) => {
    const { query, limit = 5, project } = args
    const db = getDb()
    const { embedding: queryEmbedding, tier: queryTier } = await embedText(query)
    let memories = getAllMemories(db)
    if (project) memories = memories.filter(m => m.project === project)

    const tierMemories = memories.filter(m => m.embedding_tier === queryTier)
    const scored = scoreMemories(tierMemories.length ? tierMemories : memories, queryEmbedding, limit)
    scored.forEach(({ memory }) => incrementAccess(db, memory.id))

    if (scored.length === 0) {
      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: 'No relevant memories found in your kontxt vault.' },
          },
        ],
      }
    }

    const byType: Record<string, string[]> = {}
    for (const { memory } of scored) {
      if (!byType[memory.type]) byType[memory.type] = []
      byType[memory.type].push(memory.content)
    }

    const sections = Object.entries(byType)
      .map(([type, items]) => type.toUpperCase() + ':\n' + items.map(i => '  - ' + i).join('\n'))
      .join('\n\n')

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              'Relevant context from your kontxt memory vault (use this to personalize your response):\n\n' +
              sections +
              '\n\nIf this context is irrelevant, ignore it. Do not mention the memory system unless asked.',
          },
        },
      ],
    }
  }
)

server.tool(
  'get_relevant_context',
  'Retrieve memories from the user vault relevant to the current task. Call this at the start of any conversation or when you need context about the user.',
  ({
    query: z.string().describe('current task or question to find relevant memories for'),
    limit: z.number().optional().describe('max memories to return, default 5'),
    project: z.string().optional().describe('filter to a specific project'),
  } as any),
  async (args: any) => {
    const { query, limit = 5, project } = args
    const db = getDb()
    const { embedding: queryEmbedding, tier: queryTier } = await embedText(query)
    let memories = getAllMemories(db)
    if (project) memories = memories.filter(m => m.project === project)

    const tierMemories = memories.filter(m => m.embedding_tier === queryTier)
    const scored = (tierMemories.length ? tierMemories : memories)
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
  'list_memories',
  'List memories from the kontxt vault (optionally filtered by project).',
  ({
    project: z.string().optional().describe('filter to a specific project'),
    limit: z.number().optional().describe('max results, default 10'),
  } as any),
  async (args: any) => {
    const { project, limit = 10 } = args
    const db = getDb()
    let memories = getAllMemories(db)
    if (project) memories = memories.filter(m => m.project === project)
    const items = memories.slice(0, limit)

    if (items.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No memories found.' }] }
    }

    const text = items
      .map(
        m =>
          `[${m.id.slice(0, 8)}] (${m.type}) ${m.content.replace(/\s+/g, ' ').slice(0, 220)}`
      )
      .join('\n')

    return { content: [{ type: 'text' as const, text: text }] }
  }
)

server.tool(
  'search_memories',
  'Semantic search in the kontxt vault.',
  ({
    query: z.string().describe('query to search for'),
    limit: z.number().optional().describe('max results, default 5'),
    project: z.string().optional().describe('filter to a specific project'),
  } as any),
  async (args: any) => {
    const { query, limit = 5, project } = args
    const db = getDb()
    const { embedding: queryEmbedding, tier: queryTier } = await embedText(query)
    let memories = getAllMemories(db)
    if (project) memories = memories.filter(m => m.project === project)

    const tierMemories = memories.filter(m => m.embedding_tier === queryTier)
    const scored = scoreMemories(tierMemories.length ? tierMemories : memories, queryEmbedding, limit)
    scored.forEach(({ memory }) => incrementAccess(db, memory.id))

    if (scored.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No relevant memories found.' }] }
    }

    const text = scored
      .map(
        ({ memory, score }, i) =>
          `${i + 1}. [${memory.id.slice(0, 8)}] (${memory.type}) score=${score.toFixed(3)}\n${memory.content}`
      )
      .join('\n\n')

    return { content: [{ type: 'text' as const, text: text }] }
  }
)

server.tool(
  'delete_memory',
  'Delete a memory by id (partial id ok).',
  ({
    id: z.string().describe('memory id (partial id ok)'),
  } as any),
  async (args: any) => {
    const { id } = args
    const db = getDb()
    const all = getAllMemories(db)
    const match = all.find(m => m.id.startsWith(id))

    if (!match) {
      return { content: [{ type: 'text' as const, text: `No memory found with id starting: ${id}` }] }
    }

    deleteMemory(db, match.id)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Deleted [${match.id.slice(0, 8)}] ${match.content.slice(0, 180)}`,
        },
      ],
    }
  }
)

server.tool(
  'auto_capture',
  'Extract durable memories from a conversation transcript and store them in your kontxt vault. Best-effort, deduped by embedding similarity.',
  ({
    transcript: z.string().describe('full conversation text (or a large excerpt)'),
    project: z.string().optional().describe('associate extracted memories with a project'),
    limit: z.number().optional().describe('max number of items to store (default 50)'),
  } as any),
  async (args: any) => {
    const { transcript, project, limit = 50 } = args
    const config = getConfig()
    const extracted = await extractMemoriesFromTranscript(transcript, config.openai_api_key)

    const db = getDb()
    let stored = 0
    let updated = 0
    const storedIds: string[] = []

    if (!extracted.length) {
      return { content: [{ type: 'text' as const, text: 'auto_capture: no durable memories found.' }] }
    }

    for (const item of extracted.slice(0, limit)) {
      if (!item.content || !item.type) continue
      try {
        const { embedding, tier } = await embedText(item.content)
        const duplicate = findSimilarMemory(db, embedding, 0.92, tier)

        if (duplicate) {
          const newId = uuid()
          supersedeMemory(db, duplicate.id, newId)

          const now = new Date().toISOString()
          insertMemory(db, {
            id: newId,
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-captured',
            type: item.type as MemoryType,
            embedding,
            embedding_tier: tier,
            tags: [],
            project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.65,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
          updated++
        } else {
          const now = new Date().toISOString()
          const id = uuid()
          insertMemory(db, {
            id,
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-captured',
            type: item.type as MemoryType,
            embedding,
            embedding_tier: tier,
            tags: [],
            project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.65,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
          stored++
          storedIds.push(id)
        }
      } catch {
        // best-effort: ignore failures for a single item
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text:
            'auto_capture: stored ' +
            stored +
            ', updated ' +
            updated +
            '. stored_ids=' +
            storedIds.slice(0, 10).join(', ') +
            (storedIds.length > 10 ? '...' : ''),
        },
      ],
    }
  }
)

server.tool(
  'store_memory',
  'Save an important fact about the user to long-term memory. Use this when the user shares preferences, makes decisions, mentions projects, or reveals skills.',
  ({
    content: z.string().describe('the fact to store, phrased as a statement about the user'),
    type: z.enum(['preference', 'fact', 'project', 'decision', 'skill', 'episodic']),
    project: z.string().optional().describe('associate with a specific project'),
  } as any),
  async (args: any) => {
    const { content, type, project } = args
    const db = getDb()
    const { embedding, tier } = await embedText(content)

    const duplicate = findSimilarMemory(db, embedding, 0.92, tier)
    if (duplicate) {
      const newId = uuid()
      supersedeMemory(db, duplicate.id, newId)

      const now = new Date().toISOString()
      insertMemory(db, {
        id: newId,
        content,
        summary: content.slice(0, 100),
        source: 'ai-captured',
        type: type as MemoryType,
        embedding,
        embedding_tier: tier,
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
        content: [{ type: 'text' as const, text: 'Superseded existing memory: "' + content + '"' }]
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
      embedding_tier: tier,
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
  ({
    transcript: z.string().describe('the full conversation text to extract memories from'),
    project: z.string().optional().describe('associate extracted memories with a project'),
  } as any),
  async (args: any) => {
    const { transcript, project } = args
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
        const { embedding, tier } = await embedText(item.content)
        const duplicate = findSimilarMemory(db, embedding, 0.92, tier)

        if (duplicate) {
          const newId = uuid()
          supersedeMemory(db, duplicate.id, newId)

          const now = new Date().toISOString()
          insertMemory(db, {
            id: newId,
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-extracted',
            type: item.type as MemoryType,
            embedding,
            embedding_tier: tier,
            tags: [],
            project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.6,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
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
            embedding_tier: tier,
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