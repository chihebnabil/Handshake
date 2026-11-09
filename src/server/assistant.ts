import { createServerFn } from '@tanstack/react-start'
import { getRequestIP } from '@tanstack/react-start/server'
import { z } from 'zod'

// One turn of the Insights assistant (AG Studio's Agent Framework). The browser runs Studio's agent loop
// and its tools; this only forwards a turn to OpenRouter so the API key stays on the server.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_REQUEST_CHARS = 400_000
const MAX_TOKENS = 4000

// Public demo: keep a visitor from draining the credit. Per server instance, which is enough here.
const WINDOW_MS = 10 * 60_000
const PER_VISITOR = 120 // one question is ~10-20 turns, so about 6 questions per 10 minutes
const PER_INSTANCE = 600
const PER_DAY = 3000 // about $5 a day at most per server instance with the default model
const seen = new Map<string, number[]>()
let instance: number[] = []
let day = { start: Date.now(), count: 0 }

// Studio's agents call tools in many short turns, so a fast model that is good at tool use matters more
// here than for the delivery reviews.
const agentModel = () => process.env.OPENROUTER_AGENT_MODEL || 'anthropic/claude-haiku-5.5'

function allow(ip: string) {
  const now = Date.now()
  if (now - day.start > 24 * 3600_000) day = { start: now, count: 0 }
  if (day.count >= PER_DAY) return false
  instance = instance.filter((t) => now - t < WINDOW_MS)
  const mine = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (mine.length >= PER_VISITOR || instance.length >= PER_INSTANCE) return false
  mine.push(now)
  instance.push(now)
  day.count++
  seen.set(ip, mine)
  if (seen.size > 5000) seen.clear()
  return true
}

const Input = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).max(200),
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.unknown() })).max(100),
  toolChoice: z.union([z.enum(['auto', 'none', 'required']), z.object({ name: z.string() })]).optional(),
  json: z.object({ name: z.string(), schema: z.unknown() }).nullable(),
})

export type AssistantTurn = {
  ok: boolean
  error?: string
  id: string
  model: string
  text: string
  toolCalls: { id: string; name: string; arguments: string }[]
  truncated: boolean
  usage?: { inputTokens: number; outputTokens: number }
}

export const assistantTurnFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<AssistantTurn> => {
    const fail = (error: string): AssistantTurn => ({ ok: false, error, id: '', model: '', text: '', toolCalls: [], truncated: false })
    if (process.env.DEMO_MODE === 'false') return fail('The assistant is turned off on this server.')
    const key = process.env.OPENROUTER_API_KEY
    if (!key) return fail('The assistant is not configured on this server.')
    if (JSON.stringify(data).length > MAX_REQUEST_CHARS) return fail('This conversation is too long. Start a new one.')
    if (!allow(getRequestIP({ xForwardedFor: true }) ?? 'unknown')) return fail('The demo assistant is busy. Try again in a few minutes.')

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'Handshake',
      },
      body: JSON.stringify({
        model: agentModel(),
        messages: data.messages,
        max_tokens: MAX_TOKENS,
        ...(data.tools.length
          ? {
              tools: data.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
              tool_choice:
                typeof data.toolChoice === 'object' ? { type: 'function', function: { name: data.toolChoice.name } } : (data.toolChoice ?? 'auto'),
            }
          : {}),
        ...(data.json ? { response_format: { type: 'json_schema', json_schema: { name: data.json.name, schema: data.json.schema } } } : {}),
        provider: { require_parameters: true },
      }),
    }).catch(() => null)

    const body = (await res?.json().catch(() => null)) as {
      id?: string
      model?: string
      error?: { message?: string }
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      choices?: {
        finish_reason?: string
        message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }
      }[]
    } | null
    if (!res?.ok || !body || body.error) return fail(`The AI provider failed (${res?.status ?? 'network'}): ${body?.error?.message ?? 'no response'}`)

    const choice = body.choices?.[0]
    return {
      ok: true,
      id: body.id ?? crypto.randomUUID(),
      model: body.model ?? '',
      text: choice?.message?.content ?? '',
      toolCalls: (choice?.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments || '{}' })),
      truncated: choice?.finish_reason === 'length',
      usage: body.usage ? { inputTokens: body.usage.prompt_tokens ?? 0, outputTokens: body.usage.completion_tokens ?? 0 } : undefined,
    }
  })
