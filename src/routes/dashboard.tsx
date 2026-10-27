import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community'
import { listJobsFn } from '~/server/jobs'
import { StatusPill } from '~/components/ui'
import { formatMoney, type JobStatus } from '~/lib/types'

ModuleRegistry.registerModules([AllCommunityModule])

export const Route = createFileRoute('/dashboard')({
  loader: () => listJobsFn(),
  component: Dashboard,
})

type Row = Awaited<ReturnType<typeof listJobsFn>>[number]

const theme = themeQuartz.withParams({
  fontFamily: 'Inter, sans-serif',
  headerFontWeight: 600,
  borderColor: '#e8ecf4',
  headerBackgroundColor: '#f5f7fb',
  rowHoverColor: '#eef4ff',
  accentColor: '#2563eb',
  wrapperBorderRadius: 16,
})

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
    </div>
  )
}

function Dashboard() {
  const rows = Route.useLoaderData()
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'title', headerName: 'Job', flex: 2, minWidth: 220 },
      {
        field: 'status',
        flex: 1,
        minWidth: 150,
        cellRenderer: (p: { value: JobStatus }) => <StatusPill status={p.value} />,
      },
      { field: 'amount', headerName: 'Escrow', flex: 1, minWidth: 110, valueFormatter: (p) => formatMoney(Math.round(p.value * 100)) },
      { field: 'freelancer', flex: 1, minWidth: 140 },
      { field: 'client', flex: 1, minWidth: 140 },
      { field: 'criteria', headerName: 'Criteria', width: 100 },
      { field: 'attempts', headerName: 'Deliveries', width: 115 },
      {
        field: 'updatedAt',
        headerName: 'Last activity',
        flex: 1,
        minWidth: 170,
        sort: 'desc',
        valueFormatter: (p) => new Date(p.value).toLocaleString(),
      },
    ],
    [],
  )

  const held = rows.filter((r) => ['funded', 'verifying', 'revision_requested', 'human_review'].includes(r.status))
  const released = rows.filter((r) => r.status === 'released')
  const sum = (rs: Row[]) => formatMoney(Math.round(rs.reduce((s, r) => s + r.amount, 0) * 100))
  const autoRate = released.length ? Math.round((released.filter((r) => r.attempts > 0).length / released.length) * 100) : 0

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Every Handshake</h1>
        </div>
        <Link to="/new" className="btn-primary">New Handshake</Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        <Stat label="Handshakes" value={String(rows.length)} />
        <Stat label="Held in escrow" value={sum(held)} />
        <Stat label="Paid to freelancers" value={sum(released)} />
        <Stat label="Released after review" value={`${autoRate}%`} />
      </div>

      <div className="mt-8 h-[560px]">
        {mounted && (
          <AgGridReact<Row>
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
            rowHeight={52}
            pagination
            paginationPageSize={20}
            overlayNoRowsTemplate="No Handshakes yet. Create the first one."
            onRowClicked={(e) => {
              if (!e.data) return
              const url = new URL(e.data.link, window.location.origin)
              navigate({ to: '/j/$jobId', params: { jobId: e.data.id }, search: { t: url.searchParams.get('t') ?? '' } })
            }}
          />
        )}
      </div>
    </div>
  )
}
