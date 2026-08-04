---
name: flutterwave-organization-billing
description: Configure local organization ownership and marketplace splits for Flutterwave billing.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.9" # x-release-please-version
compatibility: "Node.js >=22; better-auth ^1.6"
---

# Flutterwave organization billing

Enable `organization.enabled` and use billing roles or `authorizeReference` to authorize members.
The organization ID is the local billing owner; it is not a Flutterwave customer or subaccount.
Store the immutable billing email on the native subscription.

Configure marketplace splits separately with `marketplace.allowedSubaccountIds` and optional
`defaultSplit`. Only existing KYC-approved IDs may be used. Per-checkout overrides must be
authorized and allowlisted. The plugin does not provision subaccounts.
