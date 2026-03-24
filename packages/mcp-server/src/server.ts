import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getDb, getAllMemories, insertMemory, incrementAccess } from './vault/db.js'
import { embedText, cosineSimilarity, scoreMemory } from './vault/embed.js'
import { v4 as uuid } from 'uuid'
import { MemoryType } from '@mnemix/core'

const server = new McpServer({
  name: 'mnemix',
  version: '0.1.0',
})

// Tool 1: get relevant context
server.tool(
  'get_relevant_context',
  'Retrieve memories from the user vault relevant to the current task',
  {
    query: z.string().describe('current task or prompt to find relevant memories for'),
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

    const context = scored
      .map(({ memory, score }) =>
        `[${memory.type}] ${memory.content} (relevance: ${score.toFixed(2)})`
      )
      .join('\n')

    return {
      content: [{
        type: 'text',
        text: scored.length > 0
          ? `Relevant context from user memory:\n\n${context}`
          : 'No relevant memories found.'
      }]
    }
  }
)

// Tool 2: store a memory
server.tool(
  'store_memory',
  'Save something important about the user to long-term memory',
  {
    content: z.string().describe('the memory to store'),
    type: z.enum(['preference', 'fact', 'project', 'decision', 'skill', 'episodic'])
           .describe('type of memory'),
    project: z.string().optional().describe('associate with a project'),
  },
  async ({ content, type, project }) => {
    const db = getDb()
    const embedding = await embedText(content)
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
      content: [{ type: 'text', text: `Memory stored: "${content}"` }]
    }
  }
)

// Tool 3: get user profile
server.tool(
  'get_user_profile',
  'Get a summary of what is known about the user — skills, preferences, projects',
  {},
  async () => {
    const db = getDb()
    const memories = getAllMemories(db)

    const byType: Record<string, string[]> = {}
    memories.forEach(m => {
      if (!byType[m.type]) byType[m.type] = []
      byType[m.type].push(m.content)
    })

    const profile = Object.entries(byType)
      .map(([type, items]) => `${type.toUpperCase()}:\n${items.map(i => `  - ${i}`).join('\n')}`)
      .join('\n\n')

    return {
      content: [{
        type: 'text',
        text: profile || 'No profile data yet.'
      }]
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
