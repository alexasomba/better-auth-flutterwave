/* oxlint-disable typescript/strict-boolean-expressions, no-restricted-imports */
import { createHash } from "node:crypto";
import type { GenericEndpointContext } from "better-auth";
import * as z from "zod";
import { APIError } from "better-auth/api";
import { createBillingStore, type BillingStoreAdapter } from "./billing-store.ts";
import { recordVerifiedPayment } from "./billing-lifecycle.ts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk.ts";
import type { FlutterwaveTransactionData } from "./flutterwave-contracts.ts";
import {
  createRenewalMetadata,
  parseFlutterwaveMetadata,
  stringifyFlutterwaveMetadata,
} from "./metadata.ts";
import { acquireOperation, checkpointOperation, failOperation } from "./operation-ledger.ts";
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
  if (
    amount === undefined ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !plan?.currency ||
    !subscription.billingEmail
  ) {
    throw new APIError("BAD_REQUEST", { message: "Subscription billing details are incomplete" });
  }
  if (
    input.renewalId !== undefined &&
    (input.renewalId.length === 0 || input.renewalId.length > 255)
  ) {
    throw new APIError("BAD_REQUEST", { message: "renewalId must contain 1-255 characters" });
  }
  const priorTransaction = subscription.txRef
    ? await store.findTransactionByTxRef(subscription.txRef)
    : null;
  const priorMetadata = parseFlutterwaveMetadata(priorTransaction?.metadata);
  const priorOperationId =
    typeof priorMetadata.renewalOperationId === "string"
      ? priorMetadata.renewalOperationId
      : undefined;
  const priorOperation = priorOperationId ? await store.findWebhookEvent(priorOperationId) : null;
  const unfinishedPrior = priorOperation !== null && priorOperation.status !== "processed";
  const period =
    subscription.periodEnd == null ? "initial" : new Date(subscription.periodEnd).toISOString();
  const intent = input.renewalId ?? period;
  const digest = createHash("sha256")
    .update(JSON.stringify([subscription.id, intent]))
    .digest("hex");
  const operationId =
    input.renewalId === undefined && unfinishedPrior
      ? priorOperationId!
      : `internal:renewal:${digest}`;
  const txRef =
    input.renewalId === undefined && unfinishedPrior && priorTransaction
      ? priorTransaction.txRef
      : `flw_renewal_${digest.slice(0, 40)}`;
  if (unfinishedPrior && operationId !== priorOperationId) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "A previous renewal requires reconciliation before starting another intent",
    });
  }
  const requestedOperation = await store.findWebhookEvent(operationId);
  // A completed period must not be charged again by an early scheduler invocation.
  if (
    !unfinishedPrior &&
    requestedOperation === null &&
    subscription.periodEnd != null &&
    new Date(subscription.periodEnd) > new Date()
  ) {
    throw new APIError("BAD_REQUEST", { message: "The subscription is not due for renewal" });
  }
  let operation = await acquireOperation(store, {
    eventId: operationId,
    eventType: "internal.subscription.renewal",
    txRef,
    payload: JSON.stringify({ phase: "reserved", txRef, amount, currency: plan.currency, period }),
  });
  const progress = renewalIntentSchema.parse(JSON.parse(operation.payload));
  if (progress.amount !== amount || progress.currency !== plan.currency) {
    if (operation.status !== "processed") await failOperation(store, operation);
    throw new APIError("BAD_REQUEST", {
      message: "The renewal intent amount or currency has changed",
    });
  }
  const provider = adapter(options);
  try {
    let transaction = await store.findTransactionByTxRef(progress.txRef);
    transaction ??= await store.createTransaction({
      txRef: progress.txRef,
      referenceId: subscription.referenceId,
      userId: subscription.userId,
      amount,
      currency: plan.currency,
      status: "pending",
      plan: subscription.plan,
      metadata: stringifyFlutterwaveMetadata({
        ...createRenewalMetadata({
          subscriptionId: subscription.id,
          referenceId: subscription.referenceId,
        }),
        renewalOperationId: operationId,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (operation.status === "processed") {
      // Stable renewalId retries return the same verified payment instead of creating a new charge.
      const verified = await provider.verifyTransaction({ txRef: progress.txRef });
      await recordVerifiedPayment(ctx, options, transaction, verified);
      return renewalResult(verified);
    }
    if (progress.phase === "reserved") {
      if (progress.period !== period)
        throw new APIError("BAD_REQUEST", {
          message: "The reserved renewal period has already changed",
        });
      if (!subscription.encryptedPaymentToken && !input.redirectUrl) {
        throw new APIError("BAD_REQUEST", {
          message: "redirectUrl is required when the subscription has no reusable payment token",
        });
      }
      // Persist ownership and dispatch intent before the provider call. An ambiguous outcome is never recharged.
      if (
        !(await store.updateCurrentSubscription(subscription, {
          txRef: progress.txRef,
          status: "past_due",
          updatedAt: new Date(),
        }))
      )
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "Subscription changed while reserving renewal; retry later",
        });
      const token = subscription.encryptedPaymentToken
        ? await decryptPaymentToken(subscription.encryptedPaymentToken, ctx.context.secret)
        : null;
      progress.phase = "submitted";
      operation = await checkpointOperation(store, operation, {
        payload: JSON.stringify(progress),
      });
      if (token === null) {
        const checkout = await provider.initializePayment({
          tx_ref: progress.txRef,
          amount,
          currency: plan.currency,
          redirect_url: input.redirectUrl!,
          customer: { email: subscription.billingEmail },
          meta: parseFlutterwaveMetadata(transaction.metadata),
        });
        progress.checkoutUrl = checkout.link;
        progress.phase = "checkout";
        operation = await checkpointOperation(store, operation, {
          payload: JSON.stringify(progress),
          status: "failed",
        });
        return {
          status: "pending",
          data: { kind: "checkout", url: checkout.link, txRef: progress.txRef, redirect: true },
        };
      }
      const charged = await provider.chargeToken({
        token,
        amount,
        currency: plan.currency,
        email: subscription.billingEmail,
        tx_ref: progress.txRef,
      });
      // Persist a provider identifier before verification whenever the provider has returned one.
      transaction =
        (await store.updateTransactionByTxRef(progress.txRef, {
          transactionId: charged.id,
          updatedAt: new Date(),
        })) ?? transaction;
      const verified = await provider.verifyTransaction({ transactionId: charged.id });
      await recordVerifiedPayment(ctx, options, transaction, verified);
      operation = await checkpointOperation(store, operation, {
        status: verified.status === "pending" ? "failed" : "processed",
        processedAt: verified.status === "pending" ? undefined : new Date(),
      });
      return renewalResult(verified);
    }
    // A previous dispatch may have succeeded even if its response was lost. Query the same reference only.
    if (progress.checkoutUrl !== undefined && transaction.status === "pending") {
      operation = await checkpointOperation(store, operation, { status: "failed" });
      return {
        status: "pending",
        data: {
          kind: "checkout",
          url: progress.checkoutUrl,
          txRef: progress.txRef,
          redirect: true,
        },
      };
    }
    const verified = await provider.verifyTransaction({ txRef: progress.txRef });
    await recordVerifiedPayment(ctx, options, transaction, verified);
    operation = await checkpointOperation(store, operation, {
      status: verified.status === "pending" ? "failed" : "processed",
      processedAt: verified.status === "pending" ? undefined : new Date(),
    });
    if (verified.status === "pending" && progress.checkoutUrl !== undefined) {
      return {
        status: "pending",
        data: {
          kind: "checkout",
          url: progress.checkoutUrl,
          txRef: progress.txRef,
          redirect: true,
        },
      };
    }
    return renewalResult(verified);
  } catch (error) {
    if (operation.status !== "processed") await failOperation(store, operation);
    throw error;
  }
}

const renewalIntentSchema = z.object({
  phase: z.enum(["reserved", "submitted", "checkout"]),
  txRef: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  period: z.string().min(1),
  checkoutUrl: z.string().optional(),
});

function renewalResult(verified: FlutterwaveTransactionData): ChargeRecurringSubscriptionResult {
  return {
    status:
      verified.status === "successful"
        ? "success"
        : verified.status === "pending"
          ? "pending"
          : "failed",
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
  ctx: { context: { adapter: BillingStoreAdapter } },
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

export async function refundFlutterwaveTransaction(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  input: { transactionId: number; amount?: number; reason?: string },
) {
  const store = createBillingStore(ctx);
  const transaction = await store.findTransactionById(input.transactionId);
  if (!transaction) throw new APIError("NOT_FOUND", { message: "Transaction not found" });
  const result = await adapter(options).refundTransaction(
    input.transactionId,
    input.amount,
    input.reason,
  );
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
