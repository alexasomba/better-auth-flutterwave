import { processScheduledFlutterwaveCancellations } from "better-auth-flutterwave";
import type { createExampleAuth } from "./auth-config";

type ExampleAuth = ReturnType<typeof createExampleAuth>;

/** Called only by the Worker scheduled event, never by a browser endpoint. */
export async function runBillingSchedule(
  scheduledTime: number,
  instance: ExampleAuth,
  persistent: boolean,
) {
  if (!persistent) throw new Error("Scheduled billing requires a persistent BILLING_DB binding");
  if (instance.flutterwaveOptions === null) throw new Error("Flutterwave is not configured");
  const context = await instance.auth.$context;
  const result = await processScheduledFlutterwaveCancellations(
    { context },
    instance.flutterwaveOptions,
    { now: new Date(scheduledTime), limit: 1000 },
  );
  if (result.failed.length > 0) {
    throw new Error(
      `Scheduled cancellation failed for ${result.failed.length} subscriptions; retry next run`,
    );
  }
  return result;
}
