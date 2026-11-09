import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type FilterChangedEvent, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community'
import { listItemsFn, listJobsFn, listPaymentsFn } from '~/server/jobs'
import { StatusPill } from '~/components/ui'
import { formatMoney, type JobStatus } from '~/lib/types'

ModuleRegistry.registerModules([AllCommunityModule])

// AG Studio runs only in the browser and is heavy, so it loads on demand.
const InsightsStudio = lazy(() => import('~/components/InsightsStudio'))

type View = 'commissions' | 'payments' | 'insights'

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search: Record<string, unknown>): { view?: View } =>
    search.view === 'payments' || search.view === 'insights' ? { view: search.view } : {},
  loaderDeps: ({ search }) => ({ insights: search.view === 'insights' }),
  loader: async ({ deps }) => {
    const [jobs, payments, items] = await Promise.all([listJobsFn(), listPaymentsFn(), deps.insights ? listItemsFn() : Promise.resolve([])])
    return { jobs, payments, items }
  },
  component: Dashboard,
})

type JobRow = Awaited<ReturnType<typeof listJobsFn>>[number]
type PaymentRow = Awaited<ReturnType<typeof listPaymentsFn>>[number]
type TotalRow = Partial<PaymentRow> & { job: string }

const theme = themeQuartz.withParams({
  fontFamily: 'Inter, sans-serif',
  headerFontWeight: 600,
  borderColor: '#e8ecf4',
  headerBackgroundColor: '#f5f7fb',
  rowHoverColor: '#eef4ff',
  accentColor: '#2563eb',
  wrapperBorderRadius: 16,
})

const money = (dollars: number | undefined) => (dollars === undefined ? '' : formatMoney(Math.round(dollars * 100)))
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tone}`}>{children}</span>
}

const decidedBy = {
  ai: { label: 'AI verified', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  appeal: { label: 'Appeal upheld', tone: 'bg-violet-50 text-violet-800 ring-violet-200' },
  client: { label: 'Client approved', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  void: { label: 'Hold voided', tone: 'bg-ink-50 text-ink-600 ring-ink-200' },
} as const

const payoutStatus = {
  paid: { label: 'Paid to artist', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  processing: { label: 'Payout processing', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  voided: { label: 'Not charged', tone: 'bg-ink-50 text-ink-600 ring-ink-200' },
} as const

/** How much of the commission has been released so far: the point of paying piece by piece. */
function ReleasedBar({ released, total }: { released: number; total: number }) {
  const pct = total > 0 ? Math.round((released / total) * 100) : 0
  return (
    <div className="flex h-full items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-amber-100" title={`${money(released)} of ${money(total)} released`}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-ink-600">{pct}%</span>
    </div>
  )
}

/** Fits the grid to its rows (up to a page) without autoHeight, which lets the horizontal scrollbar cover the last row. */
const gridHeight = (rows: number, pinned: boolean) => 50 + Math.max(3, Math.min(rows, 20)) * 52 + (pinned ? 52 : 0) + 50 + 20

function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

function Dashboard() {
  const { jobs, payments, items } = Route.useLoaderData()
  const { view = 'commissions' } = Route.useSearch()
  const navigate = useNavigate()
  const mounted = useMounted()
  const [query, setQuery] = useState('')
  const paymentsGrid = useRef<AgGridReact<PaymentRow | TotalRow>>(null)

  const open = (link: string | undefined, id: string | undefined) => {
    if (!link || !id) return
    const url = new URL(link, window.location.origin)
    navigate({ to: '/j/$jobId', params: { jobId: id }, search: { t: url.searchParams.get('t') ?? '' } })
  }

  const jobColumns = useMemo<ColDef<JobRow>[]>(
    () => [
      { field: 'title', headerName: 'Commission', flex: 2, minWidth: 220 },
      {
        field: 'status',
        flex: 1,
        minWidth: 150,
        cellRenderer: (p: ICellRendererParams<JobRow, JobStatus>) => p.value && <StatusPill status={p.value} partly={(p.data?.released ?? 0) > 0} />,
      },
      { field: 'amount', headerName: 'Total', flex: 1, minWidth: 110, type: 'rightAligned', valueFormatter: (p) => money(p.value) },
      { field: 'released', headerName: 'Released', flex: 1, minWidth: 125, type: 'rightAligned', valueFormatter: (p) => money(p.value) },
      {
        colId: 'progress',
        headerName: 'Paid so far',
        minWidth: 140,
        sortable: false,
        filter: false,
        valueGetter: (p) => (p.data ? p.data.released / (p.data.amount || 1) : 0),
        cellRenderer: (p: ICellRendererParams<JobRow>) => p.data && <ReleasedBar released={p.data.released} total={p.data.amount} />,
      },
      { field: 'freelancer', headerName: 'Artist', flex: 1, minWidth: 140 },
      { field: 'client', flex: 1, minWidth: 140 },
      { field: 'criteria', headerName: 'Items', width: 90 },
      { field: 'attempts', headerName: 'Deliveries', width: 115 },
      { field: 'updatedAt', headerName: 'Last activity', flex: 1, minWidth: 150, sort: 'desc', valueFormatter: (p) => when(p.value) },
    ],
    [],
  )

  const paymentColumns = useMemo<ColDef<PaymentRow | TotalRow>[]>(
    () => [
      { field: 'at', headerName: 'When', width: 140, sort: 'desc', valueFormatter: (p) => (p.value ? when(p.value) : '') },
      {
        field: 'job',
        headerName: 'Commission',
        flex: 1,
        minWidth: 230,
        cellRenderer: (p: ICellRendererParams<PaymentRow | TotalRow>) =>
          p.node.rowPinned ? (
            <span className="font-semibold">{p.value}</span>
          ) : (
            <div className="flex h-full flex-col justify-center leading-tight">
              <span className="truncate">{p.value}</span>
              <span className="text-xs text-ink-400">
                Payment {p.data?.seq} · {p.data?.items} {p.data?.items === 1 ? 'item' : 'items'}
              </span>
            </div>
          ),
      },
      {
        field: 'decidedBy',
        headerName: 'Decided by',
        width: 145,
        cellRenderer: (p: ICellRendererParams<PaymentRow | TotalRow, keyof typeof decidedBy>) =>
          p.value && <Pill tone={decidedBy[p.value].tone}>{decidedBy[p.value].label}</Pill>,
      },
      { field: 'captured', headerName: 'Captured', width: 120, type: 'rightAligned', valueFormatter: (p) => money(p.value), cellClass: 'ag-right-aligned-cell font-mono' },
      {
        field: 'paidOut',
        headerName: 'Paid to artist',
        width: 135,
        type: 'rightAligned',
        valueFormatter: (p) => money(p.value),
        cellClass: 'ag-right-aligned-cell font-mono font-semibold text-emerald-700',
      },
      {
        field: 'payoutStatus',
        headerName: 'Status',
        width: 165,
        cellRenderer: (p: ICellRendererParams<PaymentRow | TotalRow, keyof typeof payoutStatus>) =>
          p.value && <Pill tone={payoutStatus[p.value].tone}>{payoutStatus[p.value].label}</Pill>,
      },
      {
        colId: 'progress',
        headerName: 'Commission paid',
        width: 150,
        sortable: false,
        filter: false,
        valueGetter: (p) => (p.data?.jobTotal ? (p.data.jobReleased ?? 0) / p.data.jobTotal : null),
        cellRenderer: (p: ICellRendererParams<PaymentRow | TotalRow>) =>
          !p.node.rowPinned && p.data?.jobTotal ? <ReleasedBar released={p.data.jobReleased ?? 0} total={p.data.jobTotal} /> : null,
      },
      { field: 'items', headerName: 'Items', width: 95, tooltipField: 'itemTitles' },
      { field: 'fee', headerName: 'Fee', minWidth: 100, type: 'rightAligned', valueFormatter: (p) => money(p.value), cellClass: 'ag-right-aligned-cell font-mono text-ink-500' },
      {
        field: 'voided',
        headerName: 'Released hold',
        headerTooltip: 'Money that was held but never charged, because the commission was cancelled.',
        minWidth: 135,
        type: 'rightAligned',
        valueFormatter: (p) => (p.value ? money(p.value) : ''),
        cellClass: 'ag-right-aligned-cell font-mono text-ink-500',
      },
      { field: 'artist', headerName: 'Artist', minWidth: 130 },
      { field: 'captureId', headerName: 'PayPal capture', minWidth: 190, cellClass: 'font-mono text-xs text-ink-500' },
      { field: 'payoutBatchId', headerName: 'PayPal payout batch', minWidth: 190, cellClass: 'font-mono text-xs text-ink-500' },
      { field: 'reason', headerName: 'Why', minWidth: 260, flex: 2, tooltipField: 'reason', cellClass: 'text-ink-600' },
    ],
    [],
  )

  const sum = (key: 'captured' | 'fee' | 'paidOut' | 'voided', rows: PaymentRow[] = payments) => rows.reduce((n, r) => n + r[key], 0)
  const totalsFor = (rows: PaymentRow[], filtered: boolean): TotalRow[] => {
    const count = rows.filter((p) => p.kind === 'release').length
    return [
      {
        job: `${filtered ? 'Matching' : 'Total'} · ${count} ${count === 1 ? 'payment' : 'payments'}`,
        captured: sum('captured', rows),
        fee: sum('fee', rows),
        paidOut: sum('paidOut', rows),
        voided: sum('voided', rows),
      },
    ]
  }
  // The totals row follows the search and column filters, so it always adds up what is on screen.
  const [totalRow, setTotalRow] = useState<TotalRow[]>(() => totalsFor(payments, false))
  // The grid fits the rows on screen, so a search doesn't leave an empty band.
  const [shown, setShown] = useState(payments.length)
  const refreshTotals = (e: FilterChangedEvent<PaymentRow | TotalRow>) => {
    const rows: PaymentRow[] = []
    e.api.forEachNodeAfterFilter((n) => n.data && 'kind' in n.data && rows.push(n.data as PaymentRow))
    setTotalRow(totalsFor(rows, rows.length !== payments.length))
    setShown(rows.length)
  }

  const held = jobs.reduce((n, r) => n + r.held, 0)
  const releases = payments.filter((p) => p.kind === 'release')
  const paidJobs = new Set(releases.map((p) => p.jobId)).size
  const multi = Object.values(releases.reduce<Record<string, number>>((m, p) => ({ ...m, [p.jobId]: (m[p.jobId] ?? 0) + 1 }), {})).filter((n) => n > 1).length

  const tab = (v: View, label: string, count: number) => (
    <Link
      to="/dashboard"
      search={v === 'commissions' ? {} : { view: v }}
      className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === v ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}`}
    >
      {label} <span className={`ml-1 font-mono text-xs ${view === v ? 'text-white/70' : 'text-ink-400'}`}>{count}</span>
    </Link>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Activity · public demo</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">All commissions</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">
            This sandbox deployment shows every commission so you can explore how money moves. With accounts, artists and clients would see only their own.
          </p>
        </div>
        <Link to="/new" className="btn-primary">New commission</Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Commissions" value={String(jobs.length)} />
        <Stat label="Held in PayPal" value={money(held)} hint="Authorized, not charged" />
        <Stat label="Paid to artists" value={money(sum('paidOut'))} hint={`After the ${money(sum('fee'))} fee`} />
        <Stat label="PayPal payments" value={String(releases.length)} hint={`${paidJobs} commissions paid, ${multi} in several parts`} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-ink-100">
          {tab('commissions', 'Commissions', jobs.length)}
          {tab('payments', 'Payments ledger', releases.length)}
          <Link
            to="/dashboard"
            search={{ view: 'insights' }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'insights' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}`}
          >
            Insights <span className={`ml-1 text-xs ${view === 'insights' ? 'text-white/70' : 'text-brand-600'}`}>AG Studio</span>
          </Link>
        </div>
        {view === 'payments' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input !w-64 !py-2 text-sm"
              type="search"
              placeholder="Search payments or PayPal IDs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost !py-2 text-sm"
              onClick={() =>
                paymentsGrid.current?.api.exportDataAsCsv({
                  fileName: 'handshake-payments.csv',
                  columnKeys: ['at', 'job', 'decidedBy', 'items', 'captured', 'fee', 'paidOut', 'voided', 'payoutStatus', 'artist', 'captureId', 'payoutBatchId', 'reason'],
                  processCellCallback: (p) => {
                    const id = p.column.getColId()
                    if (id === 'at') return p.value ? new Date(p.value).toISOString() : ''
                    if (id === 'decidedBy') return p.value ? decidedBy[p.value as keyof typeof decidedBy].label : ''
                    if (id === 'payoutStatus') return p.value ? payoutStatus[p.value as keyof typeof payoutStatus].label : ''
                    return p.value
                  },
                })
              }
            >
              Export CSV
            </button>
          </div>
        )}
      </div>

      {view === 'payments' && (
        <p className="mt-3 text-sm text-ink-500">
          One row per PayPal payment: a partial capture of the held money for the items that were verified, then a payout to the artist. Nothing is captured for
          items that are still held.
        </p>
      )}

      <div className="mt-4">
        {mounted && view === 'insights' && (
          <Suspense fallback={<div className="card grid h-[1000px] place-items-center text-sm text-ink-500">Loading the dashboard…</div>}>
            <InsightsStudio data={{ jobs, payments, items }} />
          </Suspense>
        )}
        {mounted && view === 'commissions' && (
          <div style={{ height: gridHeight(jobs.length, false) }}>
            <AgGridReact<JobRow>
              theme={theme}
              rowData={jobs}
              columnDefs={jobColumns}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              rowHeight={52}
              pagination
              paginationPageSize={20}
              overlayNoRowsTemplate="No commissions yet. Create the first one."
              onRowClicked={(e: RowClickedEvent<JobRow>) => open(e.data?.link, e.data?.id)}
            />
          </div>
        )}
        {mounted && view === 'payments' && (
          <div style={{ height: gridHeight(shown, true) }}>
            <AgGridReact<PaymentRow | TotalRow>
              ref={paymentsGrid}
              theme={theme}
              rowData={payments}
              getRowId={(p) => (p.data as PaymentRow).key}
              columnDefs={paymentColumns}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              pinnedBottomRowData={totalRow}
              quickFilterText={query}
              onFilterChanged={refreshTotals}
              rowHeight={52}
              tooltipShowDelay={300}
              pagination
              paginationPageSize={20}
              overlayNoRowsTemplate="No PayPal payments yet. Fund a commission and deliver to see the first one."
              onRowClicked={(e: RowClickedEvent<PaymentRow | TotalRow>) => !e.node.rowPinned && open(e.data?.link, e.data?.jobId)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
