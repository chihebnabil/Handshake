import { z } from 'zod'

// Minimal OpenRouter chat client with JSON-schema structured output.
// https://openrouter.ai/docs/api-reference/chat-completion

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export const model = () => process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash-1017'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

/** Strict JSON schema mode needs every object closed and every property required. */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue
    out[k] = strictSchema(v)
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false
    out.required = Object.keys(out.properties as object)
  }
  return out
}

export class AIError extends Error {}

export async function structuredChat<T extends z.ZodType>(opts: {
  name: string
  schema: T
  messages: ChatMessage[]
  maxTokens?: number
  hasPdf?: boolean
}): Promise<{ data: z.infer<T>; model: string }> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new AIError('OPENROUTER_API_KEY is not set.')

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'Handshake',
    },
    body: JSON.stringify({
      model: model(),
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 8000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: opts.name, strict: true, schema: strictSchema(z.toJSONSchema(opts.schema)) },
      },
      // Only route to providers that honor the JSON schema.
      provider: { require_parameters: true },
      ...(opts.hasPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] } : {}),
    }),
  })

  const body = (await res.json().catch(() => null)) as {
    model?: string
    error?: { message?: string }
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[]
  } | null

  if (!res.ok || !body || body.error) {
    throw new AIError(`OpenRouter error (${res.status}): ${body?.error?.message ?? res.statusText}`)
  }
  const choice = body.choices?.[0]
  if (choice?.message?.refusal) throw new AIError('The model declined this request.')
  const text = choice?.message?.content
  if (!text) throw new AIError('The model returned an empty response.')

  // Some providers wrap JSON in a code fence despite the schema.
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new AIError('The model returned invalid JSON.')
  }
  const result = opts.schema.safeParse(parsed)
  if (!result.success) throw new AIError('The model response did not match the expected format.')
  return { data: result.data, model: body.model ?? model() }
}
