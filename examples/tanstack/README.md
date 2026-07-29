# Better Auth Flutterwave – TanStack Start example

This application demonstrates Better Auth sessions, organization authorization, Flutterwave
Standard checkout, verified transactions, native and local subscriptions, a local product catalog,
and trusted server operations.

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

1. Sign in and choose personal or organization billing.
2. Initialize checkout with an amount, currency, billing email, and absolute `redirectUrl`.
3. Flutterwave redirects to `/billing/flutterwave/callback` with `transaction_id`, `tx_ref`, and
   `status`.
4. The callback invokes server verification. UI success is shown only after status, `txRef`,
   amount, and currency match.
5. Subscription and transaction lists read the persisted, provider-namespaced records.

A native plan is configured with numeric `paymentPlanId` and starts through card checkout. A local
plan omits that ID and demonstrates locally orchestrated trials, periods, seats, limits, and
renewals.

Products and inventory in this example are local. Flutterwave does not provide the remote product
catalog used by the application.

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
