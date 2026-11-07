import { useEffect, useState } from 'react'
import { formatMoney, type Criterion } from '~/lib/types'
import type { Negotiation } from '~/server/negotiate'

/** Shown while the two agents negotiate: the calls run one after the other, so the steps follow them. */
export function NegotiatingCard() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const step = elapsed < 20 ? 0 : elapsed < 42 ? 1 : 2
  const steps = ["The client's agent is tightening the checks and proposing prices…", "The artist's agent is reviewing the proposal and countering…", 'Settling by the rules…']
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 bg-violet-50 px-7 py-4 text-sm font-medium text-violet-900">
        <span className="h-2 w-2 animate-ping rounded-full bg-violet-500" />
        Agents are negotiating this contract ({elapsed}s)
      </div>
      <ol className="space-y-2 px-7 py-5 text-sm">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 ${i < step ? 'text-emerald-700' : i === step ? 'font-semibold text-ink-900' : 'text-ink-400'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'animate-pulse bg-violet-500 text-white' : 'bg-ink-100'}`}>
              {i < step ? '✓' : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Bubble({ who, tone, children }: { who: string; tone: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{who}</p>
      <p className="mt-1 leading-relaxed">{children}</p>
    </div>
  )
}

/** The outcome: what each agent asked for, and what the rule settled, item by item. */
export function NegotiationCard({ result, criteria, onUndo }: { result: Negotiation; criteria: Criterion[]; onUndo: () => void }) {
  const title = (id: string) => criteria.find((c) => c.id === id)?.title ?? id
  const moved = result.settlement.filter((s) => s.clientCents !== s.artistCents).length
  const reworded = result.settlement.filter((s) => s.wording === 'artist').length
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-7 py-5">
        <div>
          <p className="font-semibold">Negotiated by two agents</p>
          <p className="text-sm text-ink-500">
            {moved} {moved === 1 ? 'price' : 'prices'} contested{reworded ? `, ${reworded} ${reworded === 1 ? 'check' : 'checks'} reworded` : ''}. Settled by the rules below; you can still edit anything.
          </p>
        </div>
        <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={onUndo}>
          Undo
        </button>
      </div>
      <div className="grid gap-3 px-7 py-5 sm:grid-cols-2">
        <Bubble who="Client's agent proposed" tone="bg-sky-50 text-sky-950">
          {result.client.message}
        </Bubble>
        <Bubble who="Artist's agent countered" tone="bg-violet-50 text-violet-950">
          {result.artist.message}
        </Bubble>
      </div>
      <div className="overflow-x-auto px-7 pb-5">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-xs uppercase tracking-wider text-ink-400">
              <th className="py-2 pr-3 font-semibold">Item</th>
              <th className="py-2 pr-3 text-right font-semibold">Client's agent</th>
              <th className="py-2 pr-3 text-right font-semibold">Artist's agent</th>
              <th className="py-2 text-right font-semibold">Agreed</th>
            </tr>
          </thead>
          <tbody>
            {result.settlement.map((s) => {
              const why = result.artist.items.find((a) => a.id === s.id)?.reason
              return (
                <tr key={s.id} className="border-b border-ink-100 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-ink-900">{title(s.id)}</p>
                    {s.artistCents !== s.clientCents && why && <p className="text-xs text-ink-500">{why}</p>}
                    {s.note && <p className={`mt-1 text-xs font-semibold ${s.wording === 'artist' ? 'text-violet-700' : 'text-amber-700'}`}>{s.note}</p>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono text-ink-600">{formatMoney(s.clientCents)}</td>
                  <td className={`py-2.5 pr-3 text-right font-mono ${s.artistCents > s.clientCents ? 'text-emerald-700' : s.artistCents < s.clientCents ? 'text-rose-700' : 'text-ink-600'}`}>
                    {formatMoney(s.artistCents)}
                  </td>
                  <td className="py-2.5 text-right font-mono font-semibold text-ink-900">{formatMoney(s.agreedCents)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-500">
          The agents only argue; a fixed rule decides. Prices meet in the middle and always add up to the total. The artist's rewording is accepted only
          where it shows a check cannot be verified from a delivery, because an item nobody can verify would only end in a dispute.
        </p>
      </div>
    </div>
  )
}
