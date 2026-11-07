// Seeds a LOCAL database with demo jobs in several states, using the real AI review on the sample
// files, so the job page and receipts can be worked on without going through PayPal.
// PayPal ids written here are local placeholders (LOCAL-...). Refuses to run against a hosted database.
// Usage: OPENROUTER_API_KEY=... DATABASE_URL=file:local.db npx tsx scripts/seed-local.ts
import { readFileSync } from 'node:fs'

if (!(process.env.DATABASE_URL ?? 'file:').startsWith('file:')) throw new Error('seed-local only writes to a local file database.')

const { judgeDelivery } = await import('../src/server/ai')
const { DEMO, DEMO_CRITERIA } = await import('../src/server/demo')
const { emptyLedger } = await import('../src/lib/types')
const { insertJob, insertDeliverable, setDeliverableVerdict, addEvent, updateJob, getJob } = await import('../src/server/db')
const { payoutFor } = await import('../src/server/escrow')
import type { DeliverableFile, JobRecord, Ledger } from '../src/lib/types'

const file = (name: string): DeliverableFile => ({ name, mediaType: 'image/png', dataUrl: 'data:image/png;base64,' + readFileSync(`public/samples/${name}`).toString('base64') })
const id = (n: number) => crypto.randomUUID().replace(/-/g, '').slice(0, n)

async function job(): Promise<JobRecord> {
  const now = Date.now()
  const j: JobRecord = {
    id: id(10), createdAt: now, updatedAt: now, title: DEMO.title, brief: DEMO.brief, amountCents: DEMO.amountCents, currency: 'USD',
    freelancerName: DEMO.freelancerName, freelancerEmail: 'amira@example.com', clientName: DEMO.clientName, clientEmail: 'youssef@example.com',
    clientToken: id(24), freelancerToken: id(24), status: 'funded', contractSummary: DEMO.summary, criteria: DEMO_CRITERIA,
    paypalOrderId: 'LOCAL-ORDER', paypalAuthorizationId: 'LOCAL-AUTH', paypalCaptureId: null, paypalPayoutBatchId: null, attempts: 0, isDemo: true,
    ledger: emptyLedger(DEMO_CRITERIA),
  }
  await insertJob(j)
  await addEvent(j.id, 'paypal', 'funded', '$400.00 is now held by PayPal (local seed).')
  return j
}

/** Runs the real AI review and records a release with placeholder PayPal ids. */
async function deliver(j: JobRecord, files: DeliverableFile[], note: string, attempts: number) {
  const fresh = (await getJob(j.id))!
  const open = fresh.criteria.filter((c) => fresh.ledger.items[c.id].state !== 'released')
  const paid = fresh.criteria.filter((c) => fresh.ledger.items[c.id].state === 'released')
  const d = { id: id(12), jobId: j.id, createdAt: Date.now(), note, link: null, files, verdict: null }
  await insertDeliverable(d)
  const v = await judgeDelivery({ title: j.title, brief: j.brief, contractSummary: j.contractSummary, criteria: open, alreadyPaid: paid, note, link: null, files, attempts, maxAttempts: 3 })
  await setDeliverableVerdict(d.id, v)
  await addEvent(j.id, 'ai', 'verdict', `AI review: ${v.policyNote}`)
  const ledger: Ledger = structuredClone(fresh.ledger)
  if (v.releasedIds.length) {
    const seq = ledger.releases.length + 1
    const amount = v.releasedIds.reduce((n, cid) => n + ledger.items[cid].amountCents, 0)
    const final = open.every((c) => v.releasedIds.includes(c.id))
    ledger.releases.push({ seq, at: Date.now(), itemIds: v.releasedIds, amountCents: amount, captureId: `LOCAL-CAPTURE-${seq}`, finalCapture: final, payoutCents: payoutFor(amount), payoutBatchId: `LOCAL-BATCH-${seq}`, payoutStatus: 'paid', reason: `AI verified ${v.releasedIds.length} items.`, deliverableId: d.id })
    for (const cid of v.releasedIds) Object.assign(ledger.items[cid], { state: 'released', releasedAt: Date.now(), releasedBy: 'ai', releaseSeq: seq })
    await addEvent(j.id, 'paypal', 'captured', `PayPal captured $${amount / 100} (local seed).`)
  }
  const done = Object.values(ledger.items).every((i) => i.state === 'released')
  await updateJob(j.id, { ledger, attempts, status: done ? 'released' : v.decision === 'revise' ? 'revision_requested' : 'human_review' })
  return { d, v }
}

const base = 'http://localhost:3000/j'
const partial = await job()
await deliver(partial, [file('stickers-8-of-10.png')], 'First 8 stickers of the pack. Sleepy and GG are coming next.', 1)

const disputed = await job()
const { d } = await deliver(disputed, [file('stickers-8-of-10.png')], 'First 8 stickers of the pack.', 1)
const dj = (await getJob(disputed.id))!
const ledger = structuredClone(dj.ledger)
ledger.items.c7.state = 'disputed'
ledger.items.c7.appeals.push({ at: Date.now(), deliverableId: d.id, reason: 'Sleepy is drawn, it is the cat with closed eyes in the second row.', overturn: false, confidence: 88, reasoning: 'File 1 has 8 stickers: Sad, Angry, Wow and Cool on the second row. None has closed eyes or "Zzz", and no sticker is captioned Sleepy.', injectionDetected: false, model: 'local seed', outcome: 'disputed', resolvedAt: null })
await updateJob(disputed.id, { ledger })

const complete = await job()
await deliver(complete, [file('stickers-8-of-10.png')], 'First 8 stickers.', 1)
await deliver(complete, [file('stickers-last-2.png')], 'Here are the last two: Sleepy and GG.', 2)

for (const [name, j] of [['partial', partial], ['disputed', disputed], ['complete', complete]] as const) {
  const r = (await getJob(j.id))!
  console.log(`${name}: client ${base}/${r.id}?t=${r.clientToken}  artist ${base}/${r.id}?t=${r.freelancerToken}`)
}
