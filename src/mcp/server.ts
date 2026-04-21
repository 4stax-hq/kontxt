import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getDb } from '../storage/db'
import { loadConfig } from '../config'
import { ensureKontxtDir } from '../config'
import { toolGetContext, toolRecordEvent, toolQuery } from './tools'
import type { EntryType } from '../types'

const VALID_TYPES = new Set(['decision', 'fact', 'blocker', 'progress', 'focus'])

export async function startMcpServer(): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  const server = new Server(
    { name: 'kontxt', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_context',
        description:
          'Retrieve the current project context. Call this at the start of every session to understand what was previously decided and what is currently in progress.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Optional description of current task for semantic ranking',
            },
            project: {
              type: 'string',
              description: 'Project name (defaults to "default")',
            },
          },
        },
      },
      {
        name: 'record_event',
        description:
          'Record a decision, fact, blocker, or progress note. Call this whenever you make an architectural decision, discover a project fact, identify a blocker, or complete something significant.',
        inputSchema: {
          type: 'object',
          required: ['type', 'content'],
          properties: {
            type: {
              type: 'string',
              enum: ['decision', 'fact', 'blocker', 'progress', 'focus'],
              description: 'Type of entry to record',
            },
            content: {
              type: 'string',
              description: 'The content to record — be specific and include rationale for decisions',
            },
            project: {
              type: 'string',
              description: 'Project name (defaults to "default")',
            },
          },
        },
      },
      {
        name: 'query',
        description:
          'Search your context memory for specific information. Use when you need to look up past decisions or facts about a specific topic.',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query',
            },
            project: {
              type: 'string',
              description: 'Project name (defaults to "default")',
            },
            types: {
              type: 'array',
              items: { type: 'string', enum: ['decision', 'fact', 'blocker', 'progress', 'focus'] },
              description: 'Filter by entry types',
            },
          },
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const safeArgs = (args ?? {}) as Record<string, unknown>

    try {
      let result: string

      if (name === 'get_context') {
        result = await toolGetContext(db, config, {
          task: safeArgs.task as string | undefined,
          project: safeArgs.project as string | undefined,
        })
      } else if (name === 'record_event') {
        const type = safeArgs.type as string
        if (!VALID_TYPES.has(type)) {
          throw new Error(`Invalid type: ${type}`)
        }
        result = await toolRecordEvent(db, config, {
          type: type as EntryType,
          content: safeArgs.content as string,
          project: safeArgs.project as string | undefined,
        })
      } else if (name === 'query') {
        const types = safeArgs.types as EntryType[] | undefined
        result = await toolQuery(db, config, {
          query: safeArgs.query as string,
          project: safeArgs.project as string | undefined,
          types,
        })
      } else {
        throw new Error(`Unknown tool: ${name}`)
      }

      return { content: [{ type: 'text', text: result }] }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
