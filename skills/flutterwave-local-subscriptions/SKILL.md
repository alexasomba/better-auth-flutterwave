---
name: flutterwave-local-subscriptions
description: Implement local subscription lifecycle and tokenized Flutterwave renewal.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.6" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6; flutterwave-node-v3 1.4.x"
---

# Flutterwave local subscriptions

A plan without `paymentPlanId` is locally renewed. Better Auth stores its group, seats, limits,
period state, and encrypted reusable token. Automated trials, scheduled changes, and proration are
not available in the initial release.

Persist reusable Flutterwave payment tokens encrypted with a key derived from the Better Auth
secret. Never return or log a token. Trusted-server renewal prefers the token; if none exists,
create hosted checkout and leave renewal pending until verification.
