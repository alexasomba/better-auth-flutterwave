# Better Auth Flutterwave Intent Skill Spec

This package should expose skills for agents implementing Flutterwave billing with Better Auth. The skills should be task-focused and grounded in the public package surface:

- `flutterwave()` server plugin from `better-auth-flutterwave`
- `flutterwaveClient()` client plugin from `better-auth-flutterwave/client`
- subscription actions: `create`, `upgrade`, `cancel`, `restore`, `list`
- transaction actions: initialize, verify, list
- server-only operations: renewal, reconciliation, refunds, and `syncFlutterwavePlans`
- organization authorization defaults: `owner`/`admin` unless `subscription.authorizeReference` is supplied

Generate flat skills because the package is focused and has fewer than five high-value agent intents.

## Skill List

1. `better-auth-flutterwave/setup`
   - Use when installing or configuring the package with Better Auth.
   - Cover server and client plugin setup, schema behavior, environment secrets, products/plans, and canonical client namespaces.

2. `better-auth-flutterwave/subscriptions-and-transactions`
   - Use when building checkout, transaction verification, subscription lifecycle, products/plans, or recurring renewal/catalog sync flows.
   - Emphasize browser-safe client methods vs server-only helpers.

3. `better-auth-flutterwave/organization-billing`
   - Use when enabling organization billing, owner/admin authorization, custom `authorizeReference`, customer creation, seats, teams, invitations, and member limits.

4. `better-auth-flutterwave/billing-catalog-and-limits`
   - Use when configuring products, plans, native vs local billing, seat billing, plan limits, and catalog sync.
   - Emphasize `paymentPlanId`, local products, `freeTrial`, `seatAmount`, limits, and
     `syncFlutterwavePlans`.

5. `better-auth-flutterwave/tanstack-start`
   - Use when integrating the package in the TanStack Start example pattern, including API routes, `tanstackStartCookies()`, server functions, and Cloudflare Worker deployment.

## Shared Constraints

- Include `license: "MIT"` and `compatibility` frontmatter in every skill shipped to npm.
- Compatibility must state Node.js `>=22.0.0`, Better Auth `^1.6.9`, `flutterwave-node-v3` `1.4.x`, and the supported `better-auth-flutterwave` line `>=0.1.0 <1.0.0`.
- Do not instruct agents to import from `@better-auth/core/*` in runtime package code.
- Keep product and plan schema tables enabled by default.
- Prefer canonical client methods over deprecated `subscription.disable` and `subscription.enable` aliases.
- Do not expose admin renewal or catalog sync helpers to browser-triggered auth client actions.
- Organization billing defaults to owner/admin access unless explicitly overridden.
