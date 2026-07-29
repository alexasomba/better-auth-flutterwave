---
name: better-auth-flutterwave-setup
description: Set up @alexasomba/better-auth-flutterwave with Better Auth and Flutterwave v3.
metadata:
  library: "@alexasomba/better-auth-flutterwave"
  version: "0.1.0"
compatibility: "Node.js >=22; better-auth ^1.6; flutterwave-node-v3 1.4.x"
---

# Better Auth Flutterwave setup

Install `better-auth`, `@alexasomba/better-auth-flutterwave`, and `flutterwave-node-v3`.

Configure `publicKey`, `secretKey`, and the separately managed webhook `secretHash`. The optional
`flutterwaveClient` and `fetch` options support dependency injection. Register `flutterwaveClient`
from the package’s `/client` export in the browser.

Run `npx better-auth migrate` after enabling the plugin. Never add Flutterwave customer fields to a
user or organization: billing ownership is local and Flutterwave billing identity is an email.

The upstream SDK is untyped CommonJS, performs always-on telemetry, and may use an OS temporary
file. The plugin’s validated adapter uses Promise APIs only.
