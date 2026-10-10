---
name: flutterwave-schema-migrations
description: Review or migrate the namespaced Better Auth Flutterwave persistence schema.
metadata:
  library: "better-auth-flutterwave"
  version: "0.4.0" # x-release-please-version
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

Webhook `eventId` must have a database uniqueness constraint for concurrent event claims. This
constraint is already present in the 0.2.1 plugin schema; inspect the actual deployed database
before assuming a legacy migration created it. The TanStack example ships a generated initial
D1 migration and a schema drift check. Use incremental reviewed migrations after deployment;
never reapply its initial migration to an existing database.
