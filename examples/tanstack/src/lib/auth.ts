/* eslint-disable no-console */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { anonymous, organization, admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import {
  flutterwave,
  type Subscription,
  type FlutterwavePlan,
  type FlutterwaveProduct,
  type FlutterwaveOptions,
} from "better-auth-flutterwave";

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

const memory = memoryAdapter(data);

const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.VITE_BETTER_AUTH_URL ?? "http://localhost:3000";

const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;

if (secretKey === undefined || secretKey === null || secretKey === "") {
  console.warn("Missing FLUTTERWAVE_SECRET_KEY in environment variables");
}

const isFlutterwaveConfigured =
  publicKey !== undefined &&
  publicKey !== "" &&
  secretKey !== undefined &&
  secretKey !== "" &&
  secretHash !== undefined &&
  secretHash !== "";

const subscriptionPlans: FlutterwavePlan[] = [
  {
    name: "starter",
    amount: 5000,
    currency: "NGN",
    interval: "monthly",
    paymentPlanId: 12_345,
    freeTrial: {
      days: 7,
      onTrialStart: async (subscription: Subscription) => {
        await Promise.resolve();
        console.log(`⏰ 7-day trial started for ${subscription.referenceId}`);
      },
    },
    description: "Perfect for testing the waters",
    features: ["Basic analytics", "Up to 5 projects", "Community support"],
  },
  {
    name: "pro",
    amount: 10000,
    currency: "NGN",
    interval: "monthly",
    paymentPlanId: 67_890,
    description: "For serious professionals. Supports scheduled changes.",
    features: ["Advanced analytics", "Unlimited projects", "Priority support", "Custom domain"],
  },
  {
    name: "team",
    amount: 25000,
    currency: "NGN",
    interval: "monthly",
    seatAmount: 5000,
    description: "Best for growing teams (Seat-based)",
    features: ["Everything in Pro", "Team collaboration", "Audit logs", "SSO"],
  },
  {
    name: "business",
    amount: 50000,
    currency: "NGN",
    interval: "monthly",
    seatAmount: 10000,
    freeTrial: {
      days: 7,
      onTrialStart: async (subscription: Subscription) => {
        await Promise.resolve();
        console.log(`⏰ 7-day trial started for ${subscription.referenceId}`);
      },
    },
    description: "Best for established businesses (Seat-based)",
    features: ["Everything in Pro", "Team collaboration", "Audit logs", "SSO"],
  },
  {
    name: "enterprise",
    amount: 100000,
    currency: "NGN",
    interval: "annually",
    description: "For large scale organizations",
    features: ["Everything in Team", "Dedicated account manager", "SLA", "On-premise deployment"],
  },
];

const productCatalog = [
  {
    name: "50 Credits Pack",
    price: 2500,
    currency: "NGN",
    metadata: JSON.stringify({ type: "credits", quantity: 50 }),
  },
  {
    name: "150 Credits Pack",
    price: 6000,
    currency: "NGN",
    metadata: JSON.stringify({ type: "credits", quantity: 150 }),
  },
];

export const flutterwaveOptions = isFlutterwaveConfigured
  ? ({
      publicKey: publicKey!,
      secretKey: secretKey!,
      secretHash: secretHash!,
      organization: {
        enabled: true,
      },
      subscription: {
        enabled: true,
        allowedPaymentChannels: ["card"],
        plans: subscriptionPlans,
      },
      products: { products: productCatalog as FlutterwaveProduct[] },
    } satisfies FlutterwaveOptions)
  : null;

export const auth = betterAuth({
  baseURL,
  database: memory,
  emailAndPassword: { enabled: true },
  plugins: [
    anonymous(),
    organization(),
    admin(),
    ...(flutterwaveOptions !== null
      ? [
          flutterwave({
            ...flutterwaveOptions,
            subscription: {
              enabled: true,
              allowedPaymentChannels: ["card"],

              // v0.3.0: Subscription lifecycle hooks
              onSubscriptionCreated: async ({ subscription, plan }) => {
                await Promise.resolve();
                console.log(
                  `🎉 Subscription created: ${plan.name} plan - Status: ${subscription.status}`,
                );
                if (subscription.trialStart !== undefined && subscription.trialStart !== null) {
                  console.log(
                    `   ⏰ Trial active until ${subscription.trialEnd instanceof Date ? subscription.trialEnd.toISOString() : String(subscription.trialEnd)}`,
                  );
                }
              },
              onSubscriptionCancel: async ({ subscription }) => {
                await Promise.resolve();
                console.log(`❌ Subscription cancelled: ${subscription.plan}`);
              },

              plans: subscriptionPlans,

              // Authorize referenceId for organization billing
              authorizeReference: async (
                { user, session: _session, referenceId, action: _action },
                ctx,
              ) => {
                // If no referenceId provided, allow (defaults to user.id)
                if (
                  referenceId === undefined ||
                  referenceId === null ||
                  referenceId === "" ||
                  referenceId === user.id
                ) {
                  return true;
                }

                // Check if referenceId is an organization the user belongs to
                try {
                  const members = await ctx.context.adapter.findMany({
                    model: "member",
                    where: [
                      { field: "userId", value: user.id },
                      { field: "organizationId", value: referenceId },
                    ],
                  });

                  // User is a member of this organization
                  if ((members as Record<string, unknown>[]).length > 0) {
                    const member = (members as Record<string, unknown>[])[0] as { role: string };
                    // Only owners and admins can manage billing
                    return member.role === "owner" || member.role === "admin";
                  }
                } catch (e) {
                  console.error("Error checking org membership:", e);
                }

                return false;
              },
            },
            products: {
              products: productCatalog as FlutterwaveProduct[],
            },
          }),
        ]
      : []),
    tanstackStartCookies(), // make sure this is the last plugin in the array
  ],
});
