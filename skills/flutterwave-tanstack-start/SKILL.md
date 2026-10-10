---
name: flutterwave-tanstack-start
description: Integrate Better Auth Flutterwave into a TanStack Start application.
metadata:
  library: "better-auth-flutterwave"
  version: "0.4.0" # x-release-please-version
compatibility: "Node.js >=22; TanStack Start; better-auth ^1.6"
---

# Flutterwave with TanStack Start

Create the server plugin with `publicKey`, `secretKey`, and `secretHash`; keep all three in
server-only environment bindings. Register `flutterwaveClient` in the browser auth client.

Initialize checkout with amount, currency, email, and an absolute `redirectUrl`. On the callback
route, read `transaction_id`, `tx_ref`, and `status`, then call the typed verification action.
Render success only after server verification.

Keep reconciliation, renewal, refund, plan sync, and subaccount administration in server functions
that independently authorize the current user.

Use a custom Worker server entry for scheduled events. The persistent example uses the same D1
binding for requests and `processScheduledFlutterwaveCancellations`; run it with `build:billing`
or `dev:billing` after applying the reviewed migration. Its default memory demo cannot reliably
process schedules across isolates and has no Cron Trigger. Do not expose the processor as an
unauthenticated HTTP or browser action.
