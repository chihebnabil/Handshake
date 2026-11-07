import { useEffect, useState } from 'react'
import { formatMoney, ledgerTotals, type DeliverableFile, type ItemState, type Ledger, type Region } from '~/lib/types'

/** Released / held / voided split of the escrow, as one stacked bar. */
export function MoneyBar({ ledger, totalCents, compact = false }: { ledger: Ledger; totalCents: number; compact?: boolean }) {
  const t = ledgerTotals(ledger)
  const pct = (n: number) => `${totalCents ? (n / totalCents) * 100 : 0}%`
  return (
    <div className={compact ? '' : 'rounded-2xl border border-ink-100 bg-white px-5 py-4'}>
      <div className="flex h-3 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: pct(t.released) }} />
        <div className="h-full bg-amber-300 transition-[width] duration-700" style={{ width: pct(t.held) }} />
        <div className="h-full bg-[repeating-linear-gradient(135deg,#d2d9e7_0_6px,#e8ecf4_6px_12px)]" style={{ width: pct(t.voided) }} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-semibold text-emerald-700">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Released <span className="font-mono">{formatMoney(t.released)}</span>
        </span>
        {(t.held > 0 || !t.voided) && (
          <span className="flex items-center gap-2 font-semibold text-amber-700">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            Held <span className="font-mono">{formatMoney(t.held)}</span>
          </span>
        )}
        {t.voided > 0 && (
          <span className="flex items-center gap-2 font-semibold text-ink-500">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
            Returned to client <span className="font-mono">{formatMoney(t.voided)}</span>
          </span>
        )}
        <span className="ml-auto text-xs text-ink-400">of {formatMoney(totalCents)} in escrow</span>
      </div>
    </div>
  )
}

const itemMeta: Record<ItemState, { label: string; tone: string }> = {
  held: { label: 'Held', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  released: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  appeal_review: { label: 'Appeal under review', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  disputed: { label: 'Client decides', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
}

export function ItemPill({ state, amountCents }: { state: ItemState; amountCents: number }) {
  const m = itemMeta[state]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${m.tone}`}>
      <span className="font-mono">{formatMoney(amountCents)}</span>
      <span className="opacity-60">·</span>
      {m.label}
    </span>
  )
}

/** The line of the brief an item comes from. Rendered only when the quote was verified against the brief. */
export function BriefQuote({ quote, stacked = false }: { quote: string | null; stacked?: boolean }) {
  if (!quote) return null
  return (
    <p className={`mt-1.5 flex text-xs text-ink-500 ${stacked ? 'flex-col gap-1' : 'gap-2'}`}>
      <span className="shrink-0 font-semibold uppercase tracking-wider text-ink-400">From the brief</span>
      <span className="border-l-2 border-ink-200 pl-2 italic text-ink-600">“{quote}”</span>
    </p>
  )
}

/**
 * Shows the part of a delivered image the reviewer pointed at. Without a usable region it falls back
 * to the whole image. Clicking opens the full file with the region outlined.
 */
export function EvidenceCrop({ file, region, label }: { file: DeliverableFile; region: Region | null; label: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [open, setOpen] = useState(false)
  // Measured in an effect: an <img> onLoad can fire before hydration and be missed.
  useEffect(() => {
    const img = new Image()
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = file.dataUrl
  }, [file.dataUrl])
  const r = region ?? { x: 0, y: 0, w: 1, h: 1 }
  const aspect = size ? (r.w * size.w) / (r.h * size.h) : 1
  const height = 92
  const width = Math.round(Math.min(220, Math.max(64, height * aspect)))
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${label}: open the full file`}
        className="group relative shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-50 shadow-sm transition hover:border-brand-500"
        style={{
          width,
          height,
          backgroundImage: `url(${file.dataUrl})`,
          backgroundSize: `${100 / r.w}% ${100 / r.h}%`,
          backgroundPosition: `${r.w < 1 ? (r.x / (1 - r.w)) * 100 : 0}% ${r.h < 1 ? (r.y / (1 - r.h)) * 100 : 0}%`,
        }}
      >
        <span className="absolute left-1 top-1 rounded bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{label}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 p-6" onClick={() => setOpen(false)}>
          <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img src={file.dataUrl} alt={file.name} className="max-h-[85vh] w-auto rounded-xl bg-white" />
            {region && (
              <div
                className="pointer-events-none absolute rounded-md border-[3px] border-emerald-400 shadow-[0_0_0_9999px_rgba(11,27,63,0.35)]"
                style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
              />
            )}
            <p className="mt-2 text-center text-sm text-white">{file.name} · the outlined area is where the AI found the evidence</p>
            <button type="button" className="absolute -right-3 -top-3 h-8 w-8 rounded-full bg-white font-bold text-ink-900 shadow" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}
