export type JobStatus =
  | 'awaiting_funding' // contract drafted, client has not funded yet
  | 'funded' // money is held by PayPal (authorized), waiting for delivery
  | 'verifying' // AI judge is reviewing a delivery
  | 'revision_requested' // AI found gaps, freelancer can resubmit
  | 'human_review' // AI was unsure, or attempts ran out: client decides
  | 'released' // payment captured and paid out to the freelancer
  | 'refunded' // authorization voided, client never charged

export type Role = 'client' | 'freelancer'

export type CheckMethod = 'visual' | 'content' | 'link' | 'manual'

export interface Criterion {
  id: string
  title: string
  description: string
  method: CheckMethod
  /** This item's share of the escrow. All items sum to the job amount. */
  amountCents: number
  /** The line of the brief this item comes from, verbatim. Null when the AI's quote could not be verified. */
  sourceQuote: string | null
}

export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export interface DeliverableFile {
  name: string
  mediaType: MediaType
  dataUrl: string
}

export type CriterionStatus = 'pass' | 'fail' | 'unclear'

/** A rectangle on a delivered image, as fractions (0 to 1) of its width and height, from the top-left corner. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface CriterionResult {
  id: string
  status: CriterionStatus
  confidence: number
  evidence: string
  /** 1-based index of the delivered file the evidence comes from, or null. */
  fileIndex: number | null
  /** Where on that file the evidence is, when the reviewer could point at it. */
  region: Region | null
  /** Text read in the delivery that supports the evidence, verbatim, or null. */
  quote: string | null
}

export type Decision = 'release' | 'revise' | 'human_review'

export interface Verdict {
  results: CriterionResult[]
  aiRecommendation: Decision
  decision: Decision
  /** Items this verdict released, and items it left on hold. Items paid earlier are in neither list. */
  releasedIds: string[]
  heldIds: string[]
  injectionDetected: boolean
  policyNote: string
  summary: string
  messageToFreelancer: string
  messageToClient: string
  model: string
  reviewedAt: number
}

export interface Deliverable {
  id: string
  jobId: string
  createdAt: number
  note: string
  link: string | null
  files: DeliverableFile[]
  verdict: Verdict | null
}

export interface JobEvent {
  at: number
  actor: 'client' | 'freelancer' | 'ai' | 'paypal' | 'system'
  type: string
  message: string
}

export type ItemState =
  | 'held' // waiting for verified work
  | 'released' // captured and paid out
  | 'appeal_review' // the artist appealed, a second AI review is running
  | 'disputed' // the appeal was not upheld: the client decides

export interface Appeal {
  at: number
  deliverableId: string
  reason: string
  /** The second reviewer's answer. */
  overturn: boolean
  confidence: number
  reasoning: string
  injectionDetected: boolean
  model: string
  outcome: 'pending' | 'upheld' | 'disputed' | 'client_released' | 'client_held' | 'redelivered'
  resolvedAt: number | null
}

export interface LedgerItem {
  state: ItemState
  amountCents: number
  releasedAt: number | null
  releasedBy: 'ai' | 'appeal' | 'client' | null
  /** The PayPal release (capture + payout) this item was paid in. */
  releaseSeq: number | null
  /** Appeals on this item, newest last. */
  appeals: Appeal[]
}

/** One PayPal capture of part of the hold, and the payout that followed it. */
export interface Release {
  seq: number
  at: number
  itemIds: string[]
  amountCents: number
  captureId: string
  finalCapture: boolean
  payoutCents: number
  payoutBatchId: string | null
  payoutStatus: 'paid' | 'processing'
  reason: string
  deliverableId: string | null
}

export interface Ledger {
  items: Record<string, LedgerItem>
  releases: Release[]
  /** Set when the remaining hold was voided. */
  voidedAt: number | null
}

export interface JobRecord {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  brief: string
  amountCents: number
  currency: string
  freelancerName: string
  freelancerEmail: string
  clientName: string
  clientEmail: string
  clientToken: string
  freelancerToken: string
  status: JobStatus
  contractSummary: string | null
  criteria: Criterion[]
  paypalOrderId: string | null
  paypalAuthorizationId: string | null
  paypalCaptureId: string | null
  paypalPayoutBatchId: string | null
  attempts: number
  isDemo: boolean
  ledger: Ledger
}

/** What a viewer of a job page is allowed to see. Tokens are stripped. */
export interface JobView {
  job: Omit<JobRecord, 'clientToken' | 'freelancerToken'>
  role: Role
  deliverables: Deliverable[]
  events: JobEvent[]
  links: { client: string; freelancer: string } | null
  demoMode: boolean
  paypalClientId: string
  paypalEnv: 'sandbox' | 'live'
  /** Sandbox buyer login shown to judges on demo jobs (fake money). */
  demoBuyer: { email: string; password: string } | null
  feePercent: number
}

export const MAX_ATTEMPTS = 3

/** Split a total into n item amounts that sum exactly. The last items take the leftover cents. */
export function splitAmount(totalCents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalCents / n)
  const extra = totalCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i >= n - extra ? 1 : 0))
}

/**
 * Turns proposed prices into whole-cent amounts that sum exactly to the total: each item keeps its
 * share of the proposal (at least 1 cent), and rounding leftovers go to the items with the largest remainders.
 */
export function normalizePrices(proposed: number[], totalCents: number): number[] {
  const n = proposed.length
  if (!n) return []
  const safe = proposed.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const sum = safe.reduce((a, b) => a + b, 0)
  if (sum <= 0 || totalCents < n) return splitAmount(totalCents, n)
  const spare = totalCents - n // every item gets 1 cent, the rest is shared by proposal
  const exact = safe.map((p) => (p / sum) * spare)
  const out = exact.map((x) => 1 + Math.floor(x))
  let left = totalCents - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k][1]]++
  return out
}

export function emptyLedger(criteria: Criterion[]): Ledger {
  return {
    items: Object.fromEntries(
      criteria.map((c) => [c.id, { state: 'held', amountCents: c.amountCents, releasedAt: null, releasedBy: null, releaseSeq: null, appeals: [] }]),
    ),
    releases: [],
    voidedAt: null,
  }
}

export function ledgerTotals(ledger: Ledger) {
  let released = 0
  let held = 0
  for (const item of Object.values(ledger.items)) {
    if (item.state === 'released') released += item.amountCents
    else held += item.amountCents
  }
  const paidOut = ledger.releases.reduce((n, r) => n + (r.payoutStatus === 'paid' ? r.payoutCents : 0), 0)
  return { released, held: ledger.voidedAt ? 0 : held, voided: ledger.voidedAt ? held : 0, paidOut }
}

export function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}
