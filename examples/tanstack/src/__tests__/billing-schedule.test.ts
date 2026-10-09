// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createExampleAuth } from "../lib/auth-config";
import { runBillingSchedule } from "../lib/billing-schedule";

const databases: DatabaseSync[] = [];
const configuration = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "local-test-secret-not-for-production",
  FLUTTERWAVE_PUBLIC_KEY: "test-public",
  FLUTTERWAVE_SECRET_KEY: "test-secret",
  FLUTTERWAVE_SECRET_HASH: "test-hash",
};

function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(
    readFileSync(new URL("../../migrations/0001_billing.sql", import.meta.url), "utf8"),
  );
  return createExampleAuth(database, configuration);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("persistent scheduled billing", () => {
  it("ends due paid access using the migrated database and is idempotent", async () => {
    const instance = fixture();
    const { adapter } = await instance.auth.$context;
    const now = new Date("2026-10-09T12:00:00Z");
    for (const [id, cancelAt] of [
      ["due", now],
      ["future", new Date("2026-10-10T12:00:00Z")],
    ] as const) {
      await adapter.create({
        model: "flutterwaveSubscription",
        forceAllowId: true,
        data: {
          id,
          plan: "team",
          referenceId: "buyer",
          userId: "buyer",
          billingEmail: "buyer@example.test",
          status: "active",
          cancelAtPeriodEnd: true,
          cancelAt,
          periodEnd: cancelAt,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    await expect(runBillingSchedule(now.getTime(), instance, true)).resolves.toEqual({
      canceled: 1,
      failed: [],
      hasMore: false,
    });
    await expect(
      adapter.findOne({ model: "flutterwaveSubscription", where: [{ field: "id", value: "due" }] }),
    ).resolves.toMatchObject({ status: "canceled", cancelAtPeriodEnd: false, endedAt: now });
    await expect(
      adapter.findOne({
        model: "flutterwaveSubscription",
        where: [{ field: "id", value: "future" }],
      }),
    ).resolves.toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await expect(runBillingSchedule(now.getTime(), instance, true)).resolves.toMatchObject({
      canceled: 0,
    });
  });

  it("enforces webhook event uniqueness in the actual migration", async () => {
    const { auth } = fixture();
    const { adapter } = await auth.$context;
    const data = {
      eventId: "same-delivery",
      eventType: "charge.completed",
      payload: "{}",
      status: "processing",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await adapter.create({ model: "flutterwaveWebhookEvent", data });
    await expect(adapter.create({ model: "flutterwaveWebhookEvent", data })).rejects.toThrow();
  });

  it("refuses scheduled processing without persistence or provider configuration", async () => {
    const instance = fixture();
    await expect(runBillingSchedule(Date.now(), instance, false)).rejects.toThrow(
      "persistent BILLING_DB",
    );
    await expect(
      runBillingSchedule(Date.now(), { ...instance, flutterwaveOptions: null }, true),
    ).rejects.toThrow("not configured");
  });

  it("reports failed cancellations so the scheduled invocation fails and can retry", async () => {
    const instance = fixture();
    const { adapter } = await instance.auth.$context;
    const now = new Date();
    await adapter.create({
      model: "flutterwaveSubscription",
      data: {
        plan: "starter",
        referenceId: "buyer",
        userId: "buyer",
        billingEmail: "buyer@example.test",
        status: "active",
        paymentPlanId: 123,
        cancelAtPeriodEnd: true,
        cancelAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await expect(runBillingSchedule(now.getTime(), instance, true)).rejects.toThrow("failed for 1");
  });
});
