---
name: flutterwave-client-api
description: Use the typed browser client exposed by @alexasomba/better-auth-flutterwave.
metadata:
  library: "@alexasomba/better-auth-flutterwave"
  version: "0.1.0"
compatibility: "Node.js >=22; better-auth ^1.6"
---

# Flutterwave client API

The canonical transaction actions are
`authClient.flutterwave.transaction.initialize`, `.verify`, and `.list`.
The canonical subscription actions are `authClient.subscription.create`, `.upgrade`, `.cancel`,
`.restore`, and `.list`.

Use `txRef`, `transactionId`, `flwRef`, `paymentPlanId`, `subscriptionId`, and `subaccountId`;
do not translate Paystack reference, plan-code, subscription-code, email-token, customer-code, or
billing-portal concepts. Privileged reconciliation, renewal, refund, and sync operations are not
browser actions.
