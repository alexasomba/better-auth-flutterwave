# Better Auth Flutterwave

A TypeScript-first [Better Auth](https://www.better-auth.com) plugin for Flutterwave v3 payments.
It supports Flutterwave Standard checkout, verified one-time payments, native payment-plan
subscriptions, locally managed subscriptions, organization billing, marketplace split payments,
webhooks, refunds, and reconciliation.

## Install

```bash
npm install better-auth better-auth-flutterwave flutterwave-node-v3
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
import { organization } from "better-auth/plugins";
import { flutterwave } from "better-auth-flutterwave";

export const auth = betterAuth({
  plugins: [
    organization(),
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
import { flutterwaveClient } from "better-auth-flutterwave/client";

export const authClient = createAuthClient({
  plugins: [flutterwaveClient({ subscription: true })],
});
```

Then generate the Better Auth schema and apply it with your database migration workflow:

```bash
npx @better-auth/cli generate
```

For supported direct-migration setups, you can instead run:

```bash
npx @better-auth/cli migrate
```

## Checkout and verification

Flutterwave Standard checkout requires an amount, currency, redirect URL, and billing email. The
browser supplies the amount and currency directly or selects a configured plan/product; the server
resolves billing email from the authenticated user or authorized organization owner. The plugin
generates a unique `txRef`.

```ts
const checkout = await authClient.flutterwave.transaction.initialize(
  {
    amount: 5_000,
    currency: "NGN",
    redirectUrl: `${window.location.origin}/billing/flutterwave/callback`,
  },
  { throw: true },
);

window.location.assign(checkout.url);
```

After redirect, send exactly one transaction locator to the verification action:

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

## Trusted server operations

Privileged operations are exported from the server entry point:

```ts
import {
  chargeSubscriptionRenewal,
  reconcileFlutterwaveRefunds,
  reconcileFlutterwaveTransaction,
  refundFlutterwaveTransaction,
  syncFlutterwavePlans,
} from "better-auth-flutterwave";
```

They require a trusted Better Auth endpoint context plus the same Flutterwave options used by the
plugin. Call them only from independently authorized server routes, queue consumers, or scheduled
jobs:

- `syncFlutterwavePlans` imports remote Flutterwave payment plans into namespaced local records.
- `chargeSubscriptionRenewal` uses an encrypted reusable token when available, otherwise returns a
  hosted-checkout URL and leaves renewal pending.
- `refundFlutterwaveTransaction` starts a full or partial asynchronous refund.
- `reconcileFlutterwaveTransaction` polls and verifies a pending transaction.
- `reconcileFlutterwaveRefunds` refreshes pending refund records.

## Packaged agent skills

The npm package ships version-matched coding-agent skills in its `skills/` directory. They help an
agent implement the supported Flutterwave API, data model, security rules, and examples without
guessing provider behavior.

Install the skill linker in your application and run its one-time setup:

```bash
npm install --save-dev skills-npm
npx skills-npm setup
```

`skills-npm setup` adds a `prepare` hook and links skills from installed npm packages into the
locations detected for Codex, Claude Code, Cursor, and other supported agents. To select only this
package, create:

```ts
// skills-npm.config.ts
import { defineConfig } from "skills-npm";

export default defineConfig({
  include: ["better-auth-flutterwave"],
});
```

Refresh the links with `npx skills-npm --force`, or preview changes with
`npx skills-npm --dry-run`.

| Skill                               | Use it for                                               |
| ----------------------------------- | -------------------------------------------------------- |
| `$better-auth-flutterwave-setup`    | Initial server/client setup, credentials, and migrations |
| `$flutterwave-billing-flows`        | Checkout, verification, and subscription flows           |
| `$flutterwave-client-api`           | Typed browser actions and client/server boundaries       |
| `$flutterwave-local-subscriptions`  | Encrypted token renewal and hosted-checkout fallback     |
| `$flutterwave-organization-billing` | Organization ownership, roles, and split payments        |
| `$flutterwave-catalog-limits`       | Plans, local products, inventory, seats, and limits      |
| `$flutterwave-webhooks-events`      | Webhook signatures, idempotency, and re-verification     |
| `$flutterwave-schema-migrations`    | Namespaced schema generation and migrations              |
| `$flutterwave-testing-fixtures`     | Unit, sandbox, webhook, and reconciliation tests         |
| `$flutterwave-tanstack-start`       | TanStack Start integration                               |

Invoke a skill explicitly in your agent prompt:

```text
Use $better-auth-flutterwave-setup to add Better Auth Flutterwave to this application.
```

```text
Use $flutterwave-webhooks-events to review my webhook route and add signature tests.
```

```text
Use $flutterwave-organization-billing to implement organization checkout with allowlisted splits.
```

Including the `$skill-name` in the prompt is the most portable explicit invocation form.

## Data model

Provider-owned records are namespaced so this plugin can coexist with other billing providers:

- `flutterwaveTransaction`
- `flutterwaveSubscription`
- `flutterwaveProduct` (local catalog only)
- `flutterwavePlan`
- `flutterwaveWebhookEvent`
- `flutterwaveRefund`

The Paystack plugin is being aligned incrementally with this provider-namespaced approach. Its
transaction, catalog, and webhook records are provider-namespaced today; its legacy generic
subscription table remains compatibility-sensitive until the planned migration is released. The
two existing plugins can still be installed together because Flutterwave's subscription and other
provider records are namespaced separately. Shared application behavior should rely on each
provider's normalized lifecycle fields and reference authorization rather than assuming that either
provider exposes the other's customer or subscription identifiers.

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
RUN_INTEGRATION_TESTS=true vp test
```

## License

MIT
