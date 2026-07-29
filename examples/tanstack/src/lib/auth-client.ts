import { createAuthClient } from "better-auth/react";
import { anonymousClient, organizationClient, adminClient } from "better-auth/client/plugins";
import { flutterwaveClient } from "@alexasomba/better-auth-flutterwave/client";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.VITE_BETTER_AUTH_URL ?? "http://localhost:8787"),
  plugins: [
    anonymousClient(),
    organizationClient(),
    adminClient(),
    flutterwaveClient({ subscription: true }),
  ],
});
