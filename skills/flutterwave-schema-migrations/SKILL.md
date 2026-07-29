---
name: flutterwave-schema-migrations
description: Review or migrate the namespaced Better Auth Flutterwave persistence schema.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.5" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6"
---

# Flutterwave schema migrations

Provider records are `flutterwaveTransaction`, `flutterwaveSubscription`, `flutterwaveProduct`,
`flutterwavePlan`, `flutterwaveWebhookEvent`, and `flutterwaveRefund`. Keep provider IDs, expected
and charged amounts, currency, lifecycle state, periods, local ownership, and reconciliation
timestamps distinct.

Do not add Flutterwave customer fields to `user` or `organization`. Store the immutable native
subscription email on its record. Reusable payment tokens must be encrypted and never selected into
client-visible output. Verify coexistence with other billing-provider schemas after migrations.
