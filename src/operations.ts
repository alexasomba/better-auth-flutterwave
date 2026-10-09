/* oxlint-disable typescript/strict-boolean-expressions */
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { createBillingStore } from "./billing-store.ts";
import { recordVerifiedPayment } from "./billing-lifecycle.ts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk.ts";
import { createRenewalMetadata, stringifyFlutterwaveMetadata } from "./metadata.ts";
import { decryptPaymentToken } from "./token-crypto.ts";
import type {
  AnyFlutterwaveOptions,
  ChargeRecurringSubscriptionInput,
  ChargeRecurringSubscriptionResult,
  FlutterwaveSyncResult,
} from "./types.ts";
import { calculatePlanAmount } from "./utils.ts";

function adapter(options: AnyFlutterwaveOptions) {
  return createFlutterwaveAdapter({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    flutterwaveClient: options.flutterwaveClient,
    fetch: options.fetch,
    apiBaseUrl: options.apiBaseUrl,
  });
}

export async function syncFlutterwavePlans(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
): Promise<FlutterwaveSyncResult> {
  const remote = await adapter(options).listPaymentPlans();
  const store = createBillingStore(ctx);
  const now = new Date();
  for (const plan of remote) {
    await store.upsertPlanByPaymentPlanId(plan.id, {
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval,
      paymentPlanId: plan.id,
      reconciledAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { status: "success", count: remote.length };
}

export async function chargeSubscriptionRenewal(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  input: ChargeRecurringSubscriptionInput,
): Promise<ChargeRecurringSubscriptionResult> {
  const store = createBillingStore(ctx);
  const subscription = await store.findSubscriptionById(input.subscriptionId);
  if (!subscription) throw new APIError("NOT_FOUND", { message: "Subscription not found" });
  if (
    subscription.status === "canceled" ||
    subscription.endedAt != null ||
    (subscription.cancelAtPeriodEnd &&
      subscription.cancelAt &&
      new Date(subscription.cancelAt) <= new Date())
  ) {
    throw new APIError("BAD_REQUEST", { message: "Canceled subscriptions cannot be renewed" });
  }
  if (subscription.paymentPlanId != null || subscription.subscriptionId != null) {
    throw new APIError("BAD_REQUEST", {
      message: "Native subscription renewals are managed by Flutterwave",
    });
  }
  const plan =
    (await store.findPlanByName(subscription.plan)) ??
    (await (async () => {
      const configured = options.subscription?.plans;
      const plans = typeof configured === "function" ? await configured() : (configured ?? []);
      return plans.find((candidate) => candidate.name === subscription.plan) ?? null;
    })());
  const amount = input.amount ?? (plan ? calculatePlanAmount(plan, subscription.seats) : undefined);
  if (!amount || !plan?.currency || !subscription.billingEmail) {
    throw new APIError("BAD_REQUEST", { message: "Subscription billing details are incomplete" });
  }
  const txRef = `flw_renewal_${crypto.randomUUID()}`;
  const metadata = stringifyFlutterwaveMetadata(
    createRenewalMetadata({
      subscriptionId: subscription.id,
      referenceId: subscription.referenceId,
    }),
  );

  if (!subscription.encryptedPaymentToken) {
    if (!input.redirectUrl) {
      throw new APIError("BAD_REQUEST", {
        message: "redirectUrl is required when the subscription has no reusable payment token",
      });
    }
    const checkout = await adapter(options).initializePayment({
      tx_ref: txRef,
      amount,
      currency: plan.currency,
      redirect_url: input.redirectUrl,
      customer: { email: subscription.billingEmail },
      meta: parseMetadata(metadata),
    });
    const now = new Date();
    await store.createTransaction({
      txRef,
      referenceId: subscription.referenceId,
      userId: subscription.userId,
      amount,
      currency: plan.currency,
      status: "pending",
      plan: subscription.plan,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
    await store.updateSubscription(subscription.id, { txRef, status: "past_due", updatedAt: now });
    return {
      status: "pending",
      data: { kind: "checkout", url: checkout.link, txRef, redirect: true },
    };
  }

  const token = await decryptPaymentToken(subscription.encryptedPaymentToken, ctx.context.secret);
  const charged = await adapter(options).chargeToken({
    token,
    amount,
    currency: plan.currency,
    email: subscription.billingEmail,
    tx_ref: txRef,
  });
  const verified = await adapter(options).verifyTransaction({ transactionId: charged.id });
  if (
    verified.tx_ref !== txRef ||
    verified.amount !== amount ||
    verified.currency !== plan.currency
  ) {
    throw new APIError("BAD_REQUEST", {
      message: "Tokenized renewal did not match the expected payment",
    });
  }
  const now = new Date();
  const transaction = await store.createTransaction({
    txRef,
    transactionId: verified.id,
    flwRef: verified.flw_ref,
    referenceId: subscription.referenceId,
    userId: subscription.userId,
    amount,
    chargedAmount: verified.charged_amount,
    currency: plan.currency,
    status: "pending",
    plan: subscription.plan,
    paymentType: verified.payment_type,
    metadata,
    createdAt: now,
    updatedAt: now,
  });
  await store.updateSubscription(subscription.id, {
    txRef,
    status: "past_due",
    reconciledAt: now,
    updatedAt: now,
  });
  await recordVerifiedPayment(ctx, options, transaction, verified);
  return {
    status: verified.status === "successful" ? "success" : "failed",
    data: {
      id: verified.id,
      txRef: verified.tx_ref,
      flwRef: verified.flw_ref ?? undefined,
      amount: verified.amount,
      chargedAmount: verified.charged_amount,
      currency: verified.currency,
      status: verified.status,
      paymentType: verified.payment_type ?? undefined,
    },
  };
}

/** Call from an independently authorized scheduled job; no browser endpoint is exposed. */
export async function processScheduledFlutterwaveCancellations(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 100;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new APIError("BAD_REQUEST", {
      message: "A valid time and limit from 1 to 1000 are required",
    });
  }
  const store = createBillingStore(ctx);
  const due = await store.listDueCancellations(now, limit);
  const failed: string[] = [];
  let canceled = 0;
  for (const subscription of due) {
    try {
      if (subscription.paymentPlanId != null && subscription.subscriptionId == null) {
        throw new Error("Native subscription has not been identified");
      }
      if (
        subscription.subscriptionId != null &&
        subscription.status !== "canceled" &&
        subscription.canceledAt == null
      ) {
        await adapter(options).cancelSubscription(subscription.subscriptionId);
      }
      if (await store.completeScheduledCancellation(subscription, now)) canceled++;
    } catch {
      // Retain the schedule so the next invocation can retry without losing the cancellation.
      failed.push(subscription.id);
    }
  }
  return { canceled, failed, hasMore: due.length === limit };
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

export async function refundFlutterwaveTransaction(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  input: { transactionId: number; amount?: number; reason?: string },
) {
  const store = createBillingStore(ctx);
  const transaction = await store.findTransactionById(input.transactionId);
  if (!transaction) throw new APIError("NOT_FOUND", { message: "Transaction not found" });
  const result = await adapter(options).refundTransaction(input.transactionId, input.amount);
  const now = new Date();
  return store.createRefund({
    refundId: result.id,
    transactionId: input.transactionId,
    txRef: transaction.txRef,
    referenceId: transaction.referenceId,
    amount: result.amount_refunded ?? result.amount ?? input.amount ?? transaction.amount,
    currency: transaction.currency,
    status: result.status,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  });
}
