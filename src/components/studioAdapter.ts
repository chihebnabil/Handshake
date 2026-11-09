// AG Studio's Agent Framework talks to an LLM through an adapter. This one sends each turn to our
// server function (which holds the OpenRouter key) and maps the answer back into Studio's events.
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio'
import { assistantTurnFn, type AssistantTurn } from '~/server/assistant'

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function toChat(instructions: string | undefined, input: AgAiConversationItem[]): ChatMessage[] {
  const out: ChatMessage[] = instructions ? [{ role: 'system', content: instructions }] : []
  const lastAssistant = () => {
    const m = out[out.length - 1]
    if (m?.role === 'assistant') return m
    const fresh: ChatMessage = { role: 'assistant', content: null }
    out.push(fresh)
    return fresh
  }
  for (const item of input) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
      out.push({ role: item.role === 'system' ? 'system' : 'user', content: text })
    } else if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('\n')
      out.push({ role: 'assistant', content: text })
    } else if (item.type === 'function_call') {
      const m = lastAssistant() as Extract<ChatMessage, { role: 'assistant' }>
      m.tool_calls = [...(m.tool_calls ?? []), { id: item.callId, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' } }]
      if (item.result !== undefined && !input.some((i) => i.type === 'function_call_output' && i.callId === item.callId)) {
        out.push({ role: 'tool', tool_call_id: item.callId, content: item.result })
      }
    } else if (item.type === 'function_call_output') {
      out.push({ role: 'tool', tool_call_id: item.callId, content: item.output })
    }
    // Reasoning items are not sent back.
  }
  return out
}

function toEvents(turn: AssistantTurn, messageId: string): AgAiEvent[] {
  const events: AgAiEvent[] = []
  if (turn.text) {
    events.push({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
    events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: turn.text })
    events.push({ type: 'TEXT_MESSAGE_END', messageId })
  }
  for (const c of turn.toolCalls) {
    events.push({ type: 'TOOL_CALL_START', toolCallId: c.id, toolCallName: c.name, parentMessageId: messageId })
    events.push({ type: 'TOOL_CALL_ARGS', toolCallId: c.id, delta: c.arguments })
    events.push({ type: 'TOOL_CALL_END', toolCallId: c.id })
  }
  return events
}

function toResponse(turn: AssistantTurn, messageId: string): AgLlmResponse {
  if (!turn.ok) return { id: messageId, createdAt: Date.now(), status: 'failed', output: [], error: { code: 'provider_error', message: turn.error ?? 'Failed' } }
  const output: AgAiOutputItem[] = []
  if (turn.text) {
    output.push({ id: messageId, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: turn.text, annotations: [] }] })
  }
  for (const c of turn.toolCalls) {
    output.push({ id: `${messageId}-${c.id}`, kind: 'output', type: 'function_call', callId: c.id, name: c.name, arguments: c.arguments, status: 'completed' })
  }
  return {
    id: turn.id || messageId,
    createdAt: Date.now(),
    status: turn.truncated ? 'incomplete' : 'completed',
    incompleteDetails: turn.truncated ? { reason: 'max_output_tokens' } : undefined,
    output,
    model: turn.model,
    usage: turn.usage,
  }
}

export const openRouterAdapter: AgLlmAdapter = {
  executeTurn(request: AgLlmRequest) {
    const messageId = `msg-${crypto.randomUUID()}`
    const turn: Promise<AssistantTurn> = assistantTurnFn({
      data: {
        messages: toChat(request.instructions, request.input),
        tools: (request.tools ?? []).filter((t) => (t.kind ?? 'client') !== 'provided').map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
        toolChoice: request.toolChoice,
        json: request.responseFormat.type === 'json' ? { name: request.responseFormat.name, schema: request.responseFormat.schema } : null,
      },
    }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'Network error', id: '', model: '', text: '', toolCalls: [], truncated: false }))

    return {
      stream: {
        async *[Symbol.asyncIterator]() {
          const t = await turn
          if (!t.ok) throw new Error(t.error)
          yield* toEvents(t, messageId)
        },
      },
      complete: turn.then((t) => toResponse(t, messageId)),
    }
  },
}
