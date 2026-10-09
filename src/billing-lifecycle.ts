import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { createBillingStore } from "./billing-store.ts";
import type { FlutterwaveTransactionData } from "./flutterwave-contracts.ts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk.ts";
import { parseFlutterwaveMetadata } from "./metadata.ts";
import { encryptPaymentToken } from "./token-crypto.ts";
import type { AnyFlutterwaveOptions, FlutterwaveTransaction } from "./types.ts";
import { getNextPeriodEnd, normalizeSubscriptionGroup } from "./utils.ts";

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
    const updated = await store.updateCurrentSubscription(subscription, {
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
    });
    if (updated && identified) {
      await store.retireCompetingSubscriptions(subscription.referenceId, group, subscription.id);
    }
  }
}
