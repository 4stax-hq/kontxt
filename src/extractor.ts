export interface ExtractedMemory {
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision' | 'skill' | 'episodic'
}
import { redactSensitiveText } from './content-policy.js'

function normalizeStatement(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\-\*\d.)\s]+/, '')
    .trim()
}

function toThirdPerson(statement: string): string {
  return normalizeStatement(statement)
    .replace(/\bI am\b/gi, 'The user is')
    .replace(/\bI\'m\b/gi, 'The user is')
    .replace(/\bI have\b/gi, 'The user has')
    .replace(/\bI\'ve\b/gi, 'The user has')
    .replace(/\bI prefer\b/gi, 'The user prefers')
    .replace(/\bI use\b/gi, 'The user uses')
    .replace(/\bI need\b/gi, 'The user needs')
    .replace(/\bI want\b/gi, 'The user wants')
    .replace(/\bI will\b/gi, 'The user will')
    .replace(/\bI\b/gi, 'The user')
}

function guessType(statement: string): ExtractedMemory['type'] | null {
  if (/\bprefer|like to|usually|tend to|want\b/i.test(statement)) return 'preference'
  if (/\bdecided|decision|going with|chose|choose|settled on\b/i.test(statement)) return 'decision'
  if (/\bworking on|building|launching|shipping|project|repo|package|mvp\b/i.test(statement)) return 'project'
  if (/\bexperienced with|good at|skilled|expert|know\b/i.test(statement)) return 'skill'
  if (/\b(today|yesterday|this week|progress|changed|shipped|fixed|implemented|launched)\b/i.test(statement)) return 'episodic'
  if (statement.length >= 18) return 'fact'
  return null
}

function heuristicExtractMemories(transcript: string): ExtractedMemory[] {
  const rawParts = transcript
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.?!])\s+/))
    .map(part => part.replace(/^(user|human|me|client|developer)\s*:\s*/i, '').trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const out: ExtractedMemory[] = []

  for (const part of rawParts) {
    if (part.length < 12) continue
    if (/^(assistant|claude|gpt|codex)\s*:/i.test(part)) continue
    if (!/\b(i|my|we|our|project|repo|package|timeline|decision|prefer|working on|building|launch)\b/i.test(part)) continue

    const content = toThirdPerson(part)
    const type = guessType(content)
    if (!type) continue

    const key = content.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ content, type })
  }

  return out.slice(0, 25)
}

export async function getOllamaInstructModel(): Promise<string | null> {
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

    const rank = (name: string): number => {
      const n = name.toLowerCase()
      let s = 0
      if (n.includes('instruct') || n.includes('chat') || n.includes(':it')) s += 100
      if (n.includes('70b')) s += 70
      else if (n.includes('32b')) s += 32
      else if (n.includes('13b') || n.includes('14b')) s += 14
      else if (n.includes('8b') || n.includes('9b')) s += 8
      else if (n.includes('7b')) s += 7
      else if (n.includes('3b')) s += 3
      else if (n.includes('1b') || n.includes('1.5b')) s += 1
      if (n.includes('llama3')) s += 10
      else if (n.includes('mistral') || n.includes('mixtral')) s += 9
      else if (n.includes('deepseek')) s += 8
      else if (n.includes('llama')) s += 8
      else if (n.includes('qwen')) s += 7
      else if (n.includes('gemma')) s += 6
      else if (n.includes('phi')) s += 5
      return s
    }

    candidates.sort((a, b) => rank(b) - rank(a))
    return candidates[0]
  } catch { return null }
}

const SYSTEM_PROMPT = `Extract durable facts about the user from this conversation transcript.
Return ONLY a JSON array with no markdown, no explanation, no surrounding text.
Format: [{"content": "user prefers X", "type": "preference"}]
Valid types: preference, fact, project, decision, skill, episodic
Rules:
- Only extract facts that are reusable across future conversations
- Phrase each fact as a third-person statement about the user
- Skip questions, assistant responses, filler, greetings
- Skip anything temporary or session-specific
- Deduplicate: if the same fact appears multiple times, include it once`

export async function extractMemoriesFromTranscript(
  transcript: string,
  openaiApiKey?: string
): Promise<ExtractedMemory[]> {
  const sanitizedTranscript = redactSensitiveText(transcript).value
  if (openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiApiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: sanitizedTranscript.slice(0, 12000) }
          ],
          temperature: 0,
        }),
      })
      if (res.ok) {
        const data = await res.json() as any
        const clean = data.choices[0].message.content.replace(/```json|```/g, '').trim()
        const match = clean.match(/\[[\s\S]*\]/)
        if (match) return JSON.parse(match[0])
      }
    } catch {}
  }

  const model = await getOllamaInstructModel()
  if (!model) return heuristicExtractMemories(transcript)

  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: sanitizedTranscript.slice(0, 6000) }
        ],
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { message: { content: string } }
    const clean = data.message.content.replace(/```json|```/g, '').trim()
    const match = clean.match(/\[[\s\S]*\]/)
    if (!match) return []
    return JSON.parse(match[0])
  } catch {}

  return heuristicExtractMemories(sanitizedTranscript)
}
