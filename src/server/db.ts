import { createClient, type Client } from '@libsql/client'
import { emptyLedger, splitAmount, type Criterion, type Deliverable, type JobEvent, type JobRecord, type Ledger, type Verdict } from '~/lib/types'

let client: Client | undefined
let ready: Promise<void> | undefined

function db(): Client {
  const url = process.env.DATABASE_URL || 'file:handshake.db'
  if (process.env.VERCEL && url.startsWith('file:')) {
    // Serverless file systems are read-only and wiped between requests.
    throw new Error('On Vercel, set DATABASE_URL to a hosted libSQL database (for example Turso) and DATABASE_AUTH_TOKEN.')
  }
  client ??= createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  })
  return client
}

async function migrate() {
  await db().batch(
    [
      `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        freelancer_name TEXT NOT NULL,
        freelancer_email TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_email TEXT NOT NULL,
        client_token TEXT NOT NULL,
        freelancer_token TEXT NOT NULL,
        status TEXT NOT NULL,
        contract_summary TEXT,
        criteria_json TEXT NOT NULL DEFAULT '[]',
        paypal_order_id TEXT,
        paypal_authorization_id TEXT,
        paypal_capture_id TEXT,
        paypal_payout_batch_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        is_demo INTEGER NOT NULL DEFAULT 0,
        ledger_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS deliverables (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        note TEXT NOT NULL,
        link TEXT,
        files_json TEXT NOT NULL,
        verdict_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS events_job ON events(job_id, at)`,
      `CREATE INDEX IF NOT EXISTS deliverables_job ON deliverables(job_id, created_at)`,
    ],
    'write',
  )
  // Databases created before these columns existed get them added here.
  const cols = await db().execute('PRAGMA table_info(jobs)')
  if (!cols.rows.some((r) => r.name === 'is_demo')) {
    await db().execute('ALTER TABLE jobs ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.rows.some((r) => r.name === 'ledger_json')) {
    await db().execute('ALTER TABLE jobs ADD COLUMN ledger_json TEXT')
  }
}

export async function sql() {
  ready ??= migrate()
  await ready
  return db()
}

type Row = Record<string, unknown>

/** Jobs created before items had prices get an equal split and no quotes. */
function normalizeCriteria(raw: Partial<Criterion>[], amountCents: number): Criterion[] {
  const split = splitAmount(amountCents, raw.length)
  return raw.map((c, i) => ({
    id: String(c.id),
    title: String(c.title ?? ''),
    description: String(c.description ?? ''),
    method: c.method ?? 'visual',
    amountCents: typeof c.amountCents === 'number' ? c.amountCents : split[i],
    sourceQuote: c.sourceQuote ?? null,
  }))
}

/** Jobs created before the ledger existed: derive it from the job status and PayPal ids. */
function legacyLedger(r: Row, criteria: Criterion[]): Ledger {
  const ledger = emptyLedger(criteria)
  const status = String(r.status)
  if (status === 'released') {
    const at = Number(r.updated_at)
    for (const item of Object.values(ledger.items)) Object.assign(item, { state: 'released', releasedAt: at, releasedBy: 'ai', releaseSeq: 1 })
    const amount = Number(r.amount_cents)
    ledger.releases.push({
      seq: 1, at, itemIds: criteria.map((c) => c.id), amountCents: amount, captureId: String(r.paypal_capture_id ?? ''), finalCapture: true,
      payoutCents: Math.floor(amount * (1 - Number(process.env.PLATFORM_FEE_PERCENT ?? 5) / 100)),
      payoutBatchId: (r.paypal_payout_batch_id as string | null) ?? null,
      payoutStatus: r.paypal_payout_batch_id ? 'paid' : 'processing', reason: 'Released before item-level payments existed.', deliverableId: null,
    })
  }
  if (status === 'refunded') ledger.voidedAt = Number(r.updated_at)
  return ledger
}

function toJob(r: Row): JobRecord {
  const criteria = normalizeCriteria(JSON.parse(String(r.criteria_json)), Number(r.amount_cents))
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    title: String(r.title),
    brief: String(r.brief),
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    freelancerName: String(r.freelancer_name),
    freelancerEmail: String(r.freelancer_email),
    clientName: String(r.client_name),
    clientEmail: String(r.client_email),
    clientToken: String(r.client_token),
    freelancerToken: String(r.freelancer_token),
    status: String(r.status) as JobRecord['status'],
    contractSummary: (r.contract_summary as string | null) ?? null,
    criteria,
    paypalOrderId: (r.paypal_order_id as string | null) ?? null,
    paypalAuthorizationId: (r.paypal_authorization_id as string | null) ?? null,
    paypalCaptureId: (r.paypal_capture_id as string | null) ?? null,
    paypalPayoutBatchId: (r.paypal_payout_batch_id as string | null) ?? null,
    attempts: Number(r.attempts),
    isDemo: Number(r.is_demo ?? 0) === 1,
    ledger: r.ledger_json ? (JSON.parse(String(r.ledger_json)) as Ledger) : legacyLedger(r, criteria),
  }
}

export async function insertJob(job: JobRecord) {
  const c = await sql()
  await c.execute({
    sql: `INSERT INTO jobs (id, created_at, updated_at, title, brief, amount_cents, currency,
      freelancer_name, freelancer_email, client_name, client_email, client_token, freelancer_token,
      status, contract_summary, criteria_json, attempts, is_demo, ledger_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [
      job.id, job.createdAt, job.updatedAt, job.title, job.brief, job.amountCents, job.currency,
      job.freelancerName, job.freelancerEmail, job.clientName, job.clientEmail,
      job.clientToken, job.freelancerToken, job.status, job.contractSummary,
      JSON.stringify(job.criteria),
      job.isDemo ? 1 : 0,
      JSON.stringify(job.ledger),
    ],
  })
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const c = await sql()
  const res = await c.execute({ sql: 'SELECT * FROM jobs WHERE id = ?', args: [id] })
  return res.rows[0] ? toJob(res.rows[0] as Row) : null
}

export async function listJobs(): Promise<JobRecord[]> {
  const c = await sql()
  const res = await c.execute('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500')
  return res.rows.map((r) => toJob(r as Row))
}

const columns = {
  status: 'status',
  contractSummary: 'contract_summary',
  paypalOrderId: 'paypal_order_id',
  paypalAuthorizationId: 'paypal_authorization_id',
  paypalCaptureId: 'paypal_capture_id',
  paypalPayoutBatchId: 'paypal_payout_batch_id',
  attempts: 'attempts',
} as const

type Patch = Partial<Pick<JobRecord, keyof typeof columns | 'criteria' | 'ledger'>>

export async function updateJob(id: string, patch: Patch) {
  const sets: string[] = ['updated_at = ?']
  const args: (string | number | null)[] = [Date.now()]
  for (const [key, col] of Object.entries(columns)) {
    if (key in patch) {
      sets.push(`${col} = ?`)
      args.push((patch as Record<string, string | number | null>)[key])
    }
  }
  if (patch.criteria) {
    sets.push('criteria_json = ?')
    args.push(JSON.stringify(patch.criteria))
  }
  if (patch.ledger) {
    sets.push('ledger_json = ?')
    args.push(JSON.stringify(patch.ledger))
  }
  args.push(id)
  const c = await sql()
  await c.execute({ sql: `UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function insertDeliverable(d: Deliverable) {
  const c = await sql()
  await c.execute({
    sql: `INSERT INTO deliverables (id, job_id, created_at, note, link, files_json, verdict_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [d.id, d.jobId, d.createdAt, d.note, d.link, JSON.stringify(d.files), d.verdict ? JSON.stringify(d.verdict) : null],
  })
}

export async function setDeliverableVerdict(id: string, verdict: Verdict) {
  const c = await sql()
  await c.execute({ sql: 'UPDATE deliverables SET verdict_json = ? WHERE id = ?', args: [JSON.stringify(verdict), id] })
}

/** Verdicts saved before item-level payments: fill in the fields newer code expects. */
function normalizeVerdict(raw: Verdict | null): Verdict | null {
  if (!raw) return null
  const results = (raw.results ?? []).map((r) => ({ ...r, fileIndex: r.fileIndex ?? null, region: r.region ?? null, quote: r.quote ?? null }))
  const releasedIds = raw.releasedIds ?? (raw.decision === 'release' ? results.map((r) => r.id) : [])
  return {
    ...raw,
    results,
    releasedIds,
    heldIds: raw.heldIds ?? results.map((r) => r.id).filter((id) => !releasedIds.includes(id)),
    injectionDetected: raw.injectionDetected ?? /instruct the reviewer/i.test(raw.policyNote ?? ''),
  }
}

function toDeliverable(r: Row): Deliverable {
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    createdAt: Number(r.created_at),
    note: String(r.note),
    link: (r.link as string | null) ?? null,
    files: JSON.parse(String(r.files_json)),
    verdict: normalizeVerdict(r.verdict_json ? (JSON.parse(String(r.verdict_json)) as Verdict) : null),
  }
}

export async function listDeliverables(jobId: string): Promise<Deliverable[]> {
  const c = await sql()
  const res = await c.execute({ sql: 'SELECT * FROM deliverables WHERE job_id = ? ORDER BY created_at DESC', args: [jobId] })
  return res.rows.map((r) => toDeliverable(r as Row))
}

export async function getDeliverable(jobId: string, id: string): Promise<Deliverable | null> {
  const c = await sql()
  const res = await c.execute({ sql: 'SELECT * FROM deliverables WHERE job_id = ? AND id = ?', args: [jobId, id] })
  return res.rows[0] ? toDeliverable(res.rows[0] as Row) : null
}

export async function addEvent(jobId: string, actor: JobEvent['actor'], type: string, message: string) {
  const c = await sql()
  await c.execute({
    sql: 'INSERT INTO events (job_id, at, actor, type, message) VALUES (?, ?, ?, ?, ?)',
    args: [jobId, Date.now(), actor, type, message],
  })
}

export async function listEvents(jobId: string): Promise<JobEvent[]> {
  const c = await sql()
  const res = await c.execute({ sql: 'SELECT * FROM events WHERE job_id = ? ORDER BY at ASC, id ASC', args: [jobId] })
  return res.rows.map((r) => ({
    at: Number(r.at),
    actor: String(r.actor) as JobEvent['actor'],
    type: String(r.type),
    message: String(r.message),
  }))
}
