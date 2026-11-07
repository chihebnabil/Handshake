// The money side of Handshake: which items are paid, when, and how much is still held.
// Kept free of web framework code so it can be tested against a fake PayPal.

import { formatMoney, ledgerTotals, type Criterion, type Deliverable, type JobRecord, type Ledger, type LedgerItem, type Release } from '~/lib/types'
import { addEvent, getJob, updateJob } from './db'
import { captureAuthorization, payoutToFreelancer, voidAuthorization } from './paypal'
import { MIN_CONFIDENCE, reviewAppeal } from './ai'

export const feePercent = () => Number(process.env.PLATFORM_FEE_PERCENT ?? 5)
export const payoutFor = (cents: number) => Math.floor(cents * (1 - feePercent() / 100))

const list = (criteria: Criterion[], ids: string[]) => {
  const names = criteria.filter((c) => ids.includes(c.id)).map((c) => c.title)
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** Items that still need verified work (or a decision) before they can be paid. */
export const unpaidIds = (ledger: Ledger) => Object.entries(ledger.items).filter(([, i]) => i.state !== 'released').map(([id]) => id)

async function fresh(jobId: string) {
  const job = await getJob(jobId)
  if (!job) throw new Error('This Handshake does not exist.')
  return job
}

/**
 * Pays the given items: one PayPal capture for their total (final when nothing stays held),
 * then one payout of the artist's share. The capture is written to the ledger before the payout
 * is attempted, so a failed payout never loses track of money that was already captured.
 */
export async function releaseItems(
  jobId: string,
  ids: string[],
  opts: { reason: string; by: LedgerItem['releasedBy']; deliverableId: string | null },
): Promise<JobRecord> {
  const job = await fresh(jobId)
  if (!job.paypalAuthorizationId) throw new Error('There is no PayPal hold to release.')
  if (job.ledger.voidedAt) throw new Error('The hold was cancelled. Nothing is left to release.')
  const ledger: Ledger = structuredClone(job.ledger)
  const toPay = ids.filter((id) => ledger.items[id] && ledger.items[id].state !== 'released')
  if (!toPay.length) return job

  const amountCents = toPay.reduce((n, id) => n + ledger.items[id].amountCents, 0)
  const final = unpaidIds(ledger).every((id) => toPay.includes(id))
  // The sequence number comes from completed captures, so a retry after a timeout reuses the
  // same PayPal-Request-Id and PayPal answers with the original capture instead of charging twice.
  const seq = ledger.releases.length + 1
  const capture = await captureAuthorization(job.paypalAuthorizationId, { amountCents, currency: job.currency, final, seq })

  const now = Date.now()
  const release: Release = {
    seq, at: now, itemIds: toPay, amountCents, captureId: capture.captureId, finalCapture: final,
    payoutCents: payoutFor(amountCents), payoutBatchId: null, payoutStatus: 'processing', reason: opts.reason, deliverableId: opts.deliverableId,
  }
  ledger.releases.push(release)
  for (const id of toPay) {
    Object.assign(ledger.items[id], { state: 'released', releasedAt: now, releasedBy: opts.by, releaseSeq: seq })
    // An appeal still waiting for the client is settled once the item is paid some other way.
    const open = ledger.items[id].appeals.at(-1)
    if (open && (open.outcome === 'disputed' || open.outcome === 'pending') && opts.by !== 'appeal') Object.assign(open, { outcome: 'redelivered', resolvedAt: now })
  }
  await updateJob(job.id, { ledger, paypalCaptureId: capture.captureId, ...(final ? { status: 'released' } : {}) })
  const { held } = ledgerTotals(ledger)
  await addEvent(
    job.id,
    'paypal',
    'captured',
    `${opts.reason} PayPal captured ${formatMoney(amountCents)} for ${toPay.length} ${toPay.length === 1 ? 'item' : 'items'} (${list(job.criteria, toPay)}).${held ? ` ${formatMoney(held)} stays held.` : ' Nothing is left on hold.'}`,
  )
  return payRelease(job.id, seq)
}

/** Sends the artist's share of one release. Safe to call again: the payout is idempotent per release. */
export async function payRelease(jobId: string, seq: number): Promise<JobRecord> {
  const job = await fresh(jobId)
  const ledger: Ledger = structuredClone(job.ledger)
  const release = ledger.releases.find((r) => r.seq === seq)
  if (!release || release.payoutStatus === 'paid') return job
  try {
    const payout = await payoutToFreelancer({
      jobId: job.id, seq, email: job.freelancerEmail, amountCents: release.payoutCents, currency: job.currency, title: job.title,
    })
    release.payoutBatchId = payout.batchId
    release.payoutStatus = 'paid'
    await updateJob(job.id, { ledger, paypalPayoutBatchId: payout.batchId })
    await addEvent(job.id, 'paypal', 'paid_out', `${formatMoney(release.payoutCents)} sent to ${job.freelancerName} (${job.freelancerEmail}) via PayPal Payouts.`)
  } catch (err) {
    // The money was captured, so the items stay paid. The payout shows as processing and can be retried.
    await addEvent(job.id, 'system', 'payout_failed', `Payout of ${formatMoney(release.payoutCents)} to ${job.freelancerName} is processing and will be retried: ${(err as Error).message}`)
  }
  return fresh(jobId)
}

/** Cancels whatever is still held. Items already paid stay paid: the client is charged only for those. */
export async function voidRemaining(jobId: string, reason: string): Promise<JobRecord> {
  const job = await fresh(jobId)
  const ledger: Ledger = structuredClone(job.ledger)
  if (ledger.voidedAt) return job
  const { released, held } = ledgerTotals(ledger)
  const fullyCaptured = ledger.releases.some((r) => r.finalCapture)
  if (job.paypalAuthorizationId && !fullyCaptured) await voidAuthorization(job.paypalAuthorizationId)
  ledger.voidedAt = Date.now()
  await updateJob(job.id, { ledger, status: 'refunded' })
  if (job.paypalAuthorizationId) {
    await addEvent(
      job.id,
      'paypal',
      'voided',
      released
        ? `${reason} PayPal released the remaining hold of ${formatMoney(held)}. ${job.clientName} paid only for the ${formatMoney(released)} of verified work.`
        : `${reason} PayPal released the hold and ${job.clientName} was never charged.`,
    )
  }
  return fresh(jobId)
}

/**
 * The artist disagrees with a held item. An independent AI review looks again; if it overturns the
 * first review with high confidence the item is paid, otherwise the client decides.
 */
export async function appealItem(jobId: string, criterionId: string, reason: string, deliverable: Deliverable): Promise<JobRecord> {
  const job = await fresh(jobId)
  const criterion = job.criteria.find((c) => c.id === criterionId)
  const item = job.ledger.items[criterionId]
  const first = deliverable.verdict?.results.find((r) => r.id === criterionId)
  if (!criterion || !item || !first) throw new Error('This item was not reviewed in the latest delivery.')
  if (item.state !== 'held') throw new Error('Only an item on hold can be appealed.')
  if (item.appeals.some((a) => a.deliverableId === deliverable.id)) throw new Error('This item was already appealed for this delivery.')

  const ledger: Ledger = structuredClone(job.ledger)
  ledger.items[criterionId].state = 'appeal_review'
  await updateJob(job.id, { ledger })
  await addEvent(job.id, 'freelancer', 'appealed', `${job.freelancerName} appealed "${criterion.title}" (${formatMoney(criterion.amountCents)}): "${reason}"`)

  let review: Awaited<ReturnType<typeof reviewAppeal>>
  try {
    review = await reviewAppeal({ title: job.title, brief: job.brief, criterion, firstReview: first, files: deliverable.files, note: deliverable.note, reason })
  } catch (err) {
    review = { overturn: false, confidence: 0, reasoning: `The appeal review could not complete (${(err as Error).message}).`, injectionDetected: false, model: 'unavailable' }
  }
  const upheld = review.overturn && review.confidence >= MIN_CONFIDENCE && !review.injectionDetected
  const after: Ledger = structuredClone((await fresh(jobId)).ledger)
  after.items[criterionId].appeals.push({
    at: Date.now(), deliverableId: deliverable.id, reason, overturn: review.overturn, confidence: review.confidence, reasoning: review.reasoning,
    injectionDetected: review.injectionDetected, model: review.model, outcome: upheld ? 'upheld' : 'disputed', resolvedAt: upheld ? Date.now() : null,
  })
  after.items[criterionId].state = upheld ? 'held' : 'disputed'
  await updateJob(job.id, { ledger: after })
  await addEvent(
    job.id,
    'ai',
    'appeal_review',
    upheld
      ? `Appeal review: overturned with ${review.confidence}% confidence. ${review.reasoning}`
      : review.injectionDetected
        ? 'Appeal review: the appeal tried to instruct the reviewer. The client decides.'
        : `Appeal review: not overturned (${review.confidence}% confidence). ${review.reasoning} The client decides.`,
  )
  if (upheld) return releaseItems(jobId, [criterionId], { reason: `Appeal upheld for "${criterion.title}".`, by: 'appeal', deliverableId: deliverable.id })
  return fresh(jobId)
}

/** The client settles a disputed item: pay it now, or keep holding it until the artist redelivers. */
export async function resolveDispute(jobId: string, criterionId: string, release: boolean): Promise<JobRecord> {
  const job = await fresh(jobId)
  const criterion = job.criteria.find((c) => c.id === criterionId)
  const item = job.ledger.items[criterionId]
  if (!criterion || item?.state !== 'disputed') throw new Error('This item is not waiting for your decision.')
  const ledger: Ledger = structuredClone(job.ledger)
  const appeal = ledger.items[criterionId].appeals.at(-1)
  if (appeal) Object.assign(appeal, { outcome: release ? 'client_released' : 'client_held', resolvedAt: Date.now() })
  ledger.items[criterionId].state = 'held'
  await updateJob(job.id, { ledger })
  if (!release) {
    await addEvent(job.id, 'client', 'dispute_held', `${job.clientName} kept "${criterion.title}" on hold (${formatMoney(criterion.amountCents)}) until it is redelivered.`)
    return fresh(jobId)
  }
  await addEvent(job.id, 'client', 'dispute_released', `${job.clientName} accepted the appeal for "${criterion.title}".`)
  return releaseItems(jobId, [criterionId], { reason: `${job.clientName} approved "${criterion.title}".`, by: 'client', deliverableId: appeal?.deliverableId ?? null })
}
