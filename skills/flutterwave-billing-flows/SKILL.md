---
name: flutterwave-billing-flows
description: Build verified Flutterwave checkout and subscription flows with Better Auth.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.5" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6; flutterwave-node-v3 1.4.x"
---

# Flutterwave billing flows

Initialize one-time payments with explicit `amount`, `currency`, `email`, and `redirectUrl` through
`authClient.flutterwave.transaction.initialize`. The plugin generates `txRef`. Complete the flow
with `.verify({ transactionId, txRef })`; never fulfill from a redirect alone.

Use `authClient.subscription.create`, `upgrade`, `cancel`, `restore`, and `list` for subscription
actions. A native subscription starts with card checkout carrying numeric `paymentPlanId`; there is
no standalone Flutterwave subscription-create operation. Locally managed subscriptions omit
`paymentPlanId`.

Reconciliation, renewals, refunds, plan sync, and subaccount administration are server-only.
