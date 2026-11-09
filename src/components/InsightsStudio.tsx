// The Insights tab: an AG Studio dashboard over the live escrow ledger.
// Loaded only in the browser (see the lazy import in routes/dashboard.tsx).
import { useMemo, useRef, useState } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { AgStudioAiModule, createAiHarness, studioTheme, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi, type AgDataSourcesDefinition, type AgReportState } from 'ag-studio'
import { openRouterAdapter } from '~/components/studioAdapter'
import { statusMeta } from '~/components/ui'
import type { JobStatus } from '~/lib/types'

export interface InsightsData {
  jobs: { id: string; title: string; status: JobStatus; amount: number; released: number; held: number; freelancer: string; client: string; createdAt: number }[]
  payments: {
    key: string
    jobId: string
    kind: 'release' | 'void'
    at: number
    items: number
    decidedBy: 'ai' | 'appeal' | 'client' | 'void'
    captured: number
    fee: number
    paidOut: number
    payoutStatus: 'paid' | 'processing' | 'voided'
    voided: number
    captureId: string
  }[]
  items: { itemKey: string; jobId: string; piece: string; price: number; itemState: string; paidBy: string; paidAt: number | null; appeals: number }[]
}

const decidedLabel = { ai: 'AI judge', appeal: 'Appeal (second AI review)', client: 'Client', void: 'Hold voided' } as const
const payoutLabel = { paid: 'Paid to artist', processing: 'Payout processing', voided: 'Voided' } as const

const usd = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }

function sources(d: InsightsData): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: 'commissions',
        name: 'Commissions',
        description: 'One row per commission: the PayPal hold and how much of it has been released.',
        primaryKeyField: 'jobId',
        data: d.jobs.map((j) => ({
          jobId: j.id,
          // Short and unique: many demo commissions share a title.
          commission: `${j.title.replace(/^.*?:\s*/, '')} #${j.id.slice(0, 4)}`,
          artist: j.freelancer,
          client: j.client,
          status: statusMeta[j.status].label,
          total: j.amount,
          paid: j.released,
          held: j.held,
          created: new Date(j.createdAt),
        })),
        fields: [
          { id: 'jobId', name: 'Commission ID', format: 'textFormat' },
          { id: 'commission', name: 'Commission', format: 'textFormat' },
          { id: 'artist', name: 'Artist', format: 'textFormat' },
          { id: 'client', name: 'Client', format: 'textFormat' },
          { id: 'status', name: 'Status', format: 'textFormat' },
          { id: 'total', name: 'Commission value', format: 'currencyFormat', formatOptions: usd },
          { id: 'paid', name: 'Released', format: 'currencyFormat', formatOptions: usd },
          { id: 'held', name: 'Held in PayPal', description: 'Money still authorized (held) in PayPal and not yet charged, for commissions that are still open', format: 'currencyFormat', formatOptions: usd },
          { id: 'created', name: 'Created', format: 'dateTimeFormat' },
        ],
      },
      {
        id: 'payments',
        name: 'PayPal payments',
        description: 'One row per PayPal partial capture and the payout that followed it, plus voided holds.',
        primaryKeyField: 'paymentId',
        data: d.payments.map((p) => ({
          paymentId: p.key,
          jobId: p.jobId,
          paidOn: new Date(p.at),
          releasedBy: decidedLabel[p.decidedBy],
          pieces: p.items,
          captured: p.captured,
          fee: p.fee,
          paidOut: p.paidOut,
          voided: p.voided,
          payout: payoutLabel[p.payoutStatus],
          captureId: p.captureId || null,
          capture: p.kind === 'release' ? 1 : 0,
        })),
        fields: [
          { id: 'paymentId', name: 'Payment', format: 'textFormat', hide: true },
          { id: 'jobId', name: 'Commission ID', format: 'textFormat', hide: true },
          { id: 'paidOn', name: 'Date', format: 'dateTimeFormat' },
          { id: 'releasedBy', name: 'Released by', description: 'Who released this payment: AI judge, Appeal (second AI review), Client, or Hold voided', format: 'textFormat' },
          { id: 'pieces', name: 'Pieces', format: 'integerFormat' },
          { id: 'captured', name: 'Captured', description: 'Money PayPal captured from the client in this payment (0 for a voided hold)', format: 'currencyFormat', formatOptions: usd },
          { id: 'fee', name: 'Platform fee', format: 'currencyFormat', formatOptions: usd },
          { id: 'paidOut', name: 'Paid to artist', description: 'Money paid out to the artist in this payment, after the platform fee', format: 'currencyFormat', formatOptions: usd },
          { id: 'voided', name: 'Voided', format: 'currencyFormat', formatOptions: usd },
          { id: 'payout', name: 'Payout status', format: 'textFormat' },
          { id: 'captureId', name: 'PayPal capture ID', format: 'textFormat' },
          { id: 'capture', name: 'PayPal captures', description: '1 for each PayPal capture, 0 for a voided hold', format: 'integerFormat' },
        ],
      },
      {
        id: 'pieces',
        name: 'Pieces',
        description: 'One row per commissioned piece, and who released its money: the AI judge, an appeal, or the client.',
        primaryKeyField: 'itemKey',
        data: d.items.map((i) => ({
          ...i,
          // Three outcomes, named so that sorted A to Z they take the palette's green, amber, blue:
          // the same green-for-paid, amber-for-held as the bar chart next to it.
          outcome: i.paidBy !== 'Not paid' ? 'Paid' : i.itemState.startsWith('Voided') ? 'Voided (never charged)' : 'Still held in PayPal',
          paidAt: i.paidAt ? new Date(i.paidAt) : null,
        })),
        fields: [
          { id: 'itemKey', name: 'Piece ID', format: 'textFormat', hide: true },
          { id: 'jobId', name: 'Commission ID', format: 'textFormat', hide: true },
          { id: 'piece', name: 'Piece', format: 'textFormat' },
          { id: 'price', name: 'Price', description: "The piece's agreed price, whether or not it has been paid. Not money moved: use the PayPal payments table for that", format: 'currencyFormat', formatOptions: usd },
          { id: 'itemState', name: 'State', format: 'textFormat' },
          { id: 'paidBy', name: 'Paid by', format: 'textFormat' },
          { id: 'outcome', name: 'Outcome', description: 'Paid, still held in PayPal, or voided', format: 'textFormat' },
          { id: 'paidAt', name: 'Paid at', format: 'dateTimeFormat' },
          { id: 'appeals', name: 'Appeals', format: 'integerFormat' },
        ],
      },
    ],
    // What AG Studio's agents read first: which table answers which question.
    description: [
      'Escrow for commission art on PayPal. A client funds a commission; PayPal holds the money; each piece is paid when the AI judge verifies it, after an appeal, or when the client approves.',
      'Money actually moved lives in the PayPal payments table: one row per partial capture and payout. "Released" or "paid" money = sum of Paid to artist (payments.paidOut) or Captured (payments.captured). Who released it = Released by (payments.releasedBy). Voided rows moved no money.',
      'Money still held = sum of Held in PayPal (commissions.held). Commission status and artist are on the commissions table.',
      'The pieces table is for counting pieces by state or outcome. Its Price is the agreed price, not money moved.',
      'Build each chart from a single table when you can: the three tables join only through the commission ID.',
    ].join(' '),
    relationships: [
      { id: 'payments-commission', type: 'many-to-one', source: 'payments.jobId', target: 'commissions.jobId' },
      { id: 'pieces-commission', type: 'many-to-one', source: 'pieces.jobId', target: 'commissions.jobId' },
    ],
  }
}

const title = (text: string) => ({ title: { enabled: true, text } })

/** The dashboard a judge sees on first load. Everything cross-filters: click a bar or a slice. */
const report: AgReportState = {
  selectedPageId: 'overview',
  pages: [
    {
      id: 'overview',
      widgets: {
        status: {
          type: 'button-filter',
          dataMapping: { value: [{ id: 'commissions.status' }] },
        },
        held: { type: 'value', format: title('Held in PayPal'), dataMapping: { value: [{ id: 'commissions.held', aggregation: 'sum' }] } },
        paidOut: { type: 'value', format: title('Paid to artists'), dataMapping: { value: [{ id: 'payments.paidOut', aggregation: 'sum' }] } },
        fees: { type: 'value', format: title('Platform fees'), dataMapping: { value: [{ id: 'payments.fee', aggregation: 'sum' }] } },
        captures: { type: 'value', format: title('PayPal captures'), dataMapping: { value: [{ id: 'payments.capture', aggregation: 'sum' }] } },
        byWho: {
          type: 'donut-chart',
          format: title('Where each piece’s money is'),
          dataMapping: { categoryKey: [{ id: 'pieces.outcome' }], valueKey: [{ id: 'pieces.price', aggregation: 'sum' }] },
          sort: [{ field: { id: 'pieces.outcome' }, direction: 'asc' }],
        },
        perJob: {
          type: 'bar-chart-stacked',
          format: title('Paid vs held, per commission'),
          dataMapping: {
            categoryKey: [{ id: 'commissions.commission' }],
            valueKey: [
              { id: 'commissions.paid', aggregation: 'sum' },
              { id: 'commissions.held', aggregation: 'sum' },
            ],
          },
        },
        pieceStates: {
          type: 'column-chart-stacked',
          format: title('Pieces, by state'),
          dataMapping: { categoryKey: [{ id: 'pieces.itemState' }], valueKey: [{ id: 'pieces.itemKey', aggregation: 'countd' }] },
        },
        ledger: {
          type: 'grid',
          format: title('PayPal payments'),
          dataMapping: {
            cols: [
              { id: 'payments.paidOn' },
              { id: 'commissions.commission' },
              { id: 'payments.releasedBy' },
              { id: 'payments.paidOut' },
              { id: 'payments.captureId' },
            ],
          },
        },
      },
      widgetLayout: {
        status: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 6 },
        held: { xTrack: 0, yTrack: 6, xSpan: 6, ySpan: 7 },
        paidOut: { xTrack: 6, yTrack: 6, xSpan: 6, ySpan: 7 },
        fees: { xTrack: 12, yTrack: 6, xSpan: 6, ySpan: 7 },
        captures: { xTrack: 18, yTrack: 6, xSpan: 6, ySpan: 7 },
        perJob: { xTrack: 0, yTrack: 13, xSpan: 14, ySpan: 24 },
        byWho: { xTrack: 14, yTrack: 13, xSpan: 10, ySpan: 24 },
        pieceStates: { xTrack: 0, yTrack: 37, xSpan: 9, ySpan: 22 },
        ledger: { xTrack: 9, yTrack: 37, xSpan: 15, ySpan: 22 },
      },
    },
  ],
  panels: { filters: { collapsed: true } },
}

const promptStarters: AgAiPromptStarter[] = [
  // Each one names the table and fields, so the agents get it right first time.
  {
    label: 'Who released the money?',
    prompt: "Add a bar chart from the PayPal payments table: sum of 'Paid to artist' by 'Released by', largest first. Leave out 'Hold voided'.",
  },
  {
    label: 'Held money by commission',
    prompt: "Add a bar chart from the commissions table: sum of 'Held in PayPal' by 'Commission', largest first, only where 'Held in PayPal' is above 0.",
  },
  { label: 'Fees over time', prompt: "Add a line chart from the PayPal payments table: sum of 'Platform fee' and 'Paid to artist' by day of 'Date'." },
]

const modules = [AgStudioAiModule]
// Studio passes its full API at runtime; the setup type only promises the core one.
const ai: AgAiHarnessSetup = ({ api }) => createAiHarness(api as AgStudioApi, { adapter: openRouterAdapter, promptStarters })

const theme = studioTheme.withParams({
  accentColor: '#2563eb',
  fontFamily: 'Inter, sans-serif',
  borderColor: '#e8ecf4',
  backgroundColor: '#ffffff',
  textColor: '#0f172a',
  borderRadius: 12,
  // Paid green, held amber, then the rest.
  chartPaletteFills1Color: '#10b981',
  chartPaletteFills2Color: '#f59e0b',
  chartPaletteFills3Color: '#3b82f6',
  chartPaletteFills4Color: '#8b5cf6',
  chartPaletteFills5Color: '#94a3b8',
  chartPaletteFills6Color: '#f43f5e',
})

export default function InsightsStudio({ data }: { data: InsightsData }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const defs = useMemo(() => sources(data), [data])
  const ref = useRef<AgStudio>(null)

  // Edit mode opens with the AI assistant in front: the data and compose panels start collapsed,
  // so the canvas keeps its room. Studio rebuilds panel state on a mode change, hence after it.
  const toggle = () => {
    const next = mode === 'view' ? 'edit' : 'view'
    setMode(next)
    if (next === 'edit')
      setTimeout(() => {
        const api = ref.current?.api
        if (!api) return
        const state = api.getState()
        api.setState({ ...state, panels: { ...state.panels, data: { collapsed: true }, edit: { collapsed: true }, filters: { collapsed: true } } })
      }, 50)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          Built with AG Studio on the live ledger. Click any bar or slice to filter the whole page, or ask the AI to build a chart.
          <span className="sm:hidden"> Best on a larger screen.</span>
        </p>
        <button type="button" className="btn-ghost !py-2 text-sm" onClick={toggle}>
          {mode === 'view' ? 'Ask AI · Edit dashboard' : 'Done'}
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl ring-1 ring-ink-100" style={{ height: 1000 }}>
        <AgStudioProvider modules={modules} licenseKey={import.meta.env.VITE_AG_LICENSE_KEY}>
          <AgStudio
            ref={ref}
            style={{ height: '100%' }}
            data={defs}
            initialState={report}
            mode={mode}
            theme={theme}
            ai={ai}
            onApiReady={(e) => {
              if (import.meta.env.DEV) (window as unknown as { studio: unknown }).studio = e.api
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  )
}
