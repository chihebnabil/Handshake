import { Link, createFileRoute } from '@tanstack/react-router'
import { getReceiptFn } from '~/server/jobs'
import { formatMoney } from '~/lib/types'
import { Logo } from '~/components/Logo'
import { BriefQuote, EvidenceCrop } from '~/components/money'

export const Route = createFileRoute('/j/$jobId_/receipt')({
  validateSearch: (search: Record<string, unknown>) => ({ t: String(search.t ?? ''), d: String(search.d ?? '') }),
  loaderDeps: ({ search }) => ({ t: search.t, d: search.d }),
  loader: ({ params, deps }) => getReceiptFn({ data: { id: params.jobId, token: deps.t, d: deps.d } }),
  head: () => ({ meta: [{ title: 'Decision receipt · Handshake' }] }),
  component: Receipt,
})

const outcomeLabel = {
  upheld: 'Overturned by the second review: paid',
  disputed: 'Not overturned: waiting for the client',
  client_released: 'Not overturned, then released by the client',
  client_held: 'Not overturned, kept on hold by the client',
  redelivered: 'Not overturned, then delivered again and verified',
  pending: 'Under review',
}

function Receipt() {
  const r = Route.useLoaderData()
  const { t } = Route.useSearch()
  const v = r.verdict
  const reviewed = r.criteria.filter((c) => v.results.some((x) => x.id === c.id))
  const releasedHere = r.releases.reduce((n, x) => n + x.amountCents, 0)
  const paidOutHere = r.releases.reduce((n, x) => n + x.payoutCents, 0)
  const heldHere = reviewed.filter((c) => v.heldIds.includes(c.id)).reduce((n, c) => n + c.amountCents, 0)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link to="/j/$jobId" params={{ jobId: r.job.id }} search={{ t }} className="text-sm font-semibold text-ink-500 hover:text-ink-900">
          ← Back to the Handshake
        </Link>
        <button type="button" className="btn-primary !py-2" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      <article className="card overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-100 bg-ink-50/60 px-8 py-7">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo className="h-7 w-7" />
              <span className="font-bold">Handshake</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Decision receipt</h1>
            <p className="mt-1 text-sm text-ink-500">
              {r.job.title} · delivery #{r.delivery.number}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-500">Receipt</dt>
            <dd className="font-mono">{r.fingerprint.slice(0, 12).toUpperCase()}</dd>
            <dt className="text-ink-500">Decided</dt>
            <dd>{new Date(v.reviewedAt).toLocaleString()}</dd>
            <dt className="text-ink-500">Artist</dt>
            <dd>{r.job.freelancer}</dd>
            <dt className="text-ink-500">Client</dt>
            <dd>{r.job.client}</dd>
            <dt className="text-ink-500">Escrow</dt>
            <dd className="font-mono">{formatMoney(r.job.amountCents)}</dd>
          </dl>
        </header>

        <section className="grid gap-4 border-b border-ink-100 px-8 py-6 sm:grid-cols-3">
          <Stat label="Released by this decision" value={formatMoney(releasedHere)} tone="text-emerald-700" />
          <Stat label="Held by this decision" value={formatMoney(heldHere)} tone="text-amber-700" />
          <Stat label="Paid to the artist" value={formatMoney(paidOutHere)} note={`after the ${r.feePercent}% Handshake fee`} />
        </section>

        <section className="border-b border-ink-100 px-8 py-6">
          <p className="eyebrow">Outcome</p>
          <p className="mt-2 font-semibold">{v.summary}</p>
          <p className="mt-1 text-sm text-ink-600">
            {v.policyNote} {v.injectionDetected && 'The delivery contained text that tried to instruct the reviewer, so no money moved automatically.'}
          </p>
          <p className="mt-3 text-xs text-ink-500">
            Rule applied: an item is paid automatically only when the reviewer verifies it with at least 75% confidence and raises no concern about the
            delivery. Everything else stays held and goes to the artist for fixes or to the client for a decision.
          </p>
        </section>

        <section className="px-8 py-6">
          <p className="eyebrow">Items reviewed ({reviewed.length})</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-xs uppercase tracking-wider text-ink-400">
                <th className="py-2 pr-4 font-semibold">Item</th>
                <th className="py-2 pr-4 font-semibold">Evidence</th>
                <th className="py-2 text-right font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {reviewed.map((c) => {
                const res = v.results.find((x) => x.id === c.id)!
                const paid = v.releasedIds.includes(c.id)
                const file = res.fileIndex ? r.files[res.fileIndex - 1] : null
                return (
                  <tr key={c.id} className="break-inside-avoid border-b border-ink-100 align-top">
                    <td className="w-1/4 py-3 pr-4">
                      <p className="font-semibold">{c.title}</p>
                      <p className="font-mono text-xs text-ink-500">{formatMoney(c.amountCents)}</p>
                      <BriefQuote quote={c.sourceQuote} stacked />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-3">
                        {file?.mediaType.startsWith('image/') && <EvidenceCrop file={file} region={res.region} label={`File ${res.fileIndex}`} />}
                        <div>
                          <p className="text-ink-700">{res.evidence}</p>
                          {res.quote && <p className="mt-1 text-xs text-ink-500">Read in the file: “{res.quote}”</p>}
                        </div>
                      </div>
                    </td>
                    <td className="w-32 py-3 text-right">
                      <p className={`font-semibold ${paid ? 'text-emerald-700' : 'text-amber-700'}`}>{paid ? 'Paid' : 'Held'}</p>
                      <p className="text-xs text-ink-500">
                        {res.status}, {res.confidence}%
                      </p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {r.appeals.length > 0 && (
          <section className="border-t border-ink-100 px-8 py-6">
            <p className="eyebrow">Appeals</p>
            <ul className="mt-3 space-y-3 text-sm">
              {r.appeals.map((a) => (
                <li key={`${a.criterionId}-${a.at}`} className="break-inside-avoid rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
                  <p className="font-semibold">{r.criteria.find((c) => c.id === a.criterionId)?.title}</p>
                  <p className="mt-1">
                    <span className="text-ink-500">Artist:</span> “{a.reason}”
                  </p>
                  <p className="mt-1">
                    <span className="text-ink-500">Second review ({a.confidence}%):</span> {a.reasoning}
                  </p>
                  <p className="mt-1 font-semibold">{outcomeLabel[a.outcome]}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-ink-100 px-8 py-6">
          <p className="eyebrow">Money moved by PayPal ({r.paypalEnv})</p>
          {r.releases.length ? (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-xs uppercase tracking-wider text-ink-400">
                  <th className="py-2 pr-4 font-semibold">Release</th>
                  <th className="py-2 pr-4 font-semibold">Capture</th>
                  <th className="py-2 pr-4 font-semibold">Payout to artist</th>
                  <th className="py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.releases.map((x) => (
                  <tr key={x.seq} className="border-b border-ink-100 align-top">
                    <td className="py-2.5 pr-4">
                      #{x.seq} · {x.itemIds.length} {x.itemIds.length === 1 ? 'item' : 'items'}
                      <p className="text-xs text-ink-500">{x.reason}</p>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      {x.captureId}
                      <p className="font-sans text-ink-500">{x.finalCapture ? 'final capture' : 'partial capture, rest still held'}</p>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      {x.payoutBatchId ?? '—'}
                      <p className="font-sans text-ink-500">
                        {formatMoney(x.payoutCents)} · {x.payoutStatus === 'paid' ? 'sent' : 'processing'}
                      </p>
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold">{formatMoney(x.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-ink-600">No money moved because of this decision. Everything reviewed stays held.</p>
          )}
          <p className="mt-4 text-sm text-ink-600">
            Escrow now: <span className="font-semibold text-emerald-700">{formatMoney(r.totals.released)} released</span>
            {r.totals.held > 0 && <>, <span className="font-semibold text-amber-700">{formatMoney(r.totals.held)} held</span></>}
            {r.totals.voided > 0 && <>, {formatMoney(r.totals.voided)} returned to the client</>}.
          </p>
        </section>

        <footer className="border-t border-ink-100 bg-ink-50/60 px-8 py-5 text-xs text-ink-500">
          <p>
            Reviewed by {v.model}. Delivered files: {r.delivery.files.join(', ') || 'none'}.
          </p>
          <p className="mt-1 break-all">
            SHA-256 of the contract, verdict, appeals and payments: <span className="font-mono text-ink-700">{r.fingerprint}</span>
          </p>
        </footer>
      </article>
    </div>
  )
}

function Stat({ label, value, tone = 'text-ink-900', note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 font-mono text-2xl font-semibold ${tone}`}>{value}</p>
      {note && <p className="text-xs text-ink-500">{note}</p>}
    </div>
  )
}
