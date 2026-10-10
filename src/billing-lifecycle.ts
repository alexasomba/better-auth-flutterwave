/* oxlint-disable no-restricted-imports */
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import * as z from "zod";
import { createBillingStore } from "./billing-store.ts";
import type { FlutterwaveTransactionData } from "./flutterwave-contracts.ts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk.ts";
import { parseFlutterwaveMetadata } from "./metadata.ts";
import { acquireOperation, checkpointOperation, failOperation } from "./operation-ledger.ts";
import { encryptPaymentToken } from "./token-crypto.ts";
import type {
  AnyFlutterwaveOptions,
  FlutterwaveTransaction,
  FlutterwaveWebhookEvent,
} from "./types.ts";
import { getNextPeriodEnd, getPlans, normalizeSubscriptionGroup } from "./utils.ts";

const fulfillmentSchema = z.object({
  initialCompletion: z.boolean(),
  completed: z.array(z.enum(["complete", "created", "update"])),
});

export function paymentMatches(
  expected: FlutterwaveTransaction,
  verified: FlutterwaveTransactionData,
): boolean {
  return (
    verified.tx_ref === expected.txRef &&
    verified.amount === expected.amount &&
    verified.currency === expected.currency
  );
}

/** Shared fulfillment for browser verification, webhooks, and trusted reconciliation. */
export async function recordVerifiedPayment(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  expected: FlutterwaveTransaction,
  verified: FlutterwaveTransactionData,
  webhookEvent?: FlutterwaveWebhookEvent,
): Promise<void> {
  if (!paymentMatches(expected, verified)) {
    throw new APIError("BAD_REQUEST", {
      message: "Verified transaction does not match the expected payment",
    });
  }
  const store = createBillingStore(ctx);
  const now = new Date();
  // A late pending/failed notification must not undo an already verified payment.
  if (expected.status === "successful" && verified.status !== "successful") return;
  await store.updateTransactionByTxRef(expected.txRef, {
    transactionId: verified.id,
    flwRef: verified.flw_ref,
    chargedAmount: verified.charged_amount,
    paymentType: verified.payment_type,
    status: verified.status,
    verifiedAt: expected.verifiedAt ?? now,
    reconciledAt: now,
    updatedAt: now,
  });
  if (verified.status !== "successful" || options.subscription?.enabled !== true) return;

  for (const subscription of await store.findSubscriptionsByTxRef(expected.txRef)) {
    if (subscription.status === "canceled" || subscription.endedAt != null) continue;
    const group = normalizeSubscriptionGroup(subscription.groupId);
    const siblings = await store.findSubscriptionsByReference(subscription.referenceId);
    const superseded = siblings.some(
      (candidate) =>
        candidate.id !== subscription.id &&
        normalizeSubscriptionGroup(candidate.groupId) === group &&
        (candidate.status === "active" ||
          candidate.status === "trialing" ||
          (candidate.status === "canceled" && candidate.periodStart != null)) &&
        new Date(candidate.createdAt).getTime() > new Date(subscription.createdAt).getTime(),
    );
    if (superseded) {
      await store.updateSubscription(subscription.id, {
        status: "canceled",
        canceledAt: now,
        endedAt: now,
        updatedAt: now,
      });
      continue;
    }

    let subscriptionId = subscription.subscriptionId;
    if (
      subscription.paymentPlanId != null &&
      subscriptionId == null &&
      subscription.billingEmail != null &&
      subscription.billingEmail !== ""
    ) {
      const provider = createFlutterwaveAdapter(options);
      const remote = await provider.listSubscriptions({
        email: subscription.billingEmail,
        plan: subscription.paymentPlanId,
        transactionId: verified.id,
      });
      const candidates = remote.filter((candidate) => candidate.status !== "cancelled");
      subscriptionId = candidates.length === 1 ? candidates[0]?.id : undefined;
    }
    const identified = subscription.paymentPlanId == null || subscriptionId != null;
    const paidAt =
      verified.created_at != null && verified.created_at !== ""
        ? new Date(verified.created_at)
        : now;
    const paymentTime = Number.isFinite(paidAt.getTime()) ? paidAt : now;
    const renewal = parseFlutterwaveMetadata(expected.metadata).type === "renewal";
    const priorEnd = subscription.periodEnd ? new Date(subscription.periodEnd) : null;
    const periodStart =
      renewal && priorEnd !== null && priorEnd > paymentTime ? priorEnd : paymentTime;
    // Renewal operations set past_due before fulfillment. This survives a failure after
    // recording payment, while the conditional status update prevents concurrent retries
    // from advancing a period that another worker has already fulfilled.
    const advancePeriod =
      subscription.periodEnd == null ||
      (renewal ? subscription.status === "past_due" : expected.status !== "successful");
    const update = {
      subscriptionId,
      status: identified ? "active" : "incomplete",
      encryptedPaymentToken:
        verified.card?.token !== undefined
          ? await encryptPaymentToken(verified.card.token, ctx.context.secret)
          : subscription.encryptedPaymentToken,
      ...(advancePeriod
        ? {
            periodStart,
            periodEnd: getNextPeriodEnd(periodStart, subscription.billingInterval ?? "monthly"),
          }
        : {}),
      reconciledAt: now,
      updatedAt: now,
    };
    if (!identified) {
      await store.updateCurrentSubscription(subscription, update);
      continue;
    }
    let operation = await acquireOperation(store, {
      eventId: `internal:payment:${verified.id}:${subscription.id}`,
      eventType: "internal.payment.fulfillment",
      txRef: expected.txRef,
      payload: JSON.stringify({
        initialCompletion: subscription.status === "incomplete",
        completed: [],
      }),
    });
    if (operation.status === "processed") continue;
    try {
      const progress = fulfillmentSchema.parse(JSON.parse(operation.payload));
      // The ledger retains initial-completion intent even if a prior worker already activated the row.
      const updated = await store.updateCurrentSubscription(subscription, update);
      if (!updated) {
        operation = await checkpointOperation(store, operation, {
          status: "processed",
          processedAt: new Date(),
        });
        continue;
      }
      const plan = (await getPlans(options.subscription)).find(
        (candidate) => candidate.name.toLowerCase() === subscription.plan.toLowerCase(),
      );
      if (plan) {
        const callbackEvent: FlutterwaveWebhookEvent = webhookEvent ?? {
          event: "charge.completed",
          data: {
            id: verified.id,
            tx_ref: verified.tx_ref,
            ...(verified.flw_ref !== undefined &&
            verified.flw_ref !== null &&
            verified.flw_ref !== ""
              ? { flw_ref: verified.flw_ref }
              : {}),
            status: verified.status,
            amount: verified.amount,
            currency: verified.currency,
          },
        };
        const currentSubscription = { ...subscription, ...update };
        const callbackData = { event: callbackEvent, subscription: currentSubscription, plan };
        const callbacks = [
          {
            key: "complete" as const,
            callback: progress.initialCompletion
              ? options.subscription?.onSubscriptionComplete
              : undefined,
          },
          {
            key: "created" as const,
            callback: progress.initialCompletion
              ? options.subscription?.onSubscriptionCreated
              : undefined,
          },
          { key: "update" as const, callback: options.subscription?.onSubscriptionUpdate },
        ];
        for (const { key, callback } of callbacks) {
          if (progress.completed.includes(key)) continue;
          // Refresh the lease before external work; handlers must still tolerate at-least-once delivery.
          operation = await checkpointOperation(store, operation, {});
          await callback?.(callbackData, ctx);
          progress.completed.push(key);
          operation = await checkpointOperation(store, operation, {
            payload: JSON.stringify(progress),
          });
        }
      }
      await store.retireCompetingSubscriptions(subscription.referenceId, group, subscription.id);
      operation = await checkpointOperation(store, operation, {
        status: "processed",
        processedAt: new Date(),
      });
    } catch (error) {
      await failOperation(store, operation);
      throw error;
    }
  }
}
