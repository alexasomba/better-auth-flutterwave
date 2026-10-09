import { env } from "cloudflare:workers";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createExampleAuth } from "./auth-config";

export const data: Record<string, unknown[]> = {
  user: [],
  session: [],
  verification: [],
  account: [],
  flutterwaveSubscription: [],
  flutterwaveTransaction: [],
  flutterwaveProduct: [],
  organization: [],
  member: [],
  invitation: [],
  flutterwavePlan: [],
  flutterwaveWebhookEvent: [],
  flutterwaveRefund: [],
};

export const usesPersistentDatabase = env.BILLING_DB !== undefined;
export const { auth, flutterwaveOptions } = createExampleAuth(
  env.BILLING_DB ?? memoryAdapter(data),
  {
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL,
    VITE_BETTER_AUTH_URL: env.VITE_BETTER_AUTH_URL ?? process.env.VITE_BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
    FLUTTERWAVE_PUBLIC_KEY: env.FLUTTERWAVE_PUBLIC_KEY ?? process.env.FLUTTERWAVE_PUBLIC_KEY,
    FLUTTERWAVE_SECRET_KEY: env.FLUTTERWAVE_SECRET_KEY ?? process.env.FLUTTERWAVE_SECRET_KEY,
    FLUTTERWAVE_SECRET_HASH: env.FLUTTERWAVE_SECRET_HASH ?? process.env.FLUTTERWAVE_SECRET_HASH,
  },
);
