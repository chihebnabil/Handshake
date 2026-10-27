import { createClient, type Client } from '@libsql/client'
import type { Criterion, Deliverable, JobEvent, JobRecord, Verdict } from '~/lib/types'

let client: Client | undefined
let ready: Promise<void> | undefined

function db(): Client {
  client ??= createClient({
    url: process.env.DATABASE_URL || 'file:handshake.db',
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
        attempts INTEGER NOT NULL DEFAULT 0
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
}

export async function sql() {
  ready ??= migrate()
  await ready
  return db()
}

type Row = Record<string, unknown>

function toJob(r: Row): JobRecord {
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
    criteria: JSON.parse(String(r.criteria_json)) as Criterion[],
    paypalOrderId: (r.paypal_order_id as string | null) ?? null,
    paypalAuthorizationId: (r.paypal_authorization_id as string | null) ?? null,
    paypalCaptureId: (r.paypal_capture_id as string | null) ?? null,
    paypalPayoutBatchId: (r.paypal_payout_batch_id as string | null) ?? null,
    attempts: Number(r.attempts),
  }
}

export async function insertJob(job: JobRecord) {
  const c = await sql()
  await c.execute({
    sql: `INSERT INTO jobs (id, created_at, updated_at, title, brief, amount_cents, currency,
      freelancer_name, freelancer_email, client_name, client_email, client_token, freelancer_token,
      status, contract_summary, criteria_json, attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      job.id, job.createdAt, job.updatedAt, job.title, job.brief, job.amountCents, job.currency,
      job.freelancerName, job.freelancerEmail, job.clientName, job.clientEmail,
      job.clientToken, job.freelancerToken, job.status, job.contractSummary,
      JSON.stringify(job.criteria),
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

type Patch = Partial<Pick<JobRecord, keyof typeof columns | 'criteria'>>

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

export async function listDeliverables(jobId: string): Promise<Deliverable[]> {
  const c = await sql()
  const res = await c.execute({ sql: 'SELECT * FROM deliverables WHERE job_id = ? ORDER BY created_at DESC', args: [jobId] })
  return res.rows.map((r) => ({
    id: String(r.id),
    jobId: String(r.job_id),
    createdAt: Number(r.created_at),
    note: String(r.note),
    link: (r.link as string | null) ?? null,
    files: JSON.parse(String(r.files_json)),
    verdict: r.verdict_json ? (JSON.parse(String(r.verdict_json)) as Verdict) : null,
  }))
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
