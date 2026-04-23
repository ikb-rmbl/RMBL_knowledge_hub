/**
 * Shared Claude API client with retry logic and JSON response parsing.
 *
 * Consolidates the identical API call + retry + JSON parse patterns
 * used across experiment-extraction.ts, extract-dataset-entities.ts,
 * extract-document-entities.ts, and extract-longform-entities.ts.
 */

import { sleep } from './concurrency.js'

const MAX_RETRIES = 3
const SONNET_INPUT_COST = 3   // $ per million tokens
const SONNET_OUTPUT_COST = 15 // $ per million tokens

export interface ClaudeResponse {
  text: string
  inputTokens: number
  outputTokens: number
  cost: number
}

/**
 * Call the Claude Messages API with automatic retry on transient errors (429, 529, 5xx).
 */
export async function callClaude(options: {
  apiKey: string
  model?: string
  maxTokens?: number
  messages: { role: string; content: any }[]
}): Promise<ClaudeResponse> {
  const model = options.model || 'claude-sonnet-4-6'
  const maxTokens = options.maxTokens || 4096

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: options.messages }),
    })

    if (res.status === 529 || res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt < MAX_RETRIES) {
        const backoff = 30 + attempt * 30
        console.log(`    Retrying (${attempt + 1}/${MAX_RETRIES}) after ${backoff}s — ${res.status} error`)
        await sleep(backoff * 1000)
        continue
      }
      const errText = await res.text()
      throw new Error(`Claude API ${res.status} after ${MAX_RETRIES} retries: ${errText.slice(0, 200)}`)
    }

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`)
    }

    const data = await res.json()
    const inputTokens = data.usage?.input_tokens || 0
    const outputTokens = data.usage?.output_tokens || 0

    return {
      text: data.content?.[0]?.text || '',
      inputTokens,
      outputTokens,
      cost: (inputTokens * SONNET_INPUT_COST + outputTokens * SONNET_OUTPUT_COST) / 1_000_000,
    }
  }

  throw new Error('Unreachable')
}

/**
 * Parse a JSON object or array from Claude's text response.
 * Handles markdown code fences, leading/trailing text, and truncated JSON.
 */
export function parseJsonResponse<T = any>(text: string): T | null {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  // Try direct parse
  try { return JSON.parse(cleaned) } catch {}

  // Find outermost JSON object
  const objStart = cleaned.indexOf('{')
  const objEnd = cleaned.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(cleaned.slice(objStart, objEnd + 1)) } catch {}
  }

  // Find outermost JSON array
  const arrStart = cleaned.indexOf('[')
  const arrEnd = cleaned.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) } catch {}
  }

  return null
}

/**
 * Call Claude and parse JSON from the response in one step.
 */
export async function callClaudeJson<T = any>(options: {
  apiKey: string
  prompt: string
  content: string
  model?: string
  maxTokens?: number
}): Promise<{ data: T | null; response: ClaudeResponse }> {
  const response = await callClaude({
    apiKey: options.apiKey,
    model: options.model,
    maxTokens: options.maxTokens,
    messages: [{ role: 'user', content: `${options.prompt}\n\n${options.content}` }],
  })
  const data = parseJsonResponse<T>(response.text)
  return { data, response }
}
