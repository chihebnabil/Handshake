// Thin wrapper over the PayPal REST APIs Handshake uses:
//   Orders v2 (intent AUTHORIZE)  -> the client's money is held, not taken
//   Payments v2 capture / void    -> release the hold, or cancel it
//   Payouts v1                    -> send the freelancer their share

const BASE =
  process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

let cachedToken: { value: string; expiresAt: number } | undefined

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message)
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const id = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!res.ok || !body.access_token) throw new PayPalError('PayPal authentication failed', res.status, body)
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 }
  return body.access_token
}

/** `requestId` makes the call idempotent: retrying it never double-charges or double-pays. */
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  if (requestId) headers['PayPal-Request-Id'] = requestId
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const detail = json?.details?.[0]?.description ?? json?.message ?? res.statusText
    throw new PayPalError(`PayPal ${path}: ${detail}`, res.status, json)
  }
  return json as T
}

const money = (cents: number, currency: string) => ({ currency_code: currency, value: (cents / 100).toFixed(2) })

export async function createHoldOrder(opts: {
  jobId: string
  title: string
  amountCents: number
  currency: string
}) {
  const order = await call<{ id: string }>(
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: opts.jobId,
          custom_id: opts.jobId,
          description: `Handshake escrow: ${opts.title}`.slice(0, 127),
          amount: money(opts.amountCents, opts.currency),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Handshake',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'CONTINUE',
          },
        },
      },
    },
    `order-${opts.jobId}`,
  )
  return order.id
}

interface AuthorizeResponse {
  status: string
  purchase_units: { payments?: { authorizations?: { id: string; status: string; expiration_time?: string }[] } }[]
}

export async function authorizeOrder(orderId: string) {
  const res = await call<AuthorizeResponse>('POST', `/v2/checkout/orders/${orderId}/authorize`, {}, `auth-${orderId}`)
  const auth = res.purchase_units[0]?.payments?.authorizations?.[0]
  if (!auth) throw new PayPalError('PayPal did not return an authorization', 500, res)
  return { authorizationId: auth.id, status: auth.status, expiresAt: auth.expiration_time ?? null }
}

export async function captureAuthorization(authorizationId: string) {
  const res = await call<{ id: string; status: string }>(
    'POST',
    `/v2/payments/authorizations/${authorizationId}/capture`,
    { final_capture: true },
    `capture-${authorizationId}`,
  )
  return { captureId: res.id, status: res.status }
}

export async function voidAuthorization(authorizationId: string) {
  await call('POST', `/v2/payments/authorizations/${authorizationId}/void`, undefined, `void-${authorizationId}`)
}

export async function payoutToFreelancer(opts: {
  jobId: string
  email: string
  amountCents: number
  currency: string
  title: string
}) {
  const res = await call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    'POST',
    '/v1/payments/payouts',
    {
      sender_batch_header: {
        sender_batch_id: `handshake-${opts.jobId}`,
        email_subject: 'You got paid through Handshake',
        email_message: `Your delivery for "${opts.title}" was verified and the payment was released.`,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: opts.email,
          amount: { value: (opts.amountCents / 100).toFixed(2), currency: opts.currency },
          note: `Handshake: ${opts.title}`.slice(0, 4000),
          sender_item_id: opts.jobId,
        },
      ],
    },
    `payout-${opts.jobId}`,
  )
  return { batchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status }
}
