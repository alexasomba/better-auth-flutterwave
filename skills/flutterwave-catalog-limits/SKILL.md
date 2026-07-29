---
name: flutterwave-catalog-limits
description: Configure Flutterwave payment plans and local products, limits, seats, and inventory.
metadata:
  library: "better-auth-flutterwave"
  version: "0.1.0"
compatibility: "Node.js >=22; better-auth ^1.6; flutterwave-node-v3 1.4.x"
---

# Flutterwave catalog and limits

Use numeric `paymentPlanId` for Flutterwave-native recurring plans. Omit it for locally renewed
plans using local products, seats, groups, and limits.

Products and inventory are local records because Flutterwave does not provide the remote product
catalog assumed by the Paystack implementation. Only Flutterwave payment plans and subscriptions
may be synchronized. Catalog sync and renewal operations remain trusted-server APIs.
