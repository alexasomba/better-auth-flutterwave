---
name: flutterwave-client-api
description: Use the typed browser client exposed by better-auth-flutterwave.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.3" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6"
---

# Flutterwave client API

The canonical transaction actions are
`authClient.flutterwave.transaction.initialize`, `.verify`, and `.list`.
The canonical subscription actions are `authClient.subscription.create`, `.upgrade`, `.cancel`,
`.restore`, and `.list`.

Use `txRef`, `transactionId`, `flwRef`, `paymentPlanId`, `subscriptionId`, and `subaccountId`.
Do not invent remote customer records, billing portals, or management links that Flutterwave does
not provide. Privileged reconciliation, renewal, refund, and sync operations are not browser
actions.
