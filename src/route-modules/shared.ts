import { defineErrorCodes } from "better-auth";
import type { RawError } from "better-auth";
import { timingSafeEqual } from "node:crypto";
import { Buffer as NodeBuffer } from "node:buffer";

import type { AnyFlutterwaveOptions, FlutterwaveCheckoutChannel } from "../types";

export const FLUTTERWAVE_ERROR_CODES: {
  SUBSCRIPTION_NOT_FOUND: RawError<"SUBSCRIPTION_NOT_FOUND">;
  SUBSCRIPTION_PLAN_NOT_FOUND: RawError<"SUBSCRIPTION_PLAN_NOT_FOUND">;
  FAILED_TO_INITIALIZE_TRANSACTION: RawError<"FAILED_TO_INITIALIZE_TRANSACTION">;
  FAILED_TO_VERIFY_TRANSACTION: RawError<"FAILED_TO_VERIFY_TRANSACTION">;
  FAILED_TO_DISABLE_SUBSCRIPTION: RawError<"FAILED_TO_DISABLE_SUBSCRIPTION">;
  FAILED_TO_ENABLE_SUBSCRIPTION: RawError<"FAILED_TO_ENABLE_SUBSCRIPTION">;
  EMAIL_VERIFICATION_REQUIRED: RawError<"EMAIL_VERIFICATION_REQUIRED">;
  SUBSCRIPTION_PAYMENT_CHANNEL_NOT_ALLOWED: RawError<"SUBSCRIPTION_PAYMENT_CHANNEL_NOT_ALLOWED">;
} = defineErrorCodes({
  SUBSCRIPTION_NOT_FOUND: "Subscription not found",
  SUBSCRIPTION_PLAN_NOT_FOUND: "Subscription plan not found",
  FAILED_TO_INITIALIZE_TRANSACTION: "Failed to initialize transaction",
  FAILED_TO_VERIFY_TRANSACTION: "Failed to verify transaction",
  FAILED_TO_DISABLE_SUBSCRIPTION: "Failed to disable subscription",
  FAILED_TO_ENABLE_SUBSCRIPTION: "Failed to enable subscription",
  EMAIL_VERIFICATION_REQUIRED: "Email verification is required before you can subscribe to a plan",
  SUBSCRIPTION_PAYMENT_CHANNEL_NOT_ALLOWED:
    "This subscription only supports specific payment channels",
});

export function getAllowedSubscriptionChannels(
  options: AnyFlutterwaveOptions,
): FlutterwaveCheckoutChannel[] | undefined {
  const channels = options.subscription?.allowedPaymentChannels;
  return Array.isArray(channels) && channels.length > 0 ? channels : undefined;
}

export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const crypto = globalThis.crypto;
  if (crypto !== undefined && crypto !== null && "subtle" in crypto) {
    const subtle = crypto.subtle;
    const key = await subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const signature = await subtle.sign("HMAC", key, msgData);
    return NodeBuffer.from(signature).toString("base64");
  }

  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(message).digest("base64");
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBytes = NodeBuffer.from(left);
  const rightBytes = NodeBuffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
