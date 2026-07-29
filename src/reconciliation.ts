/* oxlint-disable no-restricted-imports, typescript/strict-boolean-expressions */
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import * as z from "zod";
import { createBillingStore } from "./billing-store";
import { createFlutterwaveAdapter } from "./flutterwave-sdk";
import type { AnyFlutterwaveOptions, FlutterwaveTransactionResponse } from "./types";

export type FlutterwaveReconciliationSource = "webhook" | "queue" | "admin" | "server" | "browser";

export interface ReconcileFlutterwaveTransactionInput {
  txRef?: string;
  transactionId?: number;
  source?: FlutterwaveReconciliationSource;
  throwOnError?: boolean;
}

export async function reconcileFlutterwaveTransaction(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  input: ReconcileFlutterwaveTransactionInput,
) {
  const store = createBillingStore(ctx);
  const local = input.txRef
    ? await store.findTransactionByTxRef(input.txRef)
    : input.transactionId
      ? await store.findTransactionById(input.transactionId)
      : null;
  if (!local) throw new APIError("NOT_FOUND", { message: "Transaction not found" });
  const provider = createFlutterwaveAdapter({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    flutterwaveClient: options.flutterwaveClient,
    fetch: options.fetch,
    apiBaseUrl: options.apiBaseUrl,
  });
  const verified = await provider.verifyTransaction({
    txRef: input.txRef,
    transactionId: input.transactionId,
  });
  const matches =
    verified.tx_ref === local.txRef &&
    verified.amount === local.amount &&
    verified.currency === local.currency;
  if (!matches) {
    if (input.throwOnError === false) {
      return {
        ok: false as const,
        source: input.source ?? "server",
        txRef: local.txRef,
        error: { code: "TRANSACTION_MISMATCH", message: "Transaction details do not match" },
      };
    }
    throw new APIError("BAD_REQUEST", { message: "Transaction details do not match" });
  }
  const now = new Date();
  await store.updateTransactionByTxRef(local.txRef, {
    transactionId: verified.id,
    flwRef: verified.flw_ref,
    chargedAmount: verified.charged_amount,
    paymentType: verified.payment_type,
    status: verified.status,
    verifiedAt: now,
    reconciledAt: now,
    updatedAt: now,
  });
  for (const subscription of await store.findSubscriptionsByTxRef(local.txRef)) {
    await store.updateSubscription(subscription.id, {
      status: verified.status === "successful" ? "active" : subscription.status,
      reconciledAt: now,
      updatedAt: now,
    });
  }
  const data: FlutterwaveTransactionResponse = {
    id: verified.id,
    txRef: verified.tx_ref,
    flwRef: verified.flw_ref ?? undefined,
    amount: verified.amount,
    chargedAmount: verified.charged_amount,
    currency: verified.currency,
    status: verified.status,
    paymentType: verified.payment_type ?? undefined,
  };
  return {
    ok: true as const,
    source: input.source ?? "server",
    txRef: local.txRef,
    status: verified.status,
    data,
  };
}

const refundEnvelopeSchema = z.object({
  status: z.string(),
  data: z.object({
    id: z.coerce.number().optional(),
    status: z.string(),
    amount_refunded: z.coerce.number().optional(),
  }),
});

export async function reconcileFlutterwaveRefunds(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
) {
  const store = createBillingStore(ctx);
  const pending = await store.listPendingRefunds();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.apiBaseUrl ?? "https://api.flutterwave.com").replace(/\/+$/, "");
  let updated = 0;
  for (const refund of pending) {
    if (!refund.refundId) continue;
    const response = await fetchImpl(`${baseUrl}/v3/refunds/${refund.refundId}`, {
      headers: { authorization: `Bearer ${options.secretKey}` },
    });
    if (!response.ok) continue;
    const parsed = refundEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) continue;
    await store.updateRefund(refund.id, {
      status: parsed.data.data.status,
      amount: parsed.data.data.amount_refunded ?? refund.amount,
      reconciledAt: new Date(),
      updatedAt: new Date(),
    });
    updated++;
  }
  return { status: "success" as const, count: updated };
}
