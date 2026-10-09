# Better Auth Flutterwave – TanStack Start example

This application demonstrates Better Auth sessions, organization authorization, Flutterwave
Standard checkout, verified transactions, native and local subscriptions, a local product catalog,
subscription cancellation/restoration, transaction history, and trusted server operations.

## Environment

```env
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_SECRET_HASH=your-dashboard-webhook-secret-hash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

Install and run from the repository root:

```bash
vp install
vp dev
```

## Demonstrated flow

1. Sign in and choose personal or organization billing from the dashboard.
2. Select a configured plan or local product. Organization checkout can include a seat quantity.
3. Initialize checkout with an amount, currency, billing email, and absolute `redirectUrl`.
4. Flutterwave redirects to `/billing/flutterwave/callback` with `transaction_id`, `tx_ref`, and
   `status`.
5. The callback invokes server verification. UI success is shown only after status, `txRef`,
   amount, and currency match.
6. Subscription cancellation/restoration and transaction lists read the provider-namespaced
   records. The default demo keeps them in memory and loses them when its Worker isolate restarts.

A native plan is configured with numeric `paymentPlanId` and starts through card checkout. A local
plan omits that ID and demonstrates locally orchestrated trials, periods, seats, limits, and
renewals.

Products and inventory in this example are local. Flutterwave does not provide the remote product
catalog used by the application.

## Persistent billing and scheduled cancellation

The optional `wrangler.billing.jsonc` configuration uses D1 and runs the Worker scheduled handler
every five minutes. It uses the same database and Flutterwave configuration as HTTP requests.
The handler ends due paid access through `processScheduledFlutterwaveCancellations`, processes at
most 1,000 requests per invocation, and rejects an invocation with failed IDs so it is visible in
scheduled-event monitoring. Failed records remain scheduled for the next invocation. Larger
backlogs continue on the next run.

For local D1, use the provided placeholder database ID and sandbox-only credentials in your
ignored `.dev.vars` file:

```bash
vp run db:billing:check
vp run db:billing:migrate:local
vp run dev:billing
```

You can trigger the schedule locally with:

```bash
curl 'http://localhost:3000/cdn-cgi/handler/scheduled?cron=*/5%20*%20*%20*%20*'
```

Before a persistent deployment, replace the placeholder D1 ID, set the actual public URL, configure
server secrets, and apply the reviewed migration to that database. `0001_billing.sql` initializes a
fresh database, including the unique webhook `eventId`; it must not be replayed over an existing
schema. The scheduled handler refuses to process billing without D1 or configured Flutterwave
keys. The default memory configuration has no Cron Trigger.

Native scheduling stops provider billing immediately but preserves paid access until `periodEnd`;
the scheduled handler ends that access. Local billing changes only local records. No payment is
charged by this handler.

The checked-in migration comes from the installed Better Auth and library schemas, generated with
an empty local SQLite database and placeholder keys. Regenerate it before the first deployment
when changing those schemas:

```bash
vp run db:billing:generate
vp run db:billing:check
vp run build:billing
vp run wrangler:dry-run
```

After a database has been deployed, create a reviewed incremental migration for later schema
changes. Library version 0.2.1 already defines webhook event uniqueness; existing users should
verify that constraint in their database before enabling concurrent webhook deliveries.

## Security notes

- `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY`, and `FLUTTERWAVE_SECRET_HASH` stay in server
  bindings.
- Webhooks use HMAC-SHA256 over the exact raw body and the `flutterwave-signature` header.
- Organization billing and marketplace splits are independently authorized.
- Reconciliation, renewal, refunds, payment-plan sync, and subaccount administration are server
  functions, never browser client actions.
- A reusable payment token is encrypted at rest and never rendered or logged.

## Validation

```bash
vp check
vp test
vp run build
```

Live Flutterwave sandbox tests are opt-in and require sandbox credentials.
