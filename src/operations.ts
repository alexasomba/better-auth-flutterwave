/* oxlint-disable typescript/strict-boolean-expressions */
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { createBillingStore } from "./billing-store";
import { createFlutterwaveAdapter } from "./flutterwave-sdk";
import { createRenewalMetadata, stringifyFlutterwaveMetadata } from "./metadata";
import { decryptPaymentToken } from "./token-crypto";
import type {
  AnyFlutterwaveOptions,
  ChargeRecurringSubscriptionInput,
  ChargeRecurringSubscriptionResult,
  FlutterwaveSyncResult,
} from "./types";

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
  const plan =
    (await store.findPlanByName(subscription.plan)) ??
    (await (async () => {
      const configured = options.subscription?.plans;
      const plans = typeof configured === "function" ? await configured() : (configured ?? []);
      return plans.find((candidate) => candidate.name === subscription.plan) ?? null;
    })());
  const amount = input.amount ?? plan?.amount;
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
  await store.createTransaction({
    txRef,
    transactionId: verified.id,
    flwRef: verified.flw_ref,
    referenceId: subscription.referenceId,
    userId: subscription.userId,
    amount,
    chargedAmount: verified.charged_amount,
    currency: plan.currency,
    status: verified.status,
    plan: subscription.plan,
    paymentType: verified.payment_type,
    metadata,
    verifiedAt: now,
    reconciledAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await store.updateSubscription(subscription.id, {
    txRef,
    status: verified.status === "successful" ? "active" : "past_due",
    reconciledAt: now,
    updatedAt: now,
  });
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
