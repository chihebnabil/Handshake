import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { MAX_ATTEMPTS, MEDIA_TYPES, emptyLedger, formatMoney, ledgerTotals, splitAmount, type JobRecord, type JobView, type Role } from '~/lib/types'
import {
  addEvent,
  getDeliverable,
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
import { CURRENCY, authorizeOrder, createHoldOrder } from './paypal'
import { appealItem, feePercent, payRelease, releaseItems, resolveDispute, unpaidIds, voidRemaining } from './escrow'
import { DEMO, DEMO_CRITERIA } from './demo'
import { negotiate } from './negotiate'

const demoMode = () => process.env.DEMO_MODE !== 'false'
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
  .handler(async ({ data }) => {
    const totalCents = Math.round(data.amount * 100)
    const draft = await draftContract({ ...data, amount: formatMoney(totalCents) })
    const split = splitAmount(totalCents, draft.criteria.length)
    return { summary: draft.summary, criteria: draft.criteria.map((c, i) => ({ ...c, amountCents: split[i] })) }
  })

const ItemInput = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
  method: z.enum(['visual', 'content', 'link', 'manual']),
  amountCents: z.number().int().positive(),
  sourceQuote: z.string().max(600).nullable(),
})

/** The client's agent proposes, the artist's agent counters, and a fixed rule settles the contract. */
export const negotiateFn = createServerFn({ method: 'POST' })
  .validator(DraftInput.extend({ criteria: z.array(ItemInput).min(1).max(12) }))
  .handler(async ({ data }) => negotiate({ title: data.title, brief: data.brief, totalCents: Math.round(data.amount * 100), items: data.criteria }))

const CreateInput = DraftInput.extend({
  freelancerName: z.string().trim().min(1).max(80),
  freelancerEmail: z.email(),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.email(),
  summary: z.string().trim().max(1000),
  criteria: z.array(ItemInput).min(1).max(12),
})

export const createJobFn = createServerFn({ method: 'POST' })
  .validator(CreateInput)
  .handler(async ({ data }) => {
    const amountCents = Math.round(data.amount * 100)
    const sum = data.criteria.reduce((n, c) => n + c.amountCents, 0)
    if (sum !== amountCents) throw new Error(`The item prices add up to ${formatMoney(sum)}, but the job is ${formatMoney(amountCents)}.`)
    const now = Date.now()
    const criteria = data.criteria.map((c, i) => ({ ...c, id: `c${i + 1}`, sourceQuote: c.sourceQuote && data.brief.includes(c.sourceQuote) ? c.sourceQuote : null }))
    const job: JobRecord = {
      id: newId(10),
      createdAt: now,
      updatedAt: now,
      title: data.title,
      brief: data.brief,
      amountCents,
      currency: CURRENCY,
      freelancerName: data.freelancerName,
      freelancerEmail: data.freelancerEmail,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientToken: newId(24),
      freelancerToken: newId(24),
      status: 'awaiting_funding',
      contractSummary: data.summary,
      criteria,
      paypalOrderId: null,
      paypalAuthorizationId: null,
      paypalCaptureId: null,
      paypalPayoutBatchId: null,
      attempts: 0,
      isDemo: false,
      ledger: emptyLedger(criteria),
    }
    await insertJob(job)
    await addEvent(job.id, 'freelancer', 'created', `${job.freelancerName} proposed a Handshake for ${formatMoney(job.amountCents)}, split into ${job.criteria.length} items.`)
    return { id: job.id, token: job.freelancerToken }
  })

// ---------------------------------------------------------------------------
// One-click demo for judges
// ---------------------------------------------------------------------------

export const getAppConfigFn = createServerFn({ method: 'GET' }).handler(async () => ({ demoMode: demoMode() }))

export const createDemoJobFn = createServerFn({ method: 'POST' }).handler(async () => {
  if (!demoMode()) throw new Error('The demo is turned off on this server.')
  const now = Date.now()
  const job: JobRecord = {
    id: newId(10),
    createdAt: now,
    updatedAt: now,
    title: DEMO.title,
    brief: DEMO.brief,
    amountCents: DEMO.amountCents,
    currency: CURRENCY,
    freelancerName: DEMO.freelancerName,
    freelancerEmail: process.env.DEMO_FREELANCER_EMAIL || 'amira@example.com',
    clientName: DEMO.clientName,
    clientEmail: 'youssef@example.com',
    clientToken: newId(24),
    freelancerToken: newId(24),
    status: 'awaiting_funding',
    contractSummary: DEMO.summary,
    criteria: DEMO_CRITERIA,
    paypalOrderId: null,
    paypalAuthorizationId: null,
    paypalCaptureId: null,
    paypalPayoutBatchId: null,
    attempts: 0,
    isDemo: true,
    ledger: emptyLedger(DEMO_CRITERIA),
  }
  await insertJob(job)
  await addEvent(job.id, 'freelancer', 'created', `${job.freelancerName} proposed a Handshake for ${formatMoney(job.amountCents)}, split into ${job.criteria.length} items of ${formatMoney(DEMO_CRITERIA[0].amountCents)}.`)
  return { id: job.id, token: job.clientToken }
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
      paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
      demoBuyer:
        demoMode() && job.isDemo && process.env.DEMO_BUYER_EMAIL
          ? { email: process.env.DEMO_BUYER_EMAIL, password: process.env.DEMO_BUYER_PASSWORD ?? '' }
          : null,
      feePercent: feePercent(),
    }
  })

export const listJobsFn = createServerFn({ method: 'GET' }).handler(async () => {
  if (!demoMode()) return []
  const jobs = await listJobs()
  return jobs.map((j) => {
    const totals = ledgerTotals(j.ledger)
    return {
      id: j.id,
      title: j.title,
      status: j.status,
      amount: j.amountCents / 100,
      released: totals.released / 100,
      held: ['funded', 'verifying', 'revision_requested', 'human_review'].includes(j.status) ? totals.held / 100 : 0,
      freelancer: j.freelancerName,
      client: j.clientName,
      criteria: j.criteria.length,
      attempts: j.attempts,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      link: `/j/${j.id}?t=${j.clientToken}`,
    }
  })
})

/** Every PayPal money movement across all commissions, one row per release (capture + payout), plus voided holds. */
export const listPaymentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  if (!demoMode()) return []
  const jobs = await listJobs()
  return jobs.flatMap((j) => {
    const totals = ledgerTotals(j.ledger)
    const title = (id: string) => j.criteria.find((c) => c.id === id)?.title ?? id
    const common = {
      jobId: j.id,
      job: j.title,
      artist: j.freelancerName,
      client: j.clientName,
      jobTotal: j.amountCents / 100,
      jobReleased: totals.released / 100,
      link: `/j/${j.id}?t=${j.clientToken}`,
    }
    const releases = j.ledger.releases.map((r) => {
      const by = j.ledger.items[r.itemIds[0]]?.releasedBy ?? 'ai'
      return {
        ...common,
        key: `${j.id}-${r.seq}`,
        kind: 'release' as const,
        seq: r.seq,
        at: r.at,
        items: r.itemIds.length,
        itemTitles: r.itemIds.map(title).join(', '),
        decidedBy: by as NonNullable<typeof by> | 'void',
        reason: r.reason,
        captured: r.amountCents / 100,
        fee: (r.amountCents - r.payoutCents) / 100,
        paidOut: r.payoutCents / 100,
        payoutStatus: r.payoutStatus as 'paid' | 'processing' | 'voided',
        finalCapture: r.finalCapture,
        captureId: r.captureId,
        payoutBatchId: r.payoutBatchId ?? '',
        voided: 0,
      }
    })
    if (!j.ledger.voidedAt || totals.voided === 0) return releases
    const unpaid = Object.entries(j.ledger.items).filter(([, it]) => it.state !== 'released')
    return [
      ...releases,
      {
        ...common,
        key: `${j.id}-void`,
        kind: 'void' as const,
        seq: releases.length + 1,
        at: j.ledger.voidedAt,
        items: unpaid.length,
        itemTitles: unpaid.map(([id]) => title(id)).join(', '),
        decidedBy: 'void' as const,
        reason: 'Remaining hold voided: nothing was charged for these items.',
        captured: 0,
        fee: 0,
        paidOut: 0,
        payoutStatus: 'voided' as const,
        finalCapture: false,
        captureId: '',
        payoutBatchId: '',
        voided: totals.voided / 100,
      },
    ]
  })
})

/** Everything needed to print the receipt of one decision: a delivery's verdict, its appeals and the money it moved. */
export const getReceiptFn = createServerFn({ method: 'GET' })
  .validator(Access.extend({ d: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { job, role } = await authorize(data.id, data.token)
    const deliverable = await getDeliverable(job.id, data.d)
    if (!deliverable?.verdict) throw new Error('This decision does not exist.')
    const releases = job.ledger.releases.filter((r) => r.deliverableId === deliverable.id)
    const appeals = Object.entries(job.ledger.items).flatMap(([id, item]) =>
      item.appeals.filter((a) => a.deliverableId === deliverable.id).map((a) => ({ criterionId: id, ...a })),
    )
    const deliveries = await listDeliverables(job.id)
    const number = deliveries.length - deliveries.findIndex((d) => d.id === deliverable.id)
    const record = {
      job: { id: job.id, title: job.title, amountCents: job.amountCents, currency: job.currency, freelancer: job.freelancerName, client: job.clientName },
      criteria: job.criteria,
      delivery: { id: deliverable.id, number, createdAt: deliverable.createdAt, files: deliverable.files.map((f) => f.name), note: deliverable.note, link: deliverable.link },
      verdict: deliverable.verdict,
      appeals,
      releases,
    }
    // A fingerprint of exactly what was decided: anyone holding the receipt can check it was not edited.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)))
    const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    return {
      ...record,
      role,
      files: deliverable.files,
      totals: ledgerTotals(job.ledger),
      feePercent: feePercent(),
      paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
      fingerprint,
      issuedAt: Date.now(),
    }
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
    await addEvent(job.id, 'paypal', 'funded', `${formatMoney(job.amountCents)} is now held by PayPal. ${job.clientName} is charged only for items that are verified.`)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export const retryPayoutFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token)
    for (const r of job.ledger.releases.filter((r) => r.payoutStatus === 'processing')) await payRelease(job.id, r.seq)
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Delivery (freelancer) -> AI review -> policy -> money, item by item
// ---------------------------------------------------------------------------

const MAX_DELIVERY_CHARS = 4_200_000

const DeliverInput = Access.extend({
  note: z.string().trim().max(6000),
  link: z.union([z.url(), z.literal('')]),
  files: z
    .array(
      z.object({
        name: z.string().max(200),
        mediaType: z.enum(MEDIA_TYPES),
        dataUrl: z.string().startsWith('data:'),
      }),
    )
    .max(6)
    .refine((fs) => fs.reduce((n, f) => n + f.dataUrl.length, 0) <= MAX_DELIVERY_CHARS, 'Files are too large together.'),
})

export const submitDeliveryFn = createServerFn({ method: 'POST' })
  .validator(DeliverInput)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['freelancer'])
    requireStatus(job, 'funded', 'revision_requested', 'human_review')
    if (!data.files.length && !data.note && !data.link) throw new Error('Add at least a file, a link, or a note.')
    if (Object.values(job.ledger.items).some((i) => i.state === 'appeal_review')) throw new Error('An appeal is being reviewed. Try again in a minute.')

    // Only items still waiting for verified work are reviewed. Paid items are passed as context.
    const open = new Set(unpaidIds(job.ledger))
    const toReview = job.criteria.filter((c) => open.has(c.id))
    const alreadyPaid = job.criteria.filter((c) => !open.has(c.id))

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
        criteria: toReview,
        alreadyPaid,
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
    if (verdict.injectionDetected) {
      await addEvent(job.id, 'ai', 'injection', 'The delivery contains text that tries to instruct the reviewer. Nothing was paid automatically.')
    }
    await addEvent(job.id, 'ai', 'verdict', `AI review: ${verdict.policyNote}`)

    // Status first, so the page reflects the verdict even if PayPal is slow; a final release then marks the job paid.
    const next = verdict.decision === 'revise' ? 'revision_requested' : verdict.decision === 'release' ? 'funded' : 'human_review'
    await updateJob(job.id, { status: next })
    if (verdict.releasedIds.length) {
      try {
        await releaseItems(job.id, verdict.releasedIds, {
          reason: `AI verified ${verdict.releasedIds.length} ${verdict.releasedIds.length === 1 ? 'item' : 'items'}.`,
          by: 'ai',
          deliverableId: deliverable.id,
        })
      } catch (err) {
        // The verdict stands, but PayPal did not capture: nothing was charged, and the client can release it by hand.
        await updateJob(job.id, { status: 'human_review' })
        await addEvent(job.id, 'system', 'capture_failed', `PayPal could not capture the verified items (${(err as Error).message}). Nothing was charged; the client can release them.`)
      }
    }
    return { decision: verdict.decision }
  })

// ---------------------------------------------------------------------------
// Appeals and human decisions
// ---------------------------------------------------------------------------

export const appealFn = createServerFn({ method: 'POST' })
  .validator(Access.extend({ criterionId: z.string().min(1), reason: z.string().trim().min(10).max(1000) }))
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['freelancer'])
    requireStatus(job, 'revision_requested', 'human_review')
    const [latest] = await listDeliverables(job.id)
    if (!latest?.verdict) throw new Error('There is no reviewed delivery to appeal.')
    await appealItem(job.id, data.criterionId, data.reason, latest)
    return { ok: true }
  })

export const resolveDisputeFn = createServerFn({ method: 'POST' })
  .validator(Access.extend({ criterionId: z.string().min(1), release: z.boolean() }))
  .handler(async ({ data }) => {
    await authorize(data.id, data.token, ['client'])
    await resolveDispute(data.id, data.criterionId, data.release)
    return { ok: true }
  })

/** The client approves everything that is still held, after looking at the work themselves. */
export const clientReleaseFn = createServerFn({ method: 'POST' })
  .validator(Access)
  .handler(async ({ data }) => {
    const { job } = await authorize(data.id, data.token, ['client'])
    requireStatus(job, 'funded', 'revision_requested', 'human_review')
    const open = unpaidIds(job.ledger)
    if (!open.length) return { ok: true }
    await addEvent(job.id, 'client', 'approved', `${job.clientName} approved the remaining ${open.length === 1 ? 'item' : `${open.length} items`} manually.`)
    await releaseItems(job.id, open, { reason: 'Client approved.', by: 'client', deliverableId: null })
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
    // Once the money is held, the client can only cancel before any delivery. The artist can always stop;
    // items already verified stay paid and the rest of the hold is released.
    if (role === 'client') {
      requireStatus(job, 'funded')
      if (job.attempts > 0) throw new Error('Work has been delivered. Approve it or ask for changes instead.')
    } else {
      requireStatus(job, 'funded', 'revision_requested', 'human_review')
    }
    await voidRemaining(job.id, `The ${role} stopped the Handshake.`)
    return { ok: true }
  })
