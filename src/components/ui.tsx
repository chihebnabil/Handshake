import type { CheckMethod, CriterionStatus, JobStatus } from '~/lib/types'

const methodLabels: Record<CheckMethod, string> = {
  visual: 'Image check',
  content: 'Content check',
  link: 'Link check',
  manual: 'Human check',
}

export function MethodBadge({ method }: { method: CheckMethod }) {
  return (
    <span className="rounded-md bg-ink-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
      {methodLabels[method]}
    </span>
  )
}

export const statusMeta: Record<JobStatus, { label: string; tone: string }> = {
  awaiting_funding: { label: 'Awaiting funding', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  funded: { label: 'Funds held', tone: 'bg-brand-50 text-brand-700 ring-brand-100' },
  verifying: { label: 'AI reviewing', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  revision_requested: { label: 'Changes needed', tone: 'bg-orange-50 text-orange-800 ring-orange-200' },
  human_review: { label: 'Client decides', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  released: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  refunded: { label: 'Cancelled', tone: 'bg-ink-50 text-ink-600 ring-ink-200' },
}

export function StatusPill({ status }: { status: JobStatus }) {
  const m = statusMeta[status]
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${m.tone}`}>{m.label}</span>
}

export function ResultIcon({ status }: { status: CriterionStatus | 'pending' | 'checking' }) {
  const styles = {
    pass: 'bg-emerald-500 text-white',
    fail: 'bg-rose-500 text-white',
    unclear: 'bg-amber-400 text-white',
    pending: 'bg-ink-100 text-ink-400',
    checking: 'bg-violet-100 text-violet-600 animate-pulse',
  }[status]
  const glyph = { pass: '✓', fail: '✕', unclear: '?', pending: '•', checking: '…' }[status]
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${styles}`}>{glyph}</span>
  )
}

export function ConfidenceBar({ value, status }: { value: number; status: CriterionStatus }) {
  const color = status === 'pass' ? 'bg-emerald-500' : status === 'fail' ? 'bg-rose-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-[11px] text-ink-500">{value}%</span>
    </div>
  )
}
