---
name: flutterwave-webhooks-events
description: Implement secure and idempotent Flutterwave webhook handling.
metadata:
  library: "better-auth-flutterwave"
  version: "0.2.2" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6"
---

# Flutterwave webhooks and events

Read the exact raw body. Compute HMAC-SHA256 with the separately configured `secretHash`, compare
it to `flutterwave-signature` in constant time, persist idempotency, and acknowledge quickly.

Re-verify transactions before granting value. Expect duplicate, delayed, and out-of-order events.
Use polling/reconciliation for pending transactions, subscriptions, and refunds. Never substitute
the API secret key for `secretHash` or reserialize JSON before signature verification.

The handler records completion only after reconciliation and `onEvent` succeed. Failures and busy
claims return HTTP 503 so delivery can be retried; abandoned claims can be reclaimed after five
minutes. Application callbacks must be idempotent because delivery is at least once, including a
crash after external work succeeds but before its completion is persisted.
