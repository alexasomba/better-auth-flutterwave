---
name: flutterwave-testing-fixtures
description: Create accurate Flutterwave adapter, checkout, webhook, subscription, and reconciliation tests.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.9" # x-release-please-version
compatibility: "Node.js >=22; Vitest; flutterwave-node-v3 1.4.x"
---

# Flutterwave testing fixtures

Inject the SDK-shaped client and `fetch`; do not call the network in unit tests. Validate every
untyped SDK response through the same Zod schemas used in production.

Cover exact `txRef`, amount, currency, and status verification; malformed responses; duplicate and
out-of-order deliveries; numeric plan/subscription IDs; token encryption; hosted-checkout renewal
fallback; asynchronous refunds; and provider coexistence.

Webhook fixtures use HMAC-SHA256 over the exact raw bytes with `flutterwave-signature` and
`secretHash`. Include tampered-body and invalid-signature cases.
