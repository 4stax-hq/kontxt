const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED_OPENAI_KEY]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_ACCESS_KEY]' },
  { pattern: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\b\s*[:=]\s*["']?[A-Za-z0-9._\-\/+=]{12,}["']?/gi, replacement: '$1=[REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
]

const BLOCK_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

export interface ContentAssessment {
  value: string
  redacted: boolean
  blocked: boolean
  reasons: string[]
}

export function redactSensitiveText(input: string): ContentAssessment {
  let value = input
  let redacted = false
  const reasons: string[] = []

  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    const next = value.replace(pattern, replacement)
    if (next !== value) {
      redacted = true
      reasons.push('redacted sensitive token-like content')
      value = next
    }
  }

  const blocked = BLOCK_PATTERNS.some(pattern => pattern.test(input))
  if (blocked) reasons.push('blocked private key material')

  return { value, redacted, blocked, reasons }
}
