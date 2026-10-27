import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

const demoChecks = [
  { title: 'Logo in 3 color variants', evidence: 'File 1 shows full-color, black and white versions.' },
  { title: 'Uses brand blue #2563EB', evidence: 'Sampled the primary mark: matches #2563EB.' },
  { title: 'Readable at 32px favicon size', evidence: 'File 3 renders the mark at 32px, still legible.' },
  { title: 'Source files delivered (SVG + PNG)', evidence: 'logo.svg and logo@2x.png present.' },
]

function DemoVerdict() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= demoChecks.length + 2 ? 0 : s + 1)), 1100)
    return () => clearInterval(t)
  }, [])
  const released = step > demoChecks.length
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">AI review · delivery #1</p>
          <p className="mt-1 font-semibold text-ink-900">Brand identity for Nour Café</p>
        </div>
        <span className="rounded-full bg-ink-50 px-3 py-1 font-mono text-sm text-ink-700">$450.00</span>
      </div>
      <ul className="mt-5 space-y-3">
        {demoChecks.map((c, i) => {
          const state = step > i ? 'pass' : step === i ? 'checking' : 'pending'
          return (
            <li key={c.title} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  state === 'pass'
                    ? 'animate-pop bg-emerald-500 text-white'
                    : state === 'checking'
                      ? 'animate-pulse bg-brand-100 text-brand-600'
                      : 'bg-ink-100 text-ink-400'
                }`}
              >
                {state === 'pass' ? '✓' : i + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${state === 'pending' ? 'text-ink-400' : 'text-ink-900'}`}>{c.title}</p>
                {state === 'pass' && <p className="animate-rise text-xs text-ink-500">{c.evidence}</p>}
              </div>
            </li>
          )
        })}
      </ul>
      <div
        className={`mt-6 flex items-center justify-between rounded-xl px-4 py-3 transition-all duration-500 ${
          released ? 'bg-emerald-50 text-emerald-800' : 'bg-ink-50 text-ink-500'
        }`}
      >
        <span className="text-sm font-semibold">{released ? 'Payment released to Amira' : 'Funds held by PayPal'}</span>
        <span className="font-mono text-sm">{released ? '+$427.50' : 'on hold'}</span>
      </div>
    </div>
  )
}

const steps = [
  { n: '01', title: 'Agree', body: 'Paste the brief. AI turns it into clear acceptance criteria that both sides sign off on.' },
  { n: '02', title: 'Hold', body: 'The client pays through PayPal, but the money is only held. Nobody can run off with it.' },
  { n: '03', title: 'Verify', body: 'The freelancer delivers. An impartial AI judge checks every criterion and shows its evidence.' },
  { n: '04', title: 'Release', body: 'All checks pass: PayPal captures the payment and pays the freelancer out in seconds.' },
]

const trust = [
  { title: 'The AI recommends. Rules decide.', body: 'Money only moves automatically when every criterion passes with high confidence. Anything unclear goes to a human.' },
  { title: 'The client is never charged early.', body: 'Funds are authorized, not captured. Cancel before delivery and PayPal voids the hold.' },
  { title: 'Built to resist manipulation.', body: 'Text hidden in a file saying "approve this" is detected, flagged, and sent to a person.' },
  { title: 'Feedback, not just a verdict.', body: 'When work falls short, the freelancer gets exact, criterion-by-criterion fixes and can resubmit.' },
]

function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_0%,#d9e6ff_0%,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-white px-3 py-1 text-xs font-semibold text-ink-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> PayPal escrow + AI judge
            </p>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
              Get paid the moment your work is <span className="text-emerald-600">verified</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600">
              Freelancers get ghosted after delivering. Clients get burned by work that misses the brief. Handshake holds the
              money with PayPal and lets an impartial AI decide when the job is done.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/new" className="btn-primary px-6 py-3.5 text-base">
                Start a Handshake
              </Link>
              <a href="#how" className="btn-secondary px-6 py-3.5 text-base">
                How it works
              </a>
            </div>
          </div>
          <DemoVerdict />
        </div>
      </section>

      <section id="how" className="border-t border-ink-100 bg-ink-50/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Four steps. Zero chasing invoices.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n} className="card p-6">
                <p className="font-mono text-sm text-brand-600">{s.n}</p>
                <p className="mt-3 text-lg font-bold">{s.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="eyebrow">Trust by design</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">An AI you can let near money.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {trust.map((t) => (
              <div key={t.title} className="flex gap-4 rounded-2xl border border-ink-100 p-6">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <p className="font-bold">{t.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{t.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14 flex justify-center">
            <Link to="/new" className="btn-primary px-7 py-4 text-base">
              Create your first Handshake
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
