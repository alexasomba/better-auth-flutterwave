import { authClient } from "@/lib/auth-client";
import type { FlutterwaveClientActions } from "@alexasomba/better-auth-flutterwave/client";

interface BetterAuthFlutterwaveClient {
  flutterwave: FlutterwaveClientActions;
  subscription: FlutterwaveClientActions["subscription"];
}

const billingAuthClient = authClient as typeof authClient & BetterAuthFlutterwaveClient;

export const flutterwaveActions = billingAuthClient.flutterwave;
export const subscriptionActions = billingAuthClient.subscription;
