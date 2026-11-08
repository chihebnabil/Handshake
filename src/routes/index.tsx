import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createDemoJobFn, getAppConfigFn } from '~/server/jobs'

export const Route = createFileRoute('/')({
  loader: () => getAppConfigFn(),
  component: Home,
})

function TryDemoButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const createDemo = useServerFn(createDemoJobFn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const res = await createDemo()
            await navigate({ to: '/j/$jobId', params: { jobId: res.id }, search: { t: res.token } })
          } catch (e) {
            setError((e as Error).message)
            setBusy(false)
          }
        }}
      >
        {busy ? 'Setting up your demo…' : 'Try the live demo →'}
      </button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  )
}

const demoItems = ['Hi', 'Thanks', 'LOL', 'Love', 'Sad', 'Angry', 'Sleepy', 'Wow', 'Cool', 'GG']
const missing = new Set(['Sleepy', 'GG'])

function DemoVerdict() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= demoItems.length + 4 ? 0 : s + 1)), 650)
    return () => clearInterval(t)
  }, [])
  const done = step >= demoItems.length
  const verified = demoItems.slice(0, step).filter((n) => !missing.has(n)).length
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">AI review · delivery #1</p>
          <p className="mt-1 font-semibold text-ink-900">Sticker pack: Mochi the cat</p>
        </div>
        <span className="rounded-full bg-ink-50 px-3 py-1 font-mono text-sm text-ink-700">10 × $40</span>
      </div>
      <ul className="mt-5 grid grid-cols-5 gap-2">
        {demoItems.map((name, i) => {
          const state = step > i ? (missing.has(name) ? 'held' : 'pass') : step === i ? 'checking' : 'pending'
          return (
            <li
              key={name}
              className={`rounded-xl border px-1 py-2.5 text-center transition-colors ${
                state === 'pass' ? 'border-emerald-200 bg-emerald-50' : state === 'held' ? 'border-amber-200 bg-amber-50' : state === 'checking' ? 'animate-pulse border-violet-200 bg-violet-50' : 'border-ink-100'
              }`}
            >
              <div className="relative mx-auto h-11 w-11">
                {state === 'held' ? (
                  // Not in the delivery: an empty slot, which is why its $40 stays held.
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-amber-300 text-sm font-bold text-amber-500">?</span>
                ) : (
                  <img
                    src={`/stickers/${name.toLowerCase()}.png`}
                    alt={`${name} sticker`}
                    className={`h-11 w-11 object-contain transition ${state === 'pending' ? 'opacity-25 grayscale' : ''}`}
                  />
                )}
                {(state === 'pass' || state === 'held') && (
                  <span
                    className={`animate-pop absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      state === 'pass' ? 'bg-emerald-500' : 'bg-amber-400'
                    }`}
                  >
                    {state === 'pass' ? '✓' : '!'}
                  </span>
                )}
              </div>
              <p className={`mt-1.5 truncate text-[11px] font-semibold ${state === 'pending' ? 'text-ink-400' : 'text-ink-800'}`}>{name}</p>
            </li>
          )
        })}
      </ul>
      <div className="mt-5 overflow-hidden rounded-xl bg-ink-50">
        <div className="flex h-2">
          <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${verified * 10}%` }} />
          <div className="bg-amber-300 transition-all duration-500" style={{ width: done ? '20%' : '0%' }} />
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-sm">
          <span className="font-semibold text-emerald-700">Released ${verified * 40}</span>
          <span className={`font-semibold transition-opacity ${done ? 'text-amber-700 opacity-100' : 'opacity-0'}`}>Held $80: Sleepy and GG not delivered</span>
        </div>
      </div>
    </div>
  )
}

const steps = [
  { n: '01', title: 'Agree', body: 'Paste the commission brief. AI splits it into priced items, each quoting the line of the brief it comes from.' },
  { n: '02', title: 'Hold', body: 'The client pays through PayPal, but the money is only held. Nobody can run off with it.' },
  { n: '03', title: 'Verify', body: 'You deliver. An AI judge checks every item and points at the exact spot in your file that proves it.' },
  { n: '04', title: 'Release', body: 'PayPal pays you for each verified item right away. Anything missing stays held, with the reason.' },
]

const trust = [
  { title: 'Paid for what you delivered.', body: '8 of 10 stickers done? You get 80% now. The client is charged only for verified items, and the rest stays held.' },
  { title: 'Every decision cites its evidence.', body: 'Each item shows the brief line it comes from and the part of your file that proves it. No vibes, no black box.' },
  { title: 'Disagree? Appeal it.', body: 'An independent second AI review looks again. If it is not sure, the client decides. Every decision has a printable receipt.' },
  { title: 'The AI recommends. Rules decide.', body: 'Money moves only for items verified at 75% confidence or more. Text hidden in a file saying "approve this" is caught, and nothing is paid.' },
]

function Home() {
  const { demoMode } = Route.useLoaderData()
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_0%,#d9e6ff_0%,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-white px-3 py-1 text-xs font-semibold text-ink-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> For commission artists · PayPal escrow + AI judge
            </p>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
              Each piece paid the moment AI <span className="text-emerald-600">shows where it is</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600">
              Artists get ghosted after delivering half a commission. Clients get burned by work that misses the brief. Handshake
              holds the money with PayPal, and an impartial AI pays you for each piece it can verify, with receipts.
            </p>
            <div className="mt-9 flex flex-wrap items-start gap-3">
              {demoMode ? (
                <>
                  <TryDemoButton className="btn-success px-6 py-3.5 text-base" />
                  <Link to="/new" className="btn-secondary px-6 py-3.5 text-base">
                    Start your own
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/new" className="btn-primary px-6 py-3.5 text-base">
                    Start a Handshake
                  </Link>
                  <a href="#how" className="btn-secondary px-6 py-3.5 text-base">
                    How it works
                  </a>
                </>
              )}
            </div>
            {demoMode && (
              <p className="mt-4 text-sm text-ink-500">
                The demo runs on PayPal sandbox: fake money, real PayPal flow. Takes about 2 minutes.
              </p>
            )}
          </div>
          <DemoVerdict />
        </div>
      </section>

      <section id="how" className="border-t border-ink-100 bg-ink-50/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Four steps. Paid piece by piece.</h2>
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
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Not a bot that vibe-checks your work.</h2>
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
