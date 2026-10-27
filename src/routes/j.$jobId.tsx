import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import {
  approveOrderFn,
  cancelFn,
  clientReleaseFn,
  clientRequestRevisionFn,
  createOrderFn,
  getJobViewFn,
  retryPayoutFn,
} from '~/server/jobs'
import { MAX_ATTEMPTS, formatMoney, type Deliverable, type JobView } from '~/lib/types'
import { ConfidenceBar, MethodBadge, ResultIcon, StatusPill } from '~/components/ui'
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

  // Keep both sides live: the client sees the delivery and the verdict appear without refreshing.
  useEffect(() => {
    if (FINAL.has(job.status) && !judging) return
    const t = setInterval(() => router.invalidate(), job.status === 'verifying' ? 2500 : 5000)
    return () => clearInterval(t)
  }, [job.status, judging, router])

  const latest = view.deliverables[0] ?? null
  const reviewing = judging || job.status === 'verifying'

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {view.demoMode && view.links && <RoleSwitcher view={view} />}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <StatusPill status={reviewing ? 'verifying' : job.status} />
            <span className="font-mono text-xs text-ink-400">#{job.id}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{job.title}</h1>
          <p className="mt-1.5 text-ink-500">
            {job.freelancerName} → {job.clientName} · you are the <strong className="text-ink-800">{view.role}</strong>
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Escrow</p>
          <p className="mt-1 font-mono text-3xl font-semibold">{formatMoney(job.amountCents, job.currency)}</p>
        </div>
      </div>

      <Progress view={view} reviewing={reviewing} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <ContractCard view={view} latest={reviewing ? null : latest} reviewing={reviewing} />
          {view.deliverables.length > 0 && <Deliveries deliverables={view.deliverables} criteria={view.job.criteria} />}
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
function demoHint(view: JobView): { text: string; switchTo: 'client' | 'freelancer' | null } {
  const { status } = view.job
  const role = view.role
  if (status === 'awaiting_funding')
    return role === 'client'
      ? { text: 'Step 1 of 3 · Fund the escrow with the yellow PayPal button. Use the sandbox login shown in the panel.', switchTo: null }
      : { text: 'The client funds first.', switchTo: 'client' }
  if (status === 'funded' || status === 'revision_requested')
    return role === 'freelancer'
      ? {
          text:
            status === 'funded'
              ? 'Step 2 of 3 · Pick a sample delivery and submit it. Try "Incomplete" or "Cheating" first to see the AI push back, then "Complete" to get paid.'
              : 'The AI asked for fixes. Submit the "Complete" sample to pass.',
          switchTo: null,
        }
      : { text: 'Step 2 of 3 · The money is held. Now switch to the freelancer and deliver the work.', switchTo: 'freelancer' }
  if (status === 'verifying') return { text: 'The AI judge is reviewing the delivery. This takes about a minute.', switchTo: null }
  if (status === 'human_review')
    return role === 'client'
      ? { text: 'Step 3 of 3 · The AI handed this to you. Approve and pay, or ask for changes.', switchTo: null }
      : { text: 'The client decides now.', switchTo: 'client' }
  if (status === 'released') return { text: 'Done. PayPal captured the payment and paid the freelancer. Check the audit trail.', switchTo: null }
  return { text: 'This Handshake was cancelled.', switchTo: null }
}

function RoleSwitcher({ view }: { view: JobView }) {
  const links = view.links!
  const hint = view.job.isDemo ? demoHint(view) : null
  const otherRole = view.role === 'client' ? 'freelancer' : 'client'
  const other = view.role === 'client' ? links.freelancer : links.client
  if (!other) return null
  const url = new URL(other)
  const emphasize = hint?.switchTo === otherRole
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
        {emphasize ? `Switch to ${otherRole} →` : `View as ${otherRole} →`}
      </a>
    </div>
  )
}

function Progress({ view, reviewing }: { view: JobView; reviewing: boolean }) {
  const s = view.job.status
  const order = ['awaiting_funding', 'funded', 'delivered', 'verified', 'released']
  const current =
    s === 'awaiting_funding' ? 0 : s === 'funded' ? 1 : reviewing ? 2 : s === 'revision_requested' || s === 'human_review' ? 3 : s === 'released' ? 5 : 1
  const labels = ['Agreed', 'Funds held', 'Delivered', 'Verified', 'Paid']
  if (s === 'refunded') {
    return <p className="mt-8 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">This Handshake was cancelled. The client was not charged.</p>
  }
  return (
    <ol className="mt-8 grid grid-cols-5 gap-2">
      {order.map((key, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={key}>
            <div className={`h-1.5 rounded-full transition-colors duration-700 ${done ? 'bg-emerald-500' : active ? 'bg-ink-900' : 'bg-ink-100'}`} />
            <p className={`mt-2 text-xs font-semibold ${done ? 'text-emerald-700' : active ? 'text-ink-900' : 'text-ink-400'}`}>{labels[i]}</p>
          </li>
        )
      })}
    </ol>
  )
}

function ContractCard({ view, latest, reviewing }: { view: JobView; latest: Deliverable | null; reviewing: boolean }) {
  const verdict = latest?.verdict ?? null
  const results = new Map(verdict?.results.map((r) => [r.id, r]))
  const [scan, setScan] = useState(0)
  useEffect(() => {
    if (!reviewing) return
    const t = setInterval(() => setScan((s) => (s + 1) % view.job.criteria.length), 1400)
    return () => clearInterval(t)
  }, [reviewing, view.job.criteria.length])

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-ink-100 px-6 py-5">
        <p className="eyebrow">The contract</p>
        <p className="mt-2 leading-relaxed text-ink-700">{view.job.contractSummary}</p>
      </div>
      {reviewing && (
        <div className="relative flex items-center gap-3 overflow-hidden bg-violet-50 px-6 py-3 text-sm font-medium text-violet-800">
          <span className="h-2 w-2 animate-ping rounded-full bg-violet-500" />
          The AI judge is inspecting the delivery against every criterion…
        </div>
      )}
      {verdict && !reviewing && (
        <div
          className={`px-6 py-4 text-sm ${
            verdict.decision === 'release' ? 'bg-emerald-50 text-emerald-900' : verdict.decision === 'revise' ? 'bg-orange-50 text-orange-900' : 'bg-sky-50 text-sky-900'
          }`}
        >
          <p className="font-semibold">{verdict.summary}</p>
          <p className="mt-0.5 opacity-80">{verdict.policyNote}</p>
        </div>
      )}
      <ul className="divide-y divide-ink-100">
        {view.job.criteria.map((c, i) => {
          const r = results.get(c.id)
          const state = reviewing ? (i === scan ? 'checking' : 'pending') : (r?.status ?? 'pending')
          return (
            <li key={c.id} className={`relative flex gap-4 px-6 py-4 transition-colors ${reviewing && i === scan ? 'bg-violet-50/50' : ''}`}>
              <ResultIcon status={state} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink-900">{c.title}</p>
                  {r && !reviewing ? <ConfidenceBar value={r.confidence} status={r.status} /> : <MethodBadge method={c.method} />}
                </div>
                <p className="mt-1 text-sm text-ink-600">{c.description}</p>
                {r && !reviewing && (
                  <p
                    className={`animate-rise mt-2 rounded-lg px-3 py-2 text-sm ${
                      r.status === 'pass' ? 'bg-emerald-50/70 text-emerald-900' : r.status === 'fail' ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900'
                    }`}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {r.evidence}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
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

  const payout = Math.floor(job.amountCents * (1 - view.feePercent / 100))
  const paidOut = view.events.some((e) => e.type === 'paid_out')

  let body: React.ReactNode = null

  if (reviewing) {
    body = (
      <div className="text-center">
        <div className="relative mx-auto h-20 w-20">
          <span className="absolute inset-0 animate-ping rounded-full bg-violet-200" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-600 text-2xl text-white">⚖</span>
        </div>
        <p className="mt-5 font-semibold">The AI judge is reviewing</p>
        <p className="mt-1 text-sm text-ink-500">Checking every file against the contract. This takes about a minute. The money stays on hold.</p>
      </div>
    )
  } else if (job.status === 'awaiting_funding' && role === 'client') {
    body = (
      <>
        <p className="font-semibold">Agree and fund the escrow</p>
        <p className="mt-1 text-sm text-ink-500">
          PayPal holds {formatMoney(job.amountCents)}. You are only charged when the delivery passes every criterion, or when you
          approve it yourself.
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
  } else if ((job.status === 'funded' || job.status === 'revision_requested') && role === 'freelancer') {
    body = (
      <>
        <p className="font-semibold">{job.status === 'funded' ? 'Deliver your work' : 'Fix and resubmit'}</p>
        <p className="mt-1 text-sm text-ink-500">
          {job.status === 'funded'
            ? `${formatMoney(job.amountCents)} is held for you. Upload the work and the AI judge checks it right away.`
            : latest?.messageToFreelancer}
        </p>
        <p className="mt-1 text-xs text-ink-400">Attempt {job.attempts + 1} of {MAX_ATTEMPTS}</p>
        <div className="mt-5">
          <DeliveryForm
            jobId={job.id}
            token={token}
            showSamples={view.demoMode && job.isDemo}
            onStart={() => setJudging(true)}
            onDone={async () => {
              await router.invalidate()
              setJudging(false)
            }}
          />
        </div>
      </>
    )
  } else if (job.status === 'funded' || job.status === 'revision_requested') {
    body = (
      <>
        <p className="font-semibold">{job.status === 'funded' ? `Waiting for ${job.freelancerName}'s delivery` : 'Changes requested'}</p>
        <p className="mt-1 text-sm text-ink-500">
          {job.status === 'funded'
            ? 'Your money is held by PayPal. Nothing is charged until the work is verified.'
            : latest?.messageToClient}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button className="btn-success" disabled={busy} onClick={() => run(() => release({ data: access }))}>
            Approve and release now
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
        <p className="font-semibold">Your call</p>
        <p className="mt-1 text-sm text-ink-500">{latest?.messageToClient ?? 'The AI could not decide on its own. Review the delivery and decide.'}</p>
        <div className="mt-5 space-y-3">
          <button className="btn-success w-full" disabled={busy} onClick={() => run(() => release({ data: access }))}>
            Approve and pay {formatMoney(job.amountCents)}
          </button>
          <textarea className="input min-h-20" placeholder="What should be changed?" value={revisionMsg} onChange={(e) => setRevisionMsg(e.target.value)} />
          <button className="btn-secondary w-full" disabled={busy || revisionMsg.trim().length < 3} onClick={() => run(() => requestRevision({ data: { ...access, message: revisionMsg } }))}>
            Ask for changes
          </button>
        </div>
      </>
    )
  } else if (job.status === 'human_review') {
    body = (
      <>
        <p className="font-semibold">With {job.clientName} for a decision</p>
        <p className="mt-1 text-sm text-ink-500">{latest?.messageToFreelancer ?? 'The client will review your delivery.'}</p>
        <button className="btn-ghost mt-4" disabled={busy} onClick={() => run(() => cancel({ data: access }))}>
          Withdraw and refund the client
        </button>
      </>
    )
  } else if (job.status === 'released') {
    body = (
      <div className="text-center">
        <div className="animate-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl text-white shadow-lg shadow-emerald-500/30">✓</div>
        <p className="mt-5 text-xl font-bold">{role === 'freelancer' ? 'You got paid' : 'Work delivered and paid'}</p>
        <p className="mt-1 font-mono text-3xl font-semibold text-emerald-600">{formatMoney(payout)}</p>
        <p className="mt-2 text-sm text-ink-500">
          {paidOut ? `Sent to ${job.freelancerEmail} via PayPal.` : 'Payment captured. Payout pending.'} Handshake fee {view.feePercent}%.
        </p>
        {!paidOut && (
          <button className="btn-secondary mt-4" disabled={busy} onClick={() => run(() => retryPayout({ data: access }))}>
            Retry payout
          </button>
        )}
      </div>
    )
  } else if (job.status === 'refunded') {
    body = <p className="text-sm text-ink-600">Cancelled. PayPal released the hold. Nobody was charged.</p>
  }

  return (
    <section className="card p-6">
      {body}
      {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    </section>
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

function Deliveries({ deliverables, criteria }: { deliverables: Deliverable[]; criteria: JobView['job']['criteria'] }) {
  return (
    <section className="card p-6">
      <p className="eyebrow">Deliveries</p>
      <div className="mt-4 space-y-5">
        {deliverables.map((d, i) => {
          const passed = d.verdict?.results.filter((r) => r.status === 'pass').length ?? 0
          return (
            <div key={d.id} className="rounded-xl border border-ink-100 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Delivery #{deliverables.length - i}</span>
                <span className="text-ink-500">
                  {d.verdict ? `${passed}/${criteria.length} passed` : 'Reviewing…'} · {new Date(d.createdAt).toLocaleString()}
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
                {e.actor === 'ai' ? 'AI judge' : e.actor === 'paypal' ? 'PayPal' : e.actor} · {new Date(e.at).toLocaleTimeString()}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Link to="/dashboard" className="mt-5 inline-block text-xs font-semibold text-ink-400 hover:text-ink-700">
        All Handshakes →
      </Link>
    </section>
  )
}
