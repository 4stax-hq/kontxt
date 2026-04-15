import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MemoryType } from '../../types.js'
import { storeExtractedMemories } from '../../capture-store.js'
import { redactSensitiveText } from '../../content-policy.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

interface ExtractedMemory {
  content: string
  type: MemoryType
}

async function getOllamaModel(): Promise<string | null> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    })
    if (!res.ok) return null
    const data = await res.json() as { models: { name: string }[] }
    const models = data.models.map(m => m.name)
    if (!models.length) return null

    const embeddingPatterns = ['embed', 'minilm', 'e5-', 'bge-']
    const candidates = models.filter(m =>
      !embeddingPatterns.some(p => m.toLowerCase().includes(p))
    )
    if (!candidates.length) return null

    const rankModel = (name: string): number => {
      const n = name.toLowerCase()
      let score = 0
      if (n.includes('instruct') || n.includes('chat') || n.includes(':it')) score += 100
      if (n.includes('70b')) score += 70
      else if (n.includes('32b')) score += 32
      else if (n.includes('13b') || n.includes('14b')) score += 14
      else if (n.includes('8b') || n.includes('9b')) score += 8
      else if (n.includes('7b')) score += 7
      else if (n.includes('3b')) score += 3
      else if (n.includes('1b') || n.includes('1.5b')) score += 1
      if (n.includes('llama3')) score += 10
      else if (n.includes('mistral') || n.includes('mixtral')) score += 9
      else if (n.includes('deepseek')) score += 8
      else if (n.includes('llama')) score += 8
      else if (n.includes('qwen')) score += 7
      else if (n.includes('gemma')) score += 6
      else if (n.includes('phi')) score += 5
      return score
    }

    candidates.sort((a, b) => rankModel(b) - rankModel(a))
    return candidates[0]
  } catch { return null }
}

async function extractWithOllama(transcript: string, model: string): Promise<ExtractedMemory[]> {
  const sanitizedTranscript = redactSensitiveText(transcript).value
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'system',
          content: 'Extract durable facts about the user from conversation transcripts. Return ONLY a JSON array with no markdown, no explanation. Format: [{"content": "user prefers X", "type": "preference"}]. Valid types: preference, fact, project, decision, skill, episodic. Only reusable facts, skip filler and questions.'
        },
        {
          role: 'user',
          content: sanitizedTranscript.slice(0, 6000)
        }
      ],
    }),
  })

  if (!res.ok) throw new Error('Ollama chat failed: ' + res.status)
  const data = await res.json() as { message: { content: string } }
  const clean = data.message.content.replace(/```json|```/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('no JSON array in response')
  return JSON.parse(match[0])
}

async function extractWithOpenAI(transcript: string, apiKey: string): Promise<ExtractedMemory[]> {
  const sanitizedTranscript = redactSensitiveText(transcript).value
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract durable facts about the user from conversation transcripts. Return ONLY a JSON array: [{"content": "...", "type": "preference|fact|project|decision|skill|episodic"}]. No markdown, no explanation. Only reusable facts.'
        },
        { role: 'user', content: sanitizedTranscript.slice(0, 12000) }
      ],
      temperature: 0,
    }),
  })

  if (!res.ok) throw new Error('OpenAI extraction failed')
  const data = await res.json() as any
  const clean = data.choices[0].message.content.replace(/```json|```/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('no JSON array in response')
  return JSON.parse(match[0])
}

export async function extractCommand(options: { file?: string; project?: string }) {
  let transcript = ''

  if (options.file) {
    if (!fs.existsSync(options.file)) {
      console.log(chalk.red('file not found: ' + options.file))
      return
    }
    transcript = fs.readFileSync(options.file, 'utf-8')
  } else {
    transcript = fs.readFileSync('/dev/stdin', 'utf-8')
  }

  if (!transcript.trim()) {
    console.log(chalk.red('no transcript provided'))
        console.log(chalk.gray('  cat conversation.txt | kontxt extract'))
        console.log(chalk.gray('  kontxt extract --file conversation.txt'))
    return
  }

  const spinner = ora('detecting available backends...').start()

  try {
    const config = getConfig()
    let extracted: ExtractedMemory[] = []
    let source = ''

    if (config.openai_api_key) {
      try {
        spinner.text = 'extracting via OpenAI...'
        extracted = await extractWithOpenAI(transcript, config.openai_api_key)
        source = 'gpt-4o-mini'
      } catch {
        spinner.text = 'OpenAI failed, checking Ollama...'
      }
    }

    if (!extracted.length) {
      const model = await getOllamaModel()
      if (!model) {
        spinner.fail(chalk.red('no extraction backend available'))
        console.log(chalk.gray('  1. ollama pull llama3.2'))
        console.log(chalk.gray('  2. kontxt init --key sk-...'))
        return
      }
      spinner.text = 'extracting via ' + model + '...'
      extracted = await extractWithOllama(transcript, model)
      source = model
    }

    spinner.stop()

    if (!extracted.length) {
      console.log(chalk.yellow('no durable facts found in transcript'))
      return
    }

    console.log(chalk.cyan('found ' + extracted.length + ' facts via ' + source + ' — storing...'))
    const { stored, updated, skipped, items } = await storeExtractedMemories(extracted, {
      project: options.project,
      source: 'extracted',
      importanceScore: 0.7,
    })
    items.forEach(item => console.log(chalk.gray('  · [' + item.type + '] ' + item.content.slice(0, 70))))

    console.log(chalk.cyan('done: ' + stored + ' stored, ' + updated + ' updated, ' + skipped + ' skipped'))

  } catch (err: any) {
    spinner.fail(chalk.red('extraction failed: ' + err.message))
  }
}
