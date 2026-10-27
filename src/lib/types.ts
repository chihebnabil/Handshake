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
}

export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export interface DeliverableFile {
  name: string
  mediaType: MediaType
  dataUrl: string
}

export type CriterionStatus = 'pass' | 'fail' | 'unclear'

export interface CriterionResult {
  id: string
  status: CriterionStatus
  confidence: number
  evidence: string
}

export type Decision = 'release' | 'revise' | 'human_review'

export interface Verdict {
  results: CriterionResult[]
  aiRecommendation: Decision
  decision: Decision
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

export function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}
