import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createJobFn, draftContractFn } from '~/server/jobs'
import type { CheckMethod, Criterion } from '~/lib/types'
import { MethodBadge } from '~/components/ui'

export const Route = createFileRoute('/new')({ component: NewHandshake })

const example = {
  title: 'Brand identity for Nour Café',
  amount: '450',
  brief: `Nour is a specialty coffee shop opening in Tunis. I need a logo and a small brand kit.
- A logo mark plus wordmark, in full color, black and white versions
- Main color should be a warm terracotta, with a cream secondary color
- Must still be readable as a small app icon / favicon
- Deliver SVG and PNG files
- A one-page brand sheet showing the colors (with hex codes) and the fonts used`,
  freelancerName: 'Amira Ben Salah',
  freelancerEmail: 'amira@example.com',
  clientName: 'Youssef Trabelsi',
  clientEmail: 'youssef@example.com',
}

const methods: { value: CheckMethod; label: string }[] = [
  { value: 'visual', label: 'Checked from images' },
  { value: 'content', label: 'Checked from text or files' },
  { value: 'link', label: 'Checked by opening a link' },
  { value: 'manual', label: 'Needs a human' },
]

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
        done ? 'bg-emerald-500 text-white' : active ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-400'
      }`}
    >
      {done ? '✓' : n}
    </span>
  )
}

function NewHandshake() {
  const navigate = useNavigate()
  const draft = useServerFn(draftContractFn)
  const create = useServerFn(createJobFn)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [amount, setAmount] = useState('')
  const [summary, setSummary] = useState('')
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [freelancerName, setFreelancerName] = useState('')
  const [freelancerEmail, setFreelancerEmail] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')

  const amountNumber = Number(amount)

  function fillExample() {
    setTitle(example.title)
    setBrief(example.brief)
    setAmount(example.amount)
    setFreelancerName(example.freelancerName)
    setFreelancerEmail(example.freelancerEmail)
    setClientName(example.clientName)
    setClientEmail(example.clientEmail)
  }

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onDraft() {
    const res = await run(() => draft({ data: { title, brief, amount: amountNumber } }))
    if (res) {
      setSummary(res.summary)
      setCriteria(res.criteria)
      setStep(2)
    }
  }

  async function onCreate() {
    const res = await run(() =>
      create({
        data: { title, brief, amount: amountNumber, summary, criteria, freelancerName, freelancerEmail, clientName, clientEmail },
      }),
    )
    if (res) navigate({ to: '/j/$jobId', params: { jobId: res.id }, search: { t: res.token } })
  }

  const updateCriterion = (id: string, patch: Partial<Criterion>) =>
    setCriteria((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const briefValid = title.trim().length >= 3 && brief.trim().length >= 20 && amountNumber > 0 && amountNumber <= 10000
  const partiesValid = [freelancerName, freelancerEmail, clientName, clientEmail].every((v) => v.trim()) && criteria.length > 0

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">New Handshake</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {step === 1 ? 'What is the job?' : step === 2 ? 'Review the contract' : 'Who is involved?'}
          </h1>
        </div>
        {step === 1 && (
          <button type="button" onClick={fillExample} className="btn-ghost">
            Use an example
          </button>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3 text-sm font-medium text-ink-500">
        <StepDot n={1} active={step === 1} done={step > 1} /> Brief
        <span className="h-px w-8 bg-ink-200" />
        <StepDot n={2} active={step === 2} done={step > 2} /> Contract
        <span className="h-px w-8 bg-ink-200" />
        <StepDot n={3} active={step === 3} done={false} /> Parties
      </div>

      {error && <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {step === 1 && (
        <div className="card mt-8 space-y-5 p-7">
          <div>
            <label className="label" htmlFor="title">Job title</label>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Landing page for a dental clinic" />
          </div>
          <div>
            <label className="label" htmlFor="brief">The brief</label>
            <textarea
              id="brief"
              className="input min-h-48 leading-relaxed"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Paste what the client asked for: the message, the email, the spec. Messy is fine."
            />
          </div>
          <div className="max-w-xs">
            <label className="label" htmlFor="amount">Price (USD)</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">$</span>
              <input id="amount" className="input pl-7" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="450" />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary" disabled={!briefValid || busy} onClick={onDraft}>
              {busy ? <Spinner label="AI is writing the contract…" /> : 'Draft the contract with AI →'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-8 space-y-5">
          <div className="card p-7">
            <label className="label" htmlFor="summary">Summary both sides will agree to</label>
            <textarea id="summary" className="input min-h-20 leading-relaxed" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="card divide-y divide-ink-100">
            <div className="flex items-center justify-between px-7 py-5">
              <div>
                <p className="font-semibold">Acceptance criteria</p>
                <p className="text-sm text-ink-500">The AI judge checks the delivery against exactly these. Edit anything.</p>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  setCriteria((cs) => [...cs, { id: `n${Date.now()}`, title: '', description: '', method: 'visual' }])
                }
              >
                + Add
              </button>
            </div>
            {criteria.map((c, i) => (
              <div key={c.id} className="grid gap-3 px-7 py-5 sm:grid-cols-[2rem_1fr]">
                <span className="mt-2 font-mono text-sm text-ink-400">{String(i + 1).padStart(2, '0')}</span>
                <div className="space-y-2.5">
                  <input className="input font-semibold" value={c.title} onChange={(e) => updateCriterion(c.id, { title: e.target.value })} />
                  <textarea className="input min-h-16 text-ink-700" value={c.description} onChange={(e) => updateCriterion(c.id, { description: e.target.value })} />
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <MethodBadge method={c.method} />
                      <select
                        className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700"
                        value={c.method}
                        onChange={(e) => updateCriterion(c.id, { method: e.target.value as CheckMethod })}
                      >
                        {methods.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="text-xs font-semibold text-ink-400 hover:text-rose-600" onClick={() => setCriteria((cs) => cs.filter((x) => x.id !== c.id))}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={onDraft}>
                {busy ? <Spinner label="Redrafting…" /> : 'Redraft'}
              </button>
              <button type="button" className="btn-primary" disabled={!criteria.length || criteria.some((c) => !c.title.trim())} onClick={() => setStep(3)}>
                Looks right →
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card mt-8 p-7">
          <div className="grid gap-6 sm:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="eyebrow mb-3">You (freelancer)</legend>
              <input className="input" placeholder="Your name" value={freelancerName} onChange={(e) => setFreelancerName(e.target.value)} />
              <input className="input" type="email" placeholder="PayPal email for payouts" value={freelancerEmail} onChange={(e) => setFreelancerEmail(e.target.value)} />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="eyebrow mb-3">Your client</legend>
              <input className="input" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              <input className="input" type="email" placeholder="Client email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
            </fieldset>
          </div>
          <div className="mt-7 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            You will get a private link to send your client. They review this contract and fund{' '}
            <strong className="text-ink-900">${amountNumber.toFixed(2)}</strong> through PayPal. The money is held until the work is verified.
          </div>
          <div className="mt-7 flex justify-between">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <button type="button" className="btn-primary" disabled={!partiesValid || busy} onClick={onCreate}>
              {busy ? <Spinner label="Creating…" /> : 'Create Handshake'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      {label}
    </>
  )
}
