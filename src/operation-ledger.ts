import { APIError } from "better-auth/api";
import type { BillingStore } from "./billing-store.ts";
import type { FlutterwaveWebhookEventRecord } from "./types.ts";

const LEASE_MS = 5 * 60_000;

function busy(): APIError {
  return new APIError("SERVICE_UNAVAILABLE", {
    message: "Billing operation is in progress; retry later",
  });
}

/** Internal operations share the existing unique event ledger; no new database schema is needed. */
export async function acquireOperation(
  store: BillingStore,
  input: { eventId: string; eventType: string; txRef: string; payload: string },
): Promise<FlutterwaveWebhookEventRecord> {
  let existing = await store.findWebhookEvent(input.eventId);
  const now = new Date();
  if (existing === null) {
    try {
      return await store.createWebhookEvent({
        ...input,
        status: "processing",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      existing = await store.findWebhookEvent(input.eventId);
      if (existing === null) throw error;
    }
  }
  if (existing.status === "processed") return existing;
  if (
    existing.status === "processing" &&
    new Date(existing.updatedAt).getTime() + LEASE_MS > now.getTime()
  )
    throw busy();
  // Distinct lease timestamps also protect callers that race within the same millisecond.
  const claimedAt = new Date(Math.max(now.getTime(), new Date(existing.updatedAt).getTime() + 1));
  if (!(await store.claimWebhookEvent(existing, claimedAt))) throw busy();
  return { ...existing, status: "processing", updatedAt: claimedAt };
}

export async function checkpointOperation(
  store: BillingStore,
  operation: FlutterwaveWebhookEventRecord,
  update: Partial<FlutterwaveWebhookEventRecord>,
): Promise<FlutterwaveWebhookEventRecord> {
  const updatedAt = new Date(Math.max(Date.now(), new Date(operation.updatedAt).getTime() + 1));
  if (!(await store.updateOwnedWebhookEvent(operation, { ...update, updatedAt }))) throw busy();
  return { ...operation, ...update, updatedAt };
}

export async function failOperation(
  store: BillingStore,
  operation: FlutterwaveWebhookEventRecord,
): Promise<void> {
  // A stale owner must not overwrite a lease acquired by another worker.
  await store.updateOwnedWebhookEvent(operation, { status: "failed", updatedAt: new Date() });
}
