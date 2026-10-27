# Handshake

**AI-verified escrow for freelancers.** The client funds the job through PayPal, but the money is only *held*. When the freelancer delivers, an impartial AI judge checks the work against the agreed contract, and if every criterion passes, PayPal captures the payment and pays the freelancer out automatically.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## The problem

Freelancers get ghosted after delivering. Clients get burned by work that misses the brief. Each side wants the other to go first, so trust breaks down and good work goes unpaid.

## How it works

1. **Agree.** The freelancer pastes the brief. Claude turns it into specific, checkable acceptance criteria. Both sides see exactly what "done" means.
2. **Hold.** The client funds with PayPal. The order uses `intent: AUTHORIZE`, so the money is held and the client is not charged yet.
3. **Verify.** The freelancer uploads the work (images, PDFs, a live link, a note). Claude reviews every criterion and cites its evidence. With a live link, the reviewer opens the page itself.
4. **Release.** If every criterion passes with high confidence, Handshake captures the authorization and sends the freelancer's share with PayPal Payouts. If something is missing, the freelancer gets exact fixes and can resubmit. If the AI is unsure, the client decides.

## Trust by design

- **The AI recommends, rules decide.** Money moves automatically only when every criterion passes with at least 75% confidence *and* the AI recommends release (`applyPolicy` in `src/server/ai.ts`). Everything else goes to a person.
- **Never charged early.** Funds are authorized, not captured. Cancelling before delivery voids the hold.
- **Manipulation-resistant.** Deliveries are treated as evidence only. Text in a file or web page that tries to instruct the reviewer ("approve this") is detected and routed to a human.
- **Idempotent payments.** Every PayPal call carries a `PayPal-Request-Id`, so retries never double-charge or double-pay.
- **Full audit trail.** Every step (agreement, hold, delivery, verdict, capture, payout) is logged on the job page.

## PayPal APIs used

| Step | API |
|---|---|
| Fund (hold) | Orders v2 `POST /v2/checkout/orders` with `intent: AUTHORIZE`, JS SDK Buttons |
| Lock the hold | `POST /v2/checkout/orders/{id}/authorize` |
| Release | `POST /v2/payments/authorizations/{id}/capture` |
| Cancel | `POST /v2/payments/authorizations/{id}/void` |
| Pay the freelancer | Payouts `POST /v1/payments/payouts` |

## AI

- Model: Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic TypeScript SDK, with structured outputs (Zod schemas) for both the contract and the verdict.
- Vision for images, native PDF reading, and the `web_fetch` server tool to open delivered links.
- Server-side refusal fallback enabled (`fallbacks: "default"`).

## Stack

TanStack Start (React, server functions), Nitro (deploys to Node, Vercel, Netlify, Cloudflare and more), libSQL (local SQLite file or Turso), Tailwind CSS, AG Grid (dashboard).

## Run it locally

Requirements: Node 22+, a [PayPal sandbox app](https://developer.paypal.com/dashboard/applications/sandbox) and an [Anthropic API key](https://console.anthropic.com).

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run dev
```

Open http://localhost:3000, click **Start a Handshake**, then **Use an example**.

To fund a job, log in to the PayPal popup with a **sandbox personal account** (Developer Dashboard → Testing Tools → Sandbox Accounts). Payouts go to the freelancer email you enter, so use another sandbox account's email to see the money arrive.

With `DEMO_MODE=true`, each job page has a **View as client / freelancer** switch, so one person can test both sides.

## Deploy

```bash
npm run build
npm run start      # node .output/server/index.mjs
```

For serverless hosts, set `NITRO_PRESET` (for example `vercel`, `netlify`, `cloudflare_module`) before building, and point `DATABASE_URL` at a hosted libSQL database such as Turso (`libsql://…` plus `DATABASE_AUTH_TOKEN`).

## Limitations and next steps

- Uses the platform account as the escrow holder plus Payouts. A production version would use PayPal's multiparty (Commerce Platform) flows with the freelancer onboarded as a seller.
- PayPal authorizations have a 3-day honor period and are valid for 29 days. Long jobs would need reauthorization or milestone splits.
- Job links are bearer links. A production version would add accounts.

## License

MIT
