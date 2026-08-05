---
name: flutterwave-tanstack-start
description: Integrate Better Auth Flutterwave into a TanStack Start application.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.10" # x-release-please-version
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
