import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import {
  appealFn,
  approveOrderFn,
  cancelFn,
  clientReleaseFn,
  clientRequestRevisionFn,
  createOrderFn,
  getJobViewFn,
  resolveDisputeFn,
  retryPayoutFn,
} from '~/server/jobs'
import { MAX_ATTEMPTS, formatMoney, ledgerTotals, type Criterion, type CriterionResult, type Deliverable, type JobView } from '~/lib/types'
import { ConfidenceBar, MethodBadge, ResultIcon, StatusPill } from '~/components/ui'
import { BriefQuote, EvidenceCrop, ItemPill, MoneyBar } from '~/components/money'
import { DeliveryForm } from '~/components/DeliveryForm'

export const Route = createFileRoute('/j/$jobId')({
  validateSearch: (search: Record<string, unknown>) => ({ t: String(search.t ?? '') }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: ({ params, deps }) => getJobViewFn({ data: { id: params.jobId, token: deps.t } }),
  component: JobPage,
})

const FINAL = new Set(['released', 'refunded'])

function JobPage() {
  const view = Route.useLoaderData()
  const router = useRouter()
  const [judging, setJudging] = useState(false)
  const { job } = view
  const appealRunning = Object.values(job.ledger.items).some((i) => i.state === 'appeal_review')

  // Keep both sides live: the client sees the delivery, the verdict and the payments appear without refreshing.
  useEffect(() => {
    if (FINAL.has(job.status) && !judging && !appealRunning) return
    const t = setInterval(() => router.invalidate(), job.status === 'verifying' || appealRunning ? 2500 : 5000)
    return () => clearInterval(t)
  }, [job.status, judging, appealRunning, router])

  const reviewing = judging || job.status === 'verifying'

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {view.demoMode && view.links && <RoleSwitcher view={view} reviewing={reviewing} />}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <StatusPill status={reviewing ? 'verifying' : job.status} partly={ledgerTotals(job.ledger).released > 0} />
            <span className="font-mono text-xs text-ink-400">#{job.id}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{job.title}</h1>
          <p className="mt-1.5 text-ink-500">
            {job.freelancerName} → {job.clientName} · you are the <strong className="text-ink-800">{view.role === 'freelancer' ? 'artist' : 'client'}</strong>
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Escrow</p>
          <p className="mt-1 font-mono text-3xl font-semibold">{formatMoney(job.amountCents, job.currency)}</p>
          <p className="mt-0.5 text-xs text-ink-500">{job.criteria.length} items, paid one by one as they are verified</p>
        </div>
      </div>

      <Progress view={view} reviewing={reviewing} />
      {job.status !== 'awaiting_funding' && (
        <div className="mt-5">
          <MoneyBar ledger={job.ledger} totalCents={job.amountCents} />
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <ItemsCard view={view} reviewing={reviewing} />
          {view.deliverables.length > 0 && <Deliveries view={view} />}
        </div>
        <div className="space-y-6">
          <ActionPanel view={view} reviewing={reviewing} setJudging={setJudging} />
          <Timeline view={view} />
        </div>
      </div>
    </div>
  )
}

/** What a judge should do next, and whether they need to switch sides to do it. */
function demoHint(view: JobView, reviewing = false): { text: string; switchTo: 'client' | 'freelancer' | null } {
  const { status, ledger, criteria } = view.job
  const role = view.role
  const paid = Object.values(ledger.items).filter((i) => i.state === 'released').length
  const disputedId = Object.entries(ledger.items).find(([, i]) => i.state === 'disputed')?.[0]
  const disputed = !!disputedId
  const disputedTitle = criteria.find((c) => c.id === disputedId)?.title ?? 'the appealed item'
  if (reviewing || status === 'verifying') return { text: 'The AI judge is checking every item. This takes about 15 seconds.', switchTo: null }
  if (status === 'awaiting_funding')
    return role === 'client'
      ? { text: 'Step 1 of 3 · Fund the escrow with the yellow PayPal button. Use the sandbox login shown in the panel.', switchTo: null }
      : { text: 'The client funds first.', switchTo: 'client' }
  if (disputed && status !== 'released')
    return role === 'client'
      ? { text: `The artist appealed ${disputedTitle} and the second review was not convinced. Your call: release it or keep holding it (below).`, switchTo: null }
      : { text: 'Your appeal is with the client.', switchTo: 'client' }
  if (status === 'funded')
    return role === 'freelancer'
      ? { text: 'Step 2 of 3 · Submit the "8 of 10 stickers" sample: the AI pays for what it can verify and holds the rest.', switchTo: null }
      : { text: 'Step 2 of 3 · The money is held. Now switch to the artist and deliver the work.', switchTo: 'freelancer' }
  if (status === 'revision_requested')
    return role === 'freelancer'
      ? { text: `Step 3 of 3 · ${paid} of ${criteria.length} items are paid. Appeal a held item, or submit "The last 2 stickers".`, switchTo: null }
      : { text: `${paid} of ${criteria.length} items verified and paid. The rest stays held until it is delivered.`, switchTo: 'freelancer' }
  if (status === 'human_review')
    return role === 'client'
      ? { text: 'The AI handed this delivery to you. Release the held items or ask for changes.', switchTo: null }
      : { text: 'The client decides now.', switchTo: 'client' }
  if (status === 'released') return { text: 'Done. Every item was verified and paid. Open a decision receipt to see why.', switchTo: null }
  return { text: 'This Handshake was stopped. Items already verified stay paid.', switchTo: null }
}

function RoleSwitcher({ view, reviewing }: { view: JobView; reviewing: boolean }) {
  const links = view.links!
  const hint = view.job.isDemo ? demoHint(view, reviewing) : null
  const otherRole = view.role === 'client' ? 'freelancer' : 'client'
  const other = view.role === 'client' ? links.freelancer : links.client
  if (!other) return null
  const url = new URL(other)
  const emphasize = hint?.switchTo === otherRole
  const name = otherRole === 'freelancer' ? 'artist' : 'client'
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-violet-300 bg-violet-50/60 px-4 py-3 text-sm">
      <span className="font-medium text-violet-900">{hint?.text ?? 'Demo mode: you can switch sides to try the whole flow.'}</span>
      <a
        className={
          emphasize
            ? 'inline-flex shrink-0 items-center rounded-lg bg-violet-600 px-3.5 py-2 font-semibold text-white shadow-sm hover:bg-violet-700'
            : 'shrink-0 font-semibold text-violet-700 hover:underline'
        }
        href={url.pathname + url.search}
      >
        {emphasize ? `Switch to ${name} →` : `View as ${name} →`}
      </a>
    </div>
  )
}

function Progress({ view, reviewing }: { view: JobView; reviewing: boolean }) {
  const s = view.job.status
  const { released } = ledgerTotals(view.job.ledger)
  const labels = ['Agreed', 'Funds held', 'Delivered', released && s !== 'released' ? 'Partly paid' : 'Verified', 'Paid']
  const current =
    s === 'awaiting_funding' ? 0 : s === 'funded' ? 1 : reviewing ? 2 : s === 'revision_requested' || s === 'human_review' ? 3 : s === 'released' ? 5 : 1
  if (s === 'refunded') {
    return (
      <p className="mt-8 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
        This Handshake was stopped. {released ? `The client paid ${formatMoney(released)} for verified items; the rest of the hold was released.` : 'The client was not charged.'}
      </p>
    )
  }
  return (
    <ol className="mt-8 grid grid-cols-5 gap-2">
      {labels.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={i}>
            <div className={`h-1.5 rounded-full transition-colors duration-700 ${done ? 'bg-emerald-500' : active ? 'bg-ink-900' : 'bg-ink-100'}`} />
            <p className={`mt-2 text-xs font-semibold ${done ? 'text-emerald-700' : active ? 'text-ink-900' : 'text-ink-400'}`}>{label}</p>
          </li>
        )
      })}
    </ol>
  )
}

/** For each item, the most recent review of it and the delivery it was judged on. */
function latestReviews(deliverables: Deliverable[]) {
  const map = new Map<string, { result: CriterionResult; deliverable: Deliverable }>()
  for (const d of deliverables) {
    for (const r of d.verdict?.results ?? []) if (!map.has(r.id)) map.set(r.id, { result: r, deliverable: d })
  }
  return map
}

function ItemsCard({ view, reviewing }: { view: JobView; reviewing: boolean }) {
  const { job } = view
  const latest = view.deliverables[0] ?? null
  const verdict = reviewing ? null : (latest?.verdict ?? null)
  const reviews = latestReviews(view.deliverables)
  const open = job.criteria.filter((c) => job.ledger.items[c.id]?.state !== 'released')
  const [scan, setScan] = useState(0)
  useEffect(() => {
    if (!reviewing) return
    const t = setInterval(() => setScan((s) => (s + 1) % Math.max(1, open.length)), 900)
    return () => clearInterval(t)
  }, [reviewing, open.length])

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-ink-100 px-6 py-5">
        <p className="eyebrow">The contract · {job.criteria.length} items</p>
        <p className="mt-2 leading-relaxed text-ink-700">{job.contractSummary}</p>
      </div>
      {reviewing && (
        <div className="relative flex items-center gap-3 overflow-hidden bg-violet-50 px-6 py-3 text-sm font-medium text-violet-800">
          <span className="h-2 w-2 animate-ping rounded-full bg-violet-500" />
          The AI judge is checking {open.length === job.criteria.length ? 'every item' : `the ${open.length} items still held`} against the delivery…
        </div>
      )}
      {verdict && (
        <div
          className={`flex flex-wrap items-start justify-between gap-3 px-6 py-4 text-sm ${
            verdict.injectionDetected ? 'bg-rose-50 text-rose-900' : verdict.releasedIds.length ? 'bg-emerald-50 text-emerald-900' : verdict.decision === 'revise' ? 'bg-orange-50 text-orange-900' : 'bg-sky-50 text-sky-900'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{verdict.summary}</p>
            <p className="mt-0.5 opacity-80">{verdict.policyNote}</p>
          </div>
          <ReceiptLink view={view} deliverableId={latest!.id} />
        </div>
      )}
      <ul className="divide-y divide-ink-100">
        {job.criteria.map((c) => (
          <ItemRow key={c.id} view={view} criterion={c} review={reviews.get(c.id) ?? null} scanning={reviewing && open[scan]?.id === c.id} reviewing={reviewing} />
        ))}
      </ul>
    </section>
  )
}

function ItemRow({
  view,
  criterion: c,
  review,
  scanning,
  reviewing,
}: {
  view: JobView
  criterion: Criterion
  review: { result: CriterionResult; deliverable: Deliverable } | null
  scanning: boolean
  reviewing: boolean
}) {
  const item = view.job.ledger.items[c.id]
  const r = review?.result ?? null
  const paid = item?.state === 'released'
  const underReview = reviewing && !paid
  // Seen by the AI but held by the rules (manipulation, low confidence, or a concern): shown as held, not as passed.
  const heldDespitePass = !paid && r?.status === 'pass'
  const icon = paid ? 'pass' : item?.state === 'appeal_review' || scanning ? 'checking' : underReview ? 'pending' : heldDespitePass ? 'unclear' : (r?.status ?? 'pending')
  const verdict = review?.deliverable.verdict
  const heldReason = !heldDespitePass
    ? null
    : verdict?.injectionDetected
      ? 'Held: the delivery tried to instruct the reviewer, so nothing in it is paid automatically.'
      : r!.confidence < 75
        ? 'Held: verified with less than 75% confidence, so a person decides.'
        : 'Held: the reviewer raised a concern, so a person decides.'
  const file = r?.fileIndex ? review!.deliverable.files[r.fileIndex - 1] : null
  const lastAppeal = item?.appeals.at(-1) ?? null
  return (
    <li id={`item-${c.id}`} className={`flex scroll-mt-24 gap-4 px-6 py-4 transition-colors ${scanning ? 'bg-violet-50/60' : ''}`}>
      <ResultIcon status={icon} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-ink-900">{c.title}</p>
          <div className="flex items-center gap-3">
            {r && !underReview ? <ConfidenceBar value={r.confidence} status={paid ? 'pass' : r.status} /> : <MethodBadge method={c.method} />}
            {item && <ItemPill state={item.state} amountCents={c.amountCents} />}
          </div>
        </div>
        <p className="mt-1 text-sm text-ink-600">{c.description}</p>
        <BriefQuote quote={c.sourceQuote} />
        {r && !underReview && (
          <div
            className={`animate-rise mt-2.5 flex gap-3 rounded-lg px-3 py-2.5 text-sm ${
              paid || (r.status === 'pass' && !heldDespitePass) ? 'bg-emerald-50/70 text-emerald-900' : r.status === 'fail' ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900'
            }`}
          >
            {file?.mediaType.startsWith('image/') && <EvidenceCrop file={file} region={r.region} label={`File ${r.fileIndex}`} />}
            <div className="min-w-0">
              <p>{r.evidence}</p>
              {r.quote && <p className="mt-1 text-xs opacity-75">Read in the file: “{r.quote}”</p>}
              {heldReason && <p className="mt-1.5 font-semibold">{heldReason}</p>}
            </div>
          </div>
        )}
        {lastAppeal && (
          <div className="mt-2.5 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5 text-sm text-violet-950">
            <p>
              <span className="font-semibold">Appeal:</span> “{lastAppeal.reason}”
            </p>
            {lastAppeal.outcome === 'pending' || item.state === 'appeal_review' ? (
              <p className="mt-1 text-violet-700">An independent AI reviewer is looking at the delivery again…</p>
            ) : (
              <p className="mt-1">
                <span className="font-semibold">Second review ({lastAppeal.confidence}% confident):</span> {lastAppeal.reasoning}{' '}
                <span className="font-semibold">
                  {
                    {
                      upheld: 'Overturned: the item was paid.',
                      disputed: 'Not overturned: the client decides.',
                      client_released: 'The client accepted the appeal and paid the item.',
                      client_held: 'The client kept the item on hold.',
                      redelivered: 'Settled: the item was delivered again and verified.',
                      pending: '',
                    }[lastAppeal.outcome]
                  }
                </span>
              </p>
            )}
          </div>
        )}
        {!reviewing && <ItemActions view={view} criterion={c} review={review} />}
      </div>
    </li>
  )
}

function ItemActions({ view, criterion: c, review }: { view: JobView; criterion: Criterion; review: { result: CriterionResult; deliverable: Deliverable } | null }) {
  const { job, role } = view
  const token = Route.useSearch().t
  const item = job.ledger.items[c.id]
  const { busy, error, run } = useAction()
  const appeal = useServerFn(appealFn)
  const resolve = useServerFn(resolveDisputeFn)
  const [writing, setWriting] = useState(false)
  const [reason, setReason] = useState('')
  const latest = view.deliverables[0]

  if (role === 'client' && item?.state === 'disputed') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-success !py-2" disabled={busy} onClick={() => run(() => resolve({ data: { id: job.id, token, criterionId: c.id, release: true } }))}>
          Release {formatMoney(c.amountCents)}
        </button>
        <button className="btn-secondary !py-2" disabled={busy} onClick={() => run(() => resolve({ data: { id: job.id, token, criterionId: c.id, release: false } }))}>
          Keep holding
        </button>
        {error && <p className="w-full text-sm text-rose-700">{error}</p>}
      </div>
    )
  }

  const canAppeal =
    role === 'freelancer' &&
    item?.state === 'held' &&
    (job.status === 'revision_requested' || job.status === 'human_review') &&
    review?.deliverable.id === latest?.id &&
    !latest?.verdict?.injectionDetected &&
    !item.appeals.some((a) => a.deliverableId === latest?.id)
  if (!canAppeal) return null
  if (!writing) {
    return (
      <button type="button" className="mt-2.5 text-sm font-semibold text-violet-700 hover:underline" onClick={() => setWriting(true)}>
        Appeal this decision →
      </button>
    )
  }
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-violet-200 bg-white p-3">
      <p className="text-xs text-ink-500">An independent AI reviewer will look at your delivery again. If it is not sure, the client decides.</p>
      <textarea className="input min-h-16" placeholder="Why should this item be paid? Point to where it is in your files." value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button
          className="btn-primary !py-2"
          disabled={busy || reason.trim().length < 10}
          onClick={() => run(() => appeal({ data: { id: job.id, token, criterionId: c.id, reason } }))}
        >
          {busy ? 'Second review running…' : 'Send appeal'}
        </button>
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => setWriting(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  )
}

function ReceiptLink({ view, deliverableId }: { view: JobView; deliverableId: string }) {
  const token = Route.useSearch().t
  return (
    <Link
      to="/j/$jobId/receipt"
      params={{ jobId: view.job.id }}
      search={{ t: token, d: deliverableId }}
      className="shrink-0 rounded-lg border border-current/20 bg-white/70 px-3 py-1.5 text-xs font-semibold hover:bg-white"
    >
      Decision receipt →
    </Link>
  )
}

function useAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await router.invalidate()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

function ActionPanel({ view, reviewing, setJudging }: { view: JobView; reviewing: boolean; setJudging: (v: boolean) => void }) {
  const { job, role } = view
  const token = Route.useSearch().t
  const access = { id: job.id, token }
  const { busy, error, run, setError } = useAction()
  const router = useRouter()
  const createOrder = useServerFn(createOrderFn)
  const approveOrder = useServerFn(approveOrderFn)
  const release = useServerFn(clientReleaseFn)
  const requestRevision = useServerFn(clientRequestRevisionFn)
  const cancel = useServerFn(cancelFn)
  const retryPayout = useServerFn(retryPayoutFn)
  const [revisionMsg, setRevisionMsg] = useState('')
  const latest = view.deliverables[0]?.verdict
  const totals = ledgerTotals(job.ledger)
  const processing = job.ledger.releases.filter((r) => r.payoutStatus === 'processing')
  const heldCount = Object.values(job.ledger.items).filter((i) => i.state !== 'released').length
  const disputedId = Object.entries(job.ledger.items).find(([, i]) => i.state === 'disputed')?.[0]
  const disputed = disputedId ? (job.criteria.find((c) => c.id === disputedId) ?? null) : null

  let body: React.ReactNode = null

  if (reviewing) {
    body = (
      <div className="text-center">
        <div className="relative mx-auto h-20 w-20">
          <span className="absolute inset-0 animate-ping rounded-full bg-violet-200" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-600 text-2xl text-white">⚖</span>
        </div>
        <p className="mt-5 font-semibold">The AI judge is reviewing</p>
        <p className="mt-1 text-sm text-ink-500">Each item it can verify is paid right away. Everything else stays on hold, with a reason.</p>
      </div>
    )
  } else if (job.status === 'awaiting_funding' && role === 'client') {
    body = (
      <>
        <p className="font-semibold">Agree and fund the escrow</p>
        <p className="mt-1 text-sm text-ink-500">
          PayPal holds {formatMoney(job.amountCents)}. You are charged item by item, only for work that is verified, or that you approve yourself.
        </p>
        {view.demoBuyer && (
          <div className="mt-4 rounded-xl border border-dashed border-violet-300 bg-violet-50/60 px-4 py-3 text-sm">
            <p className="font-semibold text-violet-900">Sandbox PayPal login (fake money)</p>
            <SandboxField label="Email" value={view.demoBuyer.email} />
            <SandboxField label="Password" value={view.demoBuyer.password} />
          </div>
        )}
        <div className="mt-5">
          {view.paypalClientId ? (
            <PayPalScriptProvider
              options={{
                clientId: view.paypalClientId,
                intent: 'authorize',
                currency: job.currency,
                components: 'buttons',
                // Sandbox only accepts generated test cards, which confuses testers. Keep the PayPal button only.
                ...(view.paypalEnv === 'sandbox' ? { disableFunding: 'card,paylater' } : {}),
              }}
            >
              <PayPalButtons
                style={{ layout: 'vertical', shape: 'rect', label: 'pay' }}
                createOrder={async () => (await createOrder({ data: access })).orderId}
                onApprove={async (data) => {
                  await run(() => approveOrder({ data: { ...access, orderId: data.orderID } }))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                onError={(err) => setError(String((err as { message?: string }).message ?? err))}
              />
            </PayPalScriptProvider>
          ) : (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Set PAYPAL_CLIENT_ID to enable funding.</p>
          )}
        </div>
      </>
    )
  } else if (job.status === 'awaiting_funding') {
    body = (
      <>
        <p className="font-semibold">Send this link to {job.clientName}</p>
        <p className="mt-1 text-sm text-ink-500">They review the contract and fund it with PayPal. You start working once the money is held.</p>
        {view.links?.client && <CopyField value={view.links.client} />}
      </>
    )
  } else if ((job.status === 'funded' || job.status === 'revision_requested' || job.status === 'human_review') && role === 'freelancer') {
    const partly = totals.released > 0
    body = (
      <>
        {partly && <PaidSummary view={view} />}
        <p className={`font-semibold ${partly ? 'mt-5' : ''}`}>{job.status === 'funded' ? 'Deliver your work' : `Deliver the ${heldCount} ${heldCount === 1 ? 'item' : 'items'} still held`}</p>
        <p className="mt-1 text-sm text-ink-500">
          {job.status === 'funded'
            ? `${formatMoney(job.amountCents)} is held for you. Each item the AI verifies is paid right away.`
            : (latest?.messageToFreelancer ?? `${formatMoney(totals.held)} is still held for you.`)}
        </p>
        {job.status === 'human_review' && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">The client is deciding on this delivery. You can still send the missing items.</p>}
        <p className="mt-1 text-xs text-ink-400">Attempt {Math.min(job.attempts + 1, MAX_ATTEMPTS)} of {MAX_ATTEMPTS}</p>
        <div className="mt-5">
          <DeliveryForm
            jobId={job.id}
            token={token}
            showSamples={view.demoMode && job.isDemo}
            onStart={() => {
              setJudging(true)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            onDone={async () => {
              await router.invalidate()
              setJudging(false)
            }}
          />
        </div>
      </>
    )
  } else if (disputed && role === 'client' && job.status !== 'released') {
    body = (
      <>
        {totals.released > 0 && <PaidSummary view={view} />}
        <p className={`font-semibold ${totals.released ? 'mt-5' : ''}`}>Your call on {disputed.title}</p>
        <p className="mt-1 text-sm text-ink-500">
          {job.freelancerName} appealed it and the second review was not convinced. Release its {formatMoney(disputed.amountCents)}, or keep holding it until it is delivered.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <a className="btn-primary text-center" href={`#item-${disputed.id}`}>
            Decide on {disputed.title} ↓
          </a>
          <button className="btn-ghost text-sm" disabled={busy} onClick={() => run(() => release({ data: access }))}>
            Or approve everything still held ({formatMoney(totals.held)})
          </button>
        </div>
      </>
    )
  } else if ((job.status === 'funded' || job.status === 'revision_requested') && role === 'client') {
    body = (
      <>
        {totals.released > 0 && <PaidSummary view={view} />}
        <p className={`font-semibold ${totals.released ? 'mt-5' : ''}`}>{job.status === 'funded' ? `Waiting for ${job.freelancerName}'s delivery` : `${heldCount} ${heldCount === 1 ? 'item' : 'items'} still held`}</p>
        <p className="mt-1 text-sm text-ink-500">
          {job.status === 'funded' ? 'Your money is held by PayPal. You are charged only for items that are verified.' : (latest?.messageToClient ?? `${formatMoney(totals.held)} stays held until the rest is delivered.`)}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button className="btn-success" disabled={busy} onClick={() => run(() => release({ data: access }))}>
            Approve and release {formatMoney(totals.held)} now
          </button>
          {job.status === 'funded' && job.attempts === 0 && (
            <button className="btn-ghost" disabled={busy} onClick={() => run(() => cancel({ data: access }))}>
              Cancel and release my hold
            </button>
          )}
        </div>
      </>
    )
  } else if (job.status === 'human_review' && role === 'client') {
    body = (
      <>
        {totals.released > 0 && <PaidSummary view={view} />}
        <p className={`font-semibold ${totals.released ? 'mt-5' : ''}`}>Your call on the {heldCount} held {heldCount === 1 ? 'item' : 'items'}</p>
        <p className="mt-1 text-sm text-ink-500">{latest?.messageToClient ?? 'The AI could not decide on its own. Review the delivery and decide.'}</p>
        <div className="mt-5 space-y-3">
          <button className="btn-success w-full" disabled={busy} onClick={() => run(() => release({ data: access }))}>
            Approve and pay {formatMoney(totals.held)}
          </button>
          <textarea className="input min-h-20" placeholder="What should be changed?" value={revisionMsg} onChange={(e) => setRevisionMsg(e.target.value)} />
          <button className="btn-secondary w-full" disabled={busy || revisionMsg.trim().length < 3} onClick={() => run(() => requestRevision({ data: { ...access, message: revisionMsg } }))}>
            Ask for changes
          </button>
        </div>
      </>
    )
  } else if (job.status === 'released') {
    body = (
      <div className="text-center">
        <div className="animate-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl text-white shadow-lg shadow-emerald-500/30">✓</div>
        <p className="mt-5 text-xl font-bold">{role === 'freelancer' ? 'Every item is paid' : 'Work delivered and paid'}</p>
        <p className="mt-1 font-mono text-3xl font-semibold text-emerald-600">{formatMoney(job.ledger.releases.reduce((n, r) => n + r.payoutCents, 0))}</p>
        <p className="mt-2 text-sm text-ink-500">
          Sent to {job.freelancerEmail} via PayPal in {job.ledger.releases.length} {job.ledger.releases.length === 1 ? 'payment' : 'payments'}. Handshake fee {view.feePercent}%.
        </p>
        <div className="mt-5 text-left">
          <PaidSummary view={view} />
        </div>
      </div>
    )
  } else if (job.status === 'refunded') {
    body = (
      <>
        <p className="font-semibold">Stopped</p>
        <p className="mt-1 text-sm text-ink-600">
          {totals.released
            ? `${formatMoney(totals.released)} was paid for verified items. PayPal released the remaining ${formatMoney(totals.voided)} back to the client.`
            : 'PayPal released the hold. Nobody was charged.'}
        </p>
      </>
    )
  }

  return (
    <section className="card p-6">
      {body}
      {processing.length > 0 && !reviewing && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p>
            Payout of {formatMoney(processing.reduce((n, r) => n + r.payoutCents, 0))} is processing. The money was captured; PayPal has not confirmed the payout yet.
          </p>
          <button className="mt-2 font-semibold underline" disabled={busy} onClick={() => run(() => retryPayout({ data: access }))}>
            Retry payout
          </button>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    </section>
  )
}

/** The PayPal payments made so far, one line per release. */
function PaidSummary({ view }: { view: JobView }) {
  const { job } = view
  if (!job.ledger.releases.length) return null
  return (
    <div className="rounded-xl bg-emerald-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Paid so far</p>
      <ul className="mt-2 space-y-1.5">
        {job.ledger.releases.map((r) => (
          <li key={r.seq} className="flex items-baseline justify-between gap-3 text-sm text-emerald-950">
            <span>
              {r.itemIds.length} {r.itemIds.length === 1 ? 'item' : 'items'} · {r.reason.replace(/\.$/, '')}
            </span>
            <span className="shrink-0 font-mono font-semibold">{formatMoney(r.amountCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SandboxField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <span className="text-violet-800">
        {label}: <span className="font-mono text-xs text-violet-950">{value}</span>
      </span>
      <button
        type="button"
        className="text-xs font-semibold text-violet-700 hover:underline"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-4 flex gap-2">
      <input readOnly className="input font-mono text-xs" value={value} onFocus={(e) => e.target.select()} />
      <button
        className="btn-secondary shrink-0 !px-3"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Deliveries({ view }: { view: JobView }) {
  const { deliverables } = view
  return (
    <section className="card p-6">
      <p className="eyebrow">Deliveries</p>
      <div className="mt-4 space-y-5">
        {deliverables.map((d, i) => {
          const v = d.verdict
          const paid = v ? view.job.criteria.filter((c) => v.releasedIds.includes(c.id)).reduce((n, c) => n + c.amountCents, 0) : 0
          return (
            <div key={d.id} className="rounded-xl border border-ink-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">Delivery #{deliverables.length - i}</span>
                <span className="text-ink-500">
                  {v ? `${v.releasedIds.length} of ${v.results.length} verified · ${formatMoney(paid)} released` : 'Reviewing…'} · {new Date(d.createdAt).toLocaleString()}
                </span>
              </div>
              {d.files.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {d.files.map((f) =>
                    f.mediaType.startsWith('image/') ? (
                      <a key={f.name} href={f.dataUrl} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
                        <img src={f.dataUrl} alt={f.name} className="aspect-square w-full object-cover transition group-hover:scale-105" />
                      </a>
                    ) : (
                      <a key={f.name} href={f.dataUrl} download={f.name} className="flex aspect-square items-center justify-center rounded-lg border border-ink-100 bg-ink-50 p-2 text-center text-xs font-medium text-ink-600">
                        📄 {f.name}
                      </a>
                    ),
                  )}
                </div>
              )}
              {d.link && (
                <a href={d.link} target="_blank" rel="noreferrer" className="mt-3 block truncate text-sm font-medium text-brand-600 hover:underline">
                  {d.link}
                </a>
              )}
              {d.note && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-600">{d.note}</p>}
              {v && (
                <div className="mt-3">
                  <ReceiptLink view={view} deliverableId={d.id} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const actorStyle: Record<string, string> = {
  ai: 'bg-violet-500',
  paypal: 'bg-brand-500',
  client: 'bg-ink-400',
  freelancer: 'bg-ink-700',
  system: 'bg-amber-400',
}

function Timeline({ view }: { view: JobView }) {
  return (
    <section className="card p-6">
      <p className="eyebrow">Audit trail</p>
      <ol className="mt-4 space-y-4">
        {[...view.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${actorStyle[e.actor] ?? 'bg-ink-300'}`} />
            <div>
              <p className="text-sm text-ink-800">{e.message}</p>
              <p className="mt-0.5 text-xs text-ink-400">
                {e.actor === 'ai' ? 'AI judge' : e.actor === 'paypal' ? 'PayPal' : e.actor === 'freelancer' ? 'artist' : e.actor} · {new Date(e.at).toLocaleTimeString()}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Link to="/dashboard" className="mt-5 inline-block text-xs font-semibold text-ink-400 hover:text-ink-700">
        All commissions →
      </Link>
    </section>
  )
}
