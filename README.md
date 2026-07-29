# Better Auth Flutterwave

A TypeScript-first [Better Auth](https://www.better-auth.com) plugin for Flutterwave v3 payments.
It supports Flutterwave Standard checkout, verified one-time payments, native payment-plan
subscriptions, locally managed subscriptions, organization billing, marketplace split payments,
webhooks, refunds, and reconciliation.

> This project is being adapted from
> [`@alexasomba/better-auth-paystack`](https://github.com/alexasomba/better-auth-paystack), but its
> provider boundary follows Flutterwave semantics. Paystack customer, plan, product, authorization,
> portal, and webhook behavior must not be assumed to exist in Flutterwave.

## Install

```bash
npm install better-auth @alexasomba/better-auth-flutterwave flutterwave-node-v3
```

Node.js 22 or newer is required.

## Configure

```env
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_SECRET_HASH=your-dashboard-webhook-secret-hash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

```ts
import { betterAuth } from "better-auth";
import { flutterwave } from "@alexasomba/better-auth-flutterwave";

export const auth = betterAuth({
  plugins: [
    flutterwave({
      publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY!,
      secretKey: process.env.FLUTTERWAVE_SECRET_KEY!,
      secretHash: process.env.FLUTTERWAVE_SECRET_HASH!,
      subscription: {
        enabled: true,
        plans: [
          {
            name: "pro",
            paymentPlanId: 12345,
            amount: 5_000,
            currency: "NGN",
            interval: "monthly",
          },
          {
            name: "starter",
            amount: 2_000,
            currency: "NGN",
            interval: "monthly",
          },
        ],
      },
      organization: { enabled: true },
      marketplace: {
        allowedSubaccountIds: ["RS_1234567890"],
      },
    }),
  ],
});
```

`flutterwaveClient` may be injected for testing or advanced integrations, and `fetch` may be
injected for the narrow direct-HTTP operations used by Flutterwave Standard. By default, the plugin
constructs `flutterwave-node-v3` from the public and secret keys.

Configure the client plugin:

```ts
import { createAuthClient } from "better-auth/client";
import { flutterwaveClient } from "@alexasomba/better-auth-flutterwave/client";

export const authClient = createAuthClient({
  plugins: [flutterwaveClient({ subscription: true })],
});
```

Then generate or migrate the Better Auth schema:

```bash
npx better-auth migrate
```

## Checkout and verification

Flutterwave Standard checkout requires an explicit amount, currency, redirect URL, and billing
email. The plugin generates a unique `txRef`.

```ts
const checkout = await authClient.flutterwave.transaction.initialize({
  amount: 5_000,
  currency: "NGN",
  email: session.user.email,
  redirectUrl: `${window.location.origin}/billing/flutterwave/callback`,
});

window.location.assign(checkout.data.link);
```

After redirect, send the transaction ID and expected reference to the verification action:

```ts
await authClient.flutterwave.transaction.verify({
  transactionId: Number(searchParams.get("transaction_id")),
});
```

Fulfillment only happens after server-side verification confirms the transaction status, `txRef`,
amount, and currency. A redirect or webhook payload alone is never proof of payment.

The typed browser surface is intentionally limited to:

- `authClient.flutterwave.transaction.initialize`, `verify`, and `list`
- `authClient.subscription.create`, `upgrade`, `cancel`, `restore`, and `list`
- Read-only provider configuration and local catalog actions under `authClient.flutterwave`

Reconciliation, renewals, remote plan synchronization, refunds, and subaccount administration are
trusted-server operations and are not exposed to browser clients.

## Subscription models

### Flutterwave-native plans

Set a numeric `paymentPlanId` on a configured plan. Enrollment starts with a card checkout carrying
that plan ID. After verification, the plugin resolves the Flutterwave subscription using the
verified transaction, immutable billing email, and payment plan.

Flutterwave has no separate “create subscription” endpoint for this flow. Provider-native plans do
not pretend to support provider-side trials or prorated mutations.

### Locally managed plans

Omit `paymentPlanId` for a locally renewed subscription. The plugin stores the subscription,
group, seat count, and entitlement configuration locally. Automated trial transitions, scheduled
plan mutations, and proration orchestration are not part of the initial release.

Trusted-server renewal prefers that encrypted token. If no token is available, renewal creates a
hosted checkout and remains pending until the resulting payment is verified.

## Organization and marketplace billing

Organization billing controls local ownership and authorization. Flutterwave billing identity is
an email; the plugin does not create or persist a fictional Flutterwave customer record on users or
organizations.

Marketplace split payments are a separate concern. Configure existing, KYC-approved Flutterwave
subaccount IDs in `marketplace.allowedSubaccountIds`. Per-checkout overrides must be authorized and
must reference the allowlist. The plugin does not provision subaccounts or automatically equate an
organization with a Flutterwave subaccount.

## Webhooks

Point Flutterwave at your Better Auth Flutterwave webhook endpoint. The plugin verifies
`flutterwave-signature` as an HMAC-SHA256 digest of the exact raw request body using the separately
configured `secretHash`. It compares signatures in constant time, records idempotency state, and
re-verifies payment transactions before granting value. Keep custom `onEvent` work short so the
endpoint can acknowledge within Flutterwave's timeout.

Do not parse and reserialize the request before signature verification. Do not use the API
`secretKey` as the webhook secret hash.

Polling and reconciliation are provided for pending transactions, subscriptions, and refunds, so
correctness does not depend on webhook delivery.

## Data model

Provider-owned records are namespaced so this plugin can coexist with other billing providers:

- `flutterwaveTransaction`
- `flutterwaveSubscription`
- `flutterwaveProduct` (local catalog only)
- `flutterwavePlan`
- `flutterwaveWebhookEvent`
- `flutterwaveRefund`

Public identifiers use Flutterwave-native names: `txRef`, `transactionId`, `flwRef`,
`paymentPlanId`, `subscriptionId`, `secretHash`, and `subaccountId`.

## SDK behavior

[`flutterwave-node-v3`](https://www.npmjs.com/package/flutterwave-node-v3) is an untyped CommonJS
SDK. The plugin keeps it behind a Zod-validated adapter, uses only its Promise APIs, and prevents
SDK `any` values from leaking into the public API.

The SDK performs always-on telemetry and may write telemetry data through an operating-system
temporary file. This behavior comes from the upstream SDK, not Better Auth or this plugin. Review
the SDK and your deployment environment’s privacy, filesystem, and serverless constraints before
adopting it. Injecting a compatible client helps with tests but does not change upstream behavior
when the official SDK is used.

## Development

This repository uses [Vite+](https://viteplus.dev):

```bash
vp install
vp check
vp test
vp pack
pnpm run lint:types
pnpm run lint:package
```

Integration tests require Flutterwave sandbox credentials and are opt-in:

```bash
RUN_INTEGRATION_TESTS=1 vp test
```

## License

MIT
