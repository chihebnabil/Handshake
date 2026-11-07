// Agent negotiation: before any money is held, an agent for each side negotiates the contract.
// The client's agent proposes strict, checkable items and a price split; the artist's agent
// counters. The agents only argue: a fixed rule settles the outcome, and both people can still edit it.

import { z } from 'zod'
import { formatMoney, normalizePrices, type Criterion } from '~/lib/types'
import { structuredChat } from './openrouter'

const ClientSchema = z.object({
  message: z.string(),
  items: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), price: z.number(), reason: z.string() })),
})

const ArtistSchema = z.object({
  message: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      price: z.number(),
      description: z.string(),
      objection: z.enum(['none', 'unverifiable', 'unfair']),
      objection_reason: z.string(),
      reason: z.string(),
    }),
  ),
})

const CLIENT_AGENT = `You are the client's negotiating agent on Handshake, an escrow where each item of a commission is paid separately the moment an AI judge verifies it in the delivery. You protect the client: the client should only pay for work that is clearly delivered as asked.

For every item:
- Rewrite the description so an AI judge can verify it from the delivered files alone, without guessing. Keep the item's meaning; do not add requirements the brief does not imply.
- Propose a price in dollars. Items that matter more to the client, or carry more risk, can be worth more.
- Give a one-sentence reason for your price and any change.

Keep every item id. Your prices must add up to the total budget.

message: two sentences to the artist's agent explaining your proposal. Write in the language of the brief.`

const ARTIST_AGENT = `You are the artist's negotiating agent on Handshake, an escrow where each item of a commission is paid separately the moment an AI judge verifies it in the delivery. You protect the artist: each item should be priced for the work it takes, and nothing should be impossible to prove.

You receive the client agent's proposal. For every item:
- price: your counter in dollars. Move money toward the items that take more work (for example full-body poses, detailed backgrounds, animation) and away from simple ones. The total budget stays the same.
- objection:
  - "unverifiable": the description asks for something an AI judge cannot see in a delivered file (for example file formats it cannot inspect, behavior over time, rights or ownership). Rewrite the description so it can be checked.
  - "unfair": the description adds requirements the brief does not ask for. Explain, and suggest fairer wording.
  - "none": you accept the description as is (copy it unchanged).
- objection_reason: one sentence explaining the objection and the new wording; empty string when objection is "none".
- reason: one sentence explaining your price.

Keep every item id. Your prices must add up to the total budget.

message: two sentences to the client's agent explaining your counter. Write in the language of the brief.`

export interface AgentItem {
  id: string
  title: string
  description: string
  amountCents: number
  reason: string
  objection?: 'none' | 'unverifiable' | 'unfair'
  objectionReason?: string
}

export interface Negotiation {
  client: { message: string; items: AgentItem[] }
  artist: { message: string; items: AgentItem[] }
  agreed: Criterion[]
  /** What the rule decided, in plain language, item by item. */
  settlement: { id: string; clientCents: number; artistCents: number; agreedCents: number; wording: 'client' | 'artist'; note: string }[]
}

/**
 * The rule that settles a negotiation: prices meet in the middle (then are adjusted to the exact total),
 * and the artist's rewording is accepted only when it shows a check cannot be verified from a delivery,
 * because an item nobody can verify would only end up in a dispute.
 */
export function settle(base: Criterion[], client: AgentItem[], artist: AgentItem[], totalCents: number): Pick<Negotiation, 'agreed' | 'settlement'> {
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
  const c = byId(client)
  const a = byId(artist)
  const mid = base.map((b) => ((c.get(b.id)?.amountCents ?? b.amountCents) + (a.get(b.id)?.amountCents ?? b.amountCents)) / 2)
  const prices = normalizePrices(mid, totalCents)
  const settlement: Negotiation['settlement'] = []
  const agreed = base.map((b, i) => {
    const ci = c.get(b.id)
    const ai = a.get(b.id)
    const useArtist = ai?.objection === 'unverifiable' && ai.description.trim().length > 0
    const description = useArtist ? ai!.description : (ci?.description || b.description)
    settlement.push({
      id: b.id,
      clientCents: ci?.amountCents ?? b.amountCents,
      artistCents: ai?.amountCents ?? b.amountCents,
      agreedCents: prices[i],
      wording: useArtist ? 'artist' : 'client',
      note: useArtist
        ? `Rewording accepted: ${ai!.objectionReason || ai!.reason}`
        : ai?.objection === 'unfair'
          ? `Objection noted for you to decide: ${ai.objectionReason || ai.reason}`
          : '',
    })
    return { ...b, title: ci?.title || b.title, description, amountCents: prices[i] }
  })
  return { agreed, settlement }
}

export async function negotiate(input: { title: string; brief: string; totalCents: number; items: Criterion[] }): Promise<Negotiation> {
  const total = formatMoney(input.totalCents)
  const listing = input.items.map((c) => `<item id="${c.id}" price="${formatMoney(c.amountCents)}">${c.title}: ${c.description}</item>`).join('\n')
  const context = `<job_title>${input.title}</job_title>
<total_budget>${total}</total_budget>
<brief>
${input.brief}
</brief>`

  const clientRes = await structuredChat({
    name: 'client_proposal',
    schema: ClientSchema,
    maxTokens: 6000,
    messages: [
      { role: 'system', content: CLIENT_AGENT },
      { role: 'user', content: `${context}\n<draft_items>\n${listing}\n</draft_items>\n\nPropose the items and prices for the client. The prices must add up to ${total}.` },
    ],
  })
  const known = new Set(input.items.map((c) => c.id))
  const clientItems = input.items.map((b) => {
    const p = clientRes.data.items.find((x) => x.id === b.id && known.has(x.id))
    return { id: b.id, title: p?.title?.trim() || b.title, description: p?.description?.trim() || b.description, raw: p?.price ?? b.amountCents / 100, reason: p?.reason ?? '' }
  })
  const clientCents = normalizePrices(clientItems.map((x) => x.raw), input.totalCents)
  const client: AgentItem[] = clientItems.map((x, i) => ({ id: x.id, title: x.title, description: x.description, amountCents: clientCents[i], reason: x.reason }))

  const proposal = client.map((x) => `<item id="${x.id}" price="${formatMoney(x.amountCents)}" reason="${x.reason.replace(/"/g, "'")}">${x.title}: ${x.description}</item>`).join('\n')
  const artistRes = await structuredChat({
    name: 'artist_counter',
    schema: ArtistSchema,
    maxTokens: 6000,
    messages: [
      { role: 'system', content: ARTIST_AGENT },
      {
        role: 'user',
        content: `${context}\n<client_agent_message>${clientRes.data.message}</client_agent_message>\n<client_proposal>\n${proposal}\n</client_proposal>\n\nCounter for the artist. The prices must add up to ${total}.`,
      },
    ],
  })
  const artistItems = client.map((b) => {
    const p = artistRes.data.items.find((x) => x.id === b.id)
    return { ...b, raw: p?.price ?? b.amountCents / 100, description: p?.description?.trim() || b.description, objection: p?.objection ?? 'none', objectionReason: p?.objection_reason ?? '', reason: p?.reason ?? '' }
  })
  const artistCents = normalizePrices(artistItems.map((x) => x.raw), input.totalCents)
  const artist: AgentItem[] = artistItems.map((x, i) => ({ id: x.id, title: x.title, description: x.description, amountCents: artistCents[i], reason: x.reason, objection: x.objection, objectionReason: x.objectionReason }))

  return {
    client: { message: clientRes.data.message, items: client },
    artist: { message: artistRes.data.message, items: artist },
    ...settle(input.items, client, artist, input.totalCents),
  }
}
