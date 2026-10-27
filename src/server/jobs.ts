import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { MAX_ATTEMPTS, MEDIA_TYPES, formatMoney, type JobRecord, type JobView, type Role } from '~/lib/types'
import {
  addEvent,
  getJob,
  insertDeliverable,
  insertJob,
  listDeliverables,
  listEvents,
  listJobs,
  setDeliverableVerdict,
  updateJob,
} from './db'
import { draftContract, judgeDelivery } from './ai'
import { authorizeOrder, captureAuthorization, createHoldOrder, payoutToFreelancer, voidAuthorization } from './paypal'

const demoMode = () => process.env.DEMO_MODE !== 'false'
const feePercent = () => Number(process.env.PLATFORM_FEE_PERCENT ?? 5)
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

const newId = (len: number) => crypto.randomUUID().replace(/-/g, '').slice(0, len)

async function authorize(id: string, token: string, allowed?: Role[]): Promise<{ job: JobRecord; role: Role }> {
  const job = await getJob(id)
  if (!job) throw new Error('This Handshake does not exist.')
  const role: Role | null =
    token === job.clientToken ? 'client' : token === job.freelancerToken ? 'freelancer' : null
  if (!role) throw new Error('This link is not valid for this Handshake.')
  if (allowed && !allowed.includes(role)) throw new Error(`Only the ${allowed.join(' or ')} can do that.`)
  return { job, role }
}

function requireStatus(job: JobRecord, ...statuses: JobRecord['status'][]) {
  if (!statuses.includes(job.status)) throw new Error(`Not possible while this Handshake is "${job.status.replace('_', ' ')}".`)
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const DraftInput = z.object({
  title: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(20).max(8000),
  amount: z.number().positive().max(10000),
})

export const draftContractFn = createServerFn({ method: 'POST' })
  .validator(DraftInput)
  .handler(async ({ data }) => draftContract({ ...data, amount: formatMoney(Math.round(data.amount * 100)) }))

const CreateInput = DraftInput.extend({
  freelancerName: z.string().trim().min(1).max(80),
  freelancerEmail: z.email(),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.email(),
  summary: z.string().trim().max(1000),
  criteria: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(600),
        method: z.enum(['visual', 'content', 'link', 'manual']),
      }),
    )
    .min(1)
    .max(10),
})

export const createJobFn = createServerFn({ method: 'POST' })
  .validator(CreateInput)
  .handler(async ({ data }) => {
    const now = Date.now()
    const job: JobRecord = {
      id: newId(10),
      createdAt: now,
      updatedAt: now,
      title: data.title,
      brief: data.brief,
      amountCents: Math.round(data.amount * 100),
      currency: 'USD',
      freelancerName: data.freelancerName,
      freelancerEmail: data.freelancerEmail,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientToken: newId(24),
      freelancerToken: newId(24),
      status: 'awaiting_funding',
      contractSummary: data.summary,
      criteria: data.criteria.map((c, i) => ({ ...c, id: `c${i + 1}` })),
      paypalOrderId: null,
      paypalAuthorizationId: null,
      paypalCaptureId: null,
      paypalPayoutBatchId: null,
      attempts: 0,
    }
    await insertJob(job)
    await addEvent(job.id, 'freelancer', 'created', `${job.freelancerName} proposed a Handshake for ${formatMoney(job.amountCents)} with ${job.criteria.length} acceptance criteria.`)
    return { id: job.id, token: job.freelancerToken }
  })

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const Access = z.object({ id: z.string().min(1), token: z.string().min(1) })

export const getJobViewFn = createServerFn({ method: 'GET' })
  .validator(Access)
  .handler(async ({ data }): Promise<JobView> => {
    const { job, role } = await authorize(data.id, data.token)
    const [deliverables, events] = await Promise.all([listDeliverables(job.id), listEvents(job.id)])
    const { clientToken, freelancerToken, ...safe } = job
    const base = `${appUrl()}/j/${job.id}?t=`
    return {
      job: safe,
      role,
      deliverables,
      events,
      // The freelancer needs the client link to share it. Demo mode exposes both so judges can switch sides.
      links:
        role === 'freelancer' || demoMode()
          ? { client: base + clientToken, freelancer: demoMode() ? base + freelancerToken : '' }
          : null,
      demoMode: demoMode(),
      paypalClientId: process.env.PAYPAL_CLIENT_ID ?? '',
      feePercent: feePercent(),
    }
  })

export const listJobsFn = createServerFn({ method: 'GET' }).handler(async () => {
  if (!demoMode()) return []
  const jobs = await listJobs()
  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    amount: j.amountCents / 100,
    freelancer: j.freelancerName,
    client: j.clientName,
    criteria: j.criteria.length,
    attempts: j.attempts,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    link: `/j/${j.id}?t=${j.clientToken}`,
  }))
})

// ---------------------------------------------------------------------------
// Funding (client)
// ---------------------------------------------------------------------------

export const createOrderFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['client'])
    requireStatus(job, 'awaiting_funding')
    const orderId = await createHoldOrder({
      jobId: job.id,
      title: job.title,
      amountCents: job.amountCents,
      currency: job.currency,
    })
    await updateJob(job.id, { paypalOrderId: orderId })
    return { orderId }
  })

export const approveOrderFn = createServerFn({ method: 'POST' })
  .validator(Access.extend({ orderId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['client'])
    requireStatus(job, 'awaiting_funding')
    if (job.paypalOrderId !== data.orderId) throw new Error('This PayPal order does not belong to this Handshake.')
    const auth = await authorizeOrder(data.orderId)
    await updateJob(job.id, { status: 'funded', paypalAuthorizationId: auth.authorizationId })
    await addEvent(job.id, 'client', 'agreed', `${job.clientName} agreed to the contract.`)
    await addEvent(job.id, 'paypal', 'funded', `${formatMoney(job.amountCents)} is now held by PayPal. The client is not charged until the work is verified.`)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Release (shared by the AI verdict and the client's manual approval)
// ---------------------------------------------------------------------------

async function releaseFunds(job: JobRecord, reason: string) {
  if (!job.paypalAuthorizationId) throw new Error('There is no PayPal hold to release.')
  const capture = await captureAuthorization(job.paypalAuthorizationId)
  await updateJob(job.id, { status: 'released', paypalCaptureId: capture.captureId })
  await addEvent(job.id, 'paypal', 'captured', `${reason} PayPal captured ${formatMoney(job.amountCents)} from ${job.clientName}.`)

  const payoutCents = Math.floor(job.amountCents * (1 - feePercent() / 100))
  try {
    const payout = await payoutToFreelancer({
      jobId: job.id,
      email: job.freelancerEmail,
      amountCents: payoutCents,
      currency: job.currency,
      title: job.title,
    })
    await updateJob(job.id, { paypalPayoutBatchId: payout.batchId })
    await addEvent(job.id, 'paypal', 'paid_out', `${formatMoney(payoutCents)} sent to ${job.freelancerName} (${job.freelancerEmail}) via PayPal Payouts.`)
  } catch (err) {
    // The client was charged, so the job is released. The payout can be retried from the job page.
    await addEvent(job.id, 'system', 'payout_failed', `Payout to ${job.freelancerName} failed and will be retried: ${(err as Error).message}`)
  }
}

export const retryPayoutFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token)
    requireStatus(job, 'released')
    if (job.paypalPayoutBatchId) return { ok: true }
    const payoutCents = Math.floor(job.amountCents * (1 - feePercent() / 100))
    const payout = await payoutToFreelancer({
      jobId: job.id,
      email: job.freelancerEmail,
      amountCents: payoutCents,
      currency: job.currency,
      title: job.title,
    })
    await updateJob(job.id, { paypalPayoutBatchId: payout.batchId })
    await addEvent(job.id, 'paypal', 'paid_out', `${formatMoney(payoutCents)} sent to ${job.freelancerName} via PayPal Payouts.`)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Delivery (freelancer) -> AI review -> policy -> money
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 4_500_000

const DeliverInput = Access.extend({
  note: z.string().trim().max(6000),
  link: z.union([z.url(), z.literal('')]),
  files: z
    .array(
      z.object({
        name: z.string().max(200),
        mediaType: z.enum(MEDIA_TYPES),
        dataUrl: z.string().startsWith('data:').max(Math.ceil(MAX_FILE_BYTES * 1.37) + 100),
      }),
    )
    .max(6),
})

export const submitDeliveryFn = createServerFn({ method: 'POST' })
  .validator(DeliverInput)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['freelancer'])
    requireStatus(job, 'funded', 'revision_requested')
    if (!data.files.length && !data.note && !data.link) throw new Error('Add at least a file, a link, or a note.')

    const attempts = job.attempts + 1
    const deliverable = {
      id: newId(12),
      jobId: job.id,
      createdAt: Date.now(),
      note: data.note,
      link: data.link || null,
      files: data.files,
      verdict: null,
    }
    await insertDeliverable(deliverable)
    await updateJob(job.id, { status: 'verifying', attempts })
    await addEvent(job.id, 'freelancer', 'delivered', `${job.freelancerName} submitted delivery #${attempts} (${data.files.length} file${data.files.length === 1 ? '' : 's'}${data.link ? ', 1 link' : ''}).`)

    let verdict
    try {
      verdict = await judgeDelivery({
        title: job.title,
        brief: job.brief,
        contractSummary: job.contractSummary,
        criteria: job.criteria,
        note: data.note,
        link: data.link || null,
        files: data.files,
        attempts,
        maxAttempts: MAX_ATTEMPTS,
      })
    } catch (err) {
      await updateJob(job.id, { status: 'human_review' })
      await addEvent(job.id, 'system', 'review_failed', `The AI review failed (${(err as Error).message}). The client will decide.`)
      throw err
    }
    await setDeliverableVerdict(deliverable.id, verdict)
    const passed = verdict.results.filter((r) => r.status === 'pass').length
    await addEvent(job.id, 'ai', 'verdict', `AI review: ${passed}/${job.criteria.length} criteria passed. ${verdict.policyNote}`)

    if (verdict.decision === 'release') {
      await releaseFunds({ ...job, attempts }, 'Every criterion verified.')
    } else if (verdict.decision === 'revise') {
      await updateJob(job.id, { status: 'revision_requested' })
    } else {
      await updateJob(job.id, { status: 'human_review' })
    }
    return { decision: verdict.decision }
  })

// ---------------------------------------------------------------------------
// Human decisions
// ---------------------------------------------------------------------------

export const clientReleaseFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['client'])
    requireStatus(job, 'funded', 'revision_requested', 'human_review')
    await addEvent(job.id, 'client', 'approved', `${job.clientName} approved the work manually.`)
    await releaseFunds(job, 'Client approved.')
    return { ok: true }
  })

export const clientRequestRevisionFn = createServerFn({ method: 'POST' })
  .validator(Access.extend({ message: z.string().trim().min(3).max(2000) }))
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['client'])
    requireStatus(job, 'human_review')
    await updateJob(job.id, { status: 'revision_requested', attempts: Math.min(job.attempts, MAX_ATTEMPTS - 1) })
    await addEvent(job.id, 'client', 'revision', `${job.clientName} asked for changes: "${data.message}"`)
    return { ok: true }
  })

export const cancelFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job, role } = await authorize(data.id, data.token)
    if (job.status === 'awaiting_funding') {
      await updateJob(job.id, { status: 'refunded' })
      await addEvent(job.id, role, 'cancelled', `The Handshake was cancelled by the ${role} before funding.`)
      return { ok: true }
    }
    // Once the money is held, the client can only cancel before any delivery. The freelancer can always back out.
    if (role === 'client') {
      requireStatus(job, 'funded')
      if (job.attempts > 0) throw new Error('Work has been delivered. Approve it or ask for changes instead.')
    } else {
      requireStatus(job, 'funded', 'revision_requested', 'human_review')
    }
    if (job.paypalAuthorizationId) await voidAuthorization(job.paypalAuthorizationId)
    await updateJob(job.id, { status: 'refunded' })
    await addEvent(job.id, 'paypal', 'voided', `The ${role} cancelled. PayPal released the hold and ${job.clientName} was never charged.`)
    return { ok: true }
  })
