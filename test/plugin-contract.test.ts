/* oxlint-disable typescript/require-await */
import { describe, expect, it } from "vitest";
import { flutterwave } from "../src";
import { flutterwaveClient } from "../src/client";
import { decryptPaymentToken, encryptPaymentToken } from "../src/token-crypto";
import { flutterwavePluginSchema } from "../src/schema";
import { hmacSha256Base64, timingSafeEqualString } from "../src/route-modules/shared";
import type { FlutterwaveSdkClient } from "../src/flutterwave-sdk";

const mockClient: FlutterwaveSdkClient = {
  Transaction: {
    verify: async () => ({}),
    verify_by_tx: async () => ({}),
    refund: async () => ({}),
  },
  PaymentPlan: { get_all: async () => ({}) },
  Subscription: {
    fetch_all: async () => ({}),
    cancel: async () => ({}),
    activate: async () => ({}),
  },
  Tokenized: { charge: async () => ({}) },
};

describe("plugin contract", () => {
  it("uses isolated Flutterwave model and plugin names", () => {
    const plugin = flutterwave({
      publicKey: "FLWPUBK_TEST-value",
      secretKey: "FLWSECK_TEST-value",
      secretHash: "webhook-secret",
      flutterwaveClient: mockClient,
      subscription: { enabled: true, plans: [] },
    });

    expect(plugin.id).toBe("flutterwave");
    expect(flutterwaveClient().id).toBe("flutterwave-client");
    expect(Object.keys(plugin.schema)).toEqual(
      expect.arrayContaining([
        "flutterwaveTransaction",
        "flutterwaveSubscription",
        "flutterwaveProduct",
        "flutterwavePlan",
        "flutterwaveWebhookEvent",
        "flutterwaveRefund",
      ]),
    );
    expect(Object.keys(plugin.schema)).not.toContain("subscription");
  });

  it("does not extend user or organization with provider customer identifiers", () => {
    expect(flutterwavePluginSchema).not.toHaveProperty("user");
    expect(flutterwavePluginSchema).not.toHaveProperty("organization");
  });

  it("encrypts reusable payment tokens without retaining plaintext", async () => {
    const encrypted = await encryptPaymentToken("payment-token", "better-auth-secret");
    expect(encrypted).not.toContain("payment-token");
    await expect(decryptPaymentToken(encrypted, "better-auth-secret")).resolves.toBe(
      "payment-token",
    );
    await expect(decryptPaymentToken(encrypted, "different-secret")).rejects.toThrow();
  });

  it("verifies Flutterwave HMAC signatures in constant-time compatible form", async () => {
    const signature = await hmacSha256Base64("secret-hash", '{"event":"charge.completed"}');
    expect(timingSafeEqualString(signature, signature)).toBe(true);
    expect(timingSafeEqualString(signature, `${signature}x`)).toBe(false);
  });
});
