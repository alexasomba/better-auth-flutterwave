/* oxlint-disable typescript/require-await, typescript/unbound-method */
import type { GenericEndpointContext } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cancelSubscription,
  flutterwaveWebhook,
  initializeTransaction,
  restoreSubscription,
  verifyTransaction,
} from "../src/routes.ts";
import { reconcileFlutterwaveTransaction } from "../src/reconciliation.ts";
import {
  chargeSubscriptionRenewal,
  processScheduledFlutterwaveCancellations,
} from "../src/operations.ts";
import { hmacSha256Base64 } from "../src/route-modules/shared.ts";
import { encryptPaymentToken } from "../src/token-crypto.ts";
import { getNextPeriodEnd } from "../src/utils.ts";
import type { AnyFlutterwaveOptions, FlutterwaveSubscription } from "../src/types.ts";

type Row = Record<string, any>;
interface Predicate {
  field: string;
  value: any;
  operator?: string;
}

function billingFixture() {
  const rows: Record<string, Row[]> = {
    flutterwaveTransaction: [],
    flutterwaveSubscription: [],
    flutterwaveWebhookEvent: [],
    flutterwavePlan: [],
  };
  function matches(row: Row, where: Predicate[] = []) {
    return where.every(({ field, value, operator }) => {
      if (operator === "lte") return row[field] <= value;
      if (operator === "in") return (value as unknown[]).includes(row[field]);
      if (row[field] instanceof Date && value instanceof Date) {
        return row[field].getTime() === value.getTime();
      }
      return row[field] === value;
    });
  }
  const adapter = {
    findOne: vi.fn(async ({ model, where }: any) => {
      const row = rows[model]?.find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ model, where, limit }: any) =>
      (rows[model] ?? [])
        .filter((candidate) => matches(candidate, where))
        .slice(0, limit)
        .map((row) => ({ ...row })),
    ),
    create: vi.fn(async ({ model, data }: any) => {
      if (
        model === "flutterwaveWebhookEvent" &&
        rows[model].some((row) => row.eventId === data.eventId)
      ) {
        throw new Error("duplicate eventId");
      }
      const row = { id: crypto.randomUUID(), ...data };
      rows[model] ??= [];
      rows[model].push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ model, where, update }: any) => {
      const row = rows[model]?.find((candidate) => matches(candidate, where));
      if (!row) return null;
      Object.assign(row, update);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ model, where, update }: any) => {
      const selected = (rows[model] ?? []).filter((row) => matches(row, where));
      for (const row of selected) Object.assign(row, update);
      return selected.length;
    }),
  };
  const verified: Row = {
    id: 42,
    tx_ref: "checkout-1",
    amount: 5000,
    currency: "NGN",
    status: "successful",
    created_at: "2026-01-31T12:00:00.000Z",
  };
  const sdk = {
    Transaction: {
      verify: vi.fn(async () => ({ status: "success", data: verified })),
      verify_by_tx: vi.fn(async () => ({ status: "success", data: verified })),
      refund: vi.fn(),
    },
    PaymentPlan: { get_all: vi.fn() },
    Subscription: {
      fetch_all: vi.fn(async () => ({ status: "success", data: [] })),
      cancel: vi.fn(async ({ id }: { id: number }) => ({
        status: "success",
        data: { id, amount: 5000, currency: "NGN", status: "cancelled" },
      })),
      activate: vi.fn(),
    },
    Tokenized: { charge: vi.fn(async () => ({ status: "success", data: verified })) },
  };
  const fetch = vi.fn(async () =>
    Response.json({ status: "success", data: { link: "https://checkout.example.test/pay" } }),
  );
  const options: AnyFlutterwaveOptions = {
    publicKey: "test-public",
    secretKey: "test-secret",
    secretHash: "test-hash",
    flutterwaveClient: sdk,
    fetch,
    subscription: {
      enabled: true,
      plans: [
        { name: "pro", amount: 5000, seatAmount: 1000, currency: "NGN", interval: "monthly" },
      ],
    },
    products: { products: [{ name: "book", price: 2000, currency: "NGN" }] },
  };
  const context = {
    adapter,
    session: {
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "buyer@example.test", name: "Buyer", emailVerified: true },
    },
    options: { baseURL: "http://localhost:3000", trustedOrigins: ["http://localhost:3000"] },
    trustedOrigins: ["http://localhost:3000"],
    secret: "auth-secret",
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  const ctx = { context } as unknown as GenericEndpointContext;
  function addPayment(data: Row = {}) {
    const transaction = {
      id: "transaction-1",
      txRef: "checkout-1",
      referenceId: "user-1",
      userId: "user-1",
      amount: 5000,
      currency: "NGN",
      status: "pending",
      createdAt: new Date("2026-01-31T12:00:00Z"),
      updatedAt: new Date("2026-01-31T12:00:00Z"),
      ...data,
    };
    rows.flutterwaveTransaction.push(transaction);
    return transaction;
  }
  function addSubscription(data: Partial<FlutterwaveSubscription> = {}) {
    const subscription = {
      id: "subscription-1",
      txRef: "checkout-1",
      referenceId: "user-1",
      userId: "user-1",
      billingEmail: "buyer@example.test",
      plan: "pro",
      status: "incomplete",
      seats: 1,
      groupId: "base",
      billingInterval: "monthly",
      cancelAtPeriodEnd: false,
      createdAt: new Date("2026-01-31T12:00:00Z"),
      updatedAt: new Date("2026-01-31T12:00:00Z"),
      ...data,
    };
    rows.flutterwaveSubscription.push(subscription);
    return subscription;
  }
  async function webhook(
    event = {
      event: "charge.completed",
      data: { id: 42, tx_ref: "checkout-1", status: "successful" },
    },
  ) {
    const raw = JSON.stringify(event);
    const signature = await hmacSha256Base64(options.secretHash, raw);
    return flutterwaveWebhook(
      options,
      "/webhook",
    )({
      context: context as any,
      request: new Request("http://localhost:3000/webhook", {
        method: "POST",
        body: raw,
        headers: { "flutterwave-signature": signature },
      }),
    });
  }
  return {
    rows,
    adapter,
    verified,
    sdk,
    fetch,
    options,
    context,
    ctx,
    addPayment,
    addSubscription,
    webhook,
  };
}

afterEach(() => vi.useRealTimers());

describe("billing lifecycle", () => {
  it("rejects cookie-authenticated verification from an untrusted origin before contacting Flutterwave", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    await expect(
      verifyTransaction(
        fixture.options,
        "/verify",
      )({
        context: fixture.context as any,
        body: { txRef: "checkout-1" },
        request: new Request("http://localhost:3000/verify", {
          method: "POST",
          headers: { cookie: "better-auth.session_token=test", origin: "https://untrusted.test" },
        }),
      }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect(fixture.sdk.Transaction.verify_by_tx).not.toHaveBeenCalled();
  });

  it("uses configured plan pricing and quantities despite browser overrides", async () => {
    const fixture = billingFixture();
    await initializeTransaction(
      fixture.options,
      "/initialize",
    )({
      context: fixture.context as any,
      body: {
        plan: "pro",
        amount: 1,
        currency: "USD",
        quantity: 3,
        redirectUrl: "http://localhost:3000/callback",
      },
    });
    const request = fixture.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toMatchObject({ amount: 7000, currency: "NGN" });
    expect(fixture.rows.flutterwaveSubscription[0].seats).toBe(3);
  });

  it("uses configured product pricing and supports one-time payments without subscriptions", async () => {
    const fixture = billingFixture();
    fixture.options.subscription = undefined;
    await initializeTransaction(
      fixture.options,
      "/initialize",
    )({
      context: fixture.context as any,
      body: {
        product: "book",
        amount: 1,
        currency: "USD",
        quantity: 2,
        redirectUrl: "http://localhost:3000/callback",
      },
    });
    expect(fixture.rows.flutterwaveTransaction[0]).toMatchObject({ amount: 4000, currency: "NGN" });
  });

  it("rejects mixed catalog items and additional seats without a local per-seat price", async () => {
    const fixture = billingFixture();
    const initialize = initializeTransaction(fixture.options, "/initialize");
    const body = { plan: "pro", quantity: 2, redirectUrl: "http://localhost:3000/callback" };
    await expect(
      initialize({ context: fixture.context as any, body: { ...body, product: "book" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    fixture.options.subscription!.plans = [{ name: "pro", amount: 5000, currency: "NGN" }];
    await expect(initialize({ context: fixture.context as any, body })).rejects.toMatchObject({
      status: "BAD_REQUEST",
    });
    fixture.options.subscription!.plans = [
      { name: "pro", amount: 5000, seatAmount: 1000, currency: "NGN", paymentPlanId: 9 },
    ];
    await expect(initialize({ context: fixture.context as any, body })).rejects.toMatchObject({
      status: "BAD_REQUEST",
    });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("verifies a first redirect by provider ID then resolves its authorized local reference", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    await expect(
      verifyTransaction(
        fixture.options,
        "/verify",
      )({ context: fixture.context as any, body: { transactionId: 42 } }),
    ).resolves.toMatchObject({ status: "successful" });
    expect(fixture.rows.flutterwaveTransaction[0].transactionId).toBe(42);
  });

  it("rejects provider-ID verification of another user's transaction", async () => {
    const fixture = billingFixture();
    fixture.addPayment({ referenceId: "other-user", userId: "other-user" });
    await expect(
      verifyTransaction(
        fixture.options,
        "/verify",
      )({ context: fixture.context as any, body: { transactionId: 42 } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect(fixture.rows.flutterwaveTransaction[0].status).toBe("pending");
  });

  it("does not reactivate an old canceled subscription when its payment is replayed", async () => {
    const fixture = billingFixture();
    fixture.addPayment({ status: "successful", transactionId: 42 });
    const old = fixture.addSubscription({ status: "canceled" });
    const current = fixture.addSubscription({
      id: "new-subscription",
      txRef: "checkout-2",
      status: "active",
      createdAt: new Date("2026-02-01T12:00:00Z"),
    });
    await verifyTransaction(
      fixture.options,
      "/verify",
    )({ context: fixture.context as any, body: { txRef: "checkout-1" } });
    expect(old.status).toBe("canceled");
    expect(current.status).toBe("active");
  });

  it("does not replace a newer paid subscription with a delayed older checkout", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    const old = fixture.addSubscription();
    const current = fixture.addSubscription({
      id: "new-subscription",
      txRef: "checkout-2",
      status: "active",
      createdAt: new Date("2026-02-01T12:00:00Z"),
    });
    await fixture.webhook();
    expect(old.status).not.toBe("active");
    expect(current.status).toBe("active");
  });

  it("retires an older incomplete checkout when the newer subscription is fulfilled", async () => {
    const fixture = billingFixture();
    const old = fixture.addSubscription({
      id: "old-subscription",
      txRef: "checkout-old",
      createdAt: new Date("2026-01-01T12:00:00Z"),
    });
    fixture.addPayment();
    const current = fixture.addSubscription();
    await verifyTransaction(
      fixture.options,
      "/verify",
    )({ context: fixture.context as any, body: { txRef: "checkout-1" } });
    expect(old.status).toBe("canceled");
    expect(current.status).toBe("active");
  });

  it("persists stable calendar periods across repeated verification", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    const subscription = fixture.addSubscription();
    await verifyTransaction(
      fixture.options,
      "/verify",
    )({ context: fixture.context as any, body: { txRef: "checkout-1" } });
    expect(subscription.periodEnd).toEqual(new Date("2026-02-28T12:00:00Z"));
    const start = subscription.periodStart;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));
    await verifyTransaction(
      fixture.options,
      "/verify",
    )({ context: fixture.context as any, body: { txRef: "checkout-1" } });
    expect(subscription.periodStart).toEqual(start);
    expect(subscription.periodEnd).toEqual(new Date("2026-02-28T12:00:00Z"));
  });

  it("retries a failed application webhook callback", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    fixture.options.onEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    await expect(fixture.webhook()).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    await expect(fixture.webhook()).resolves.toEqual({ received: true });
    expect(fixture.options.onEvent).toHaveBeenCalledTimes(2);
    expect(fixture.rows.flutterwaveWebhookEvent[0].status).toBe("processed");
  });

  it("rejects a tampered raw webhook body before accessing storage or the provider", async () => {
    const fixture = billingFixture();
    const raw = JSON.stringify({ event: "charge.completed", data: { id: 42 } });
    const signature = await hmacSha256Base64(fixture.options.secretHash, raw);
    await expect(
      flutterwaveWebhook(
        fixture.options,
        "/webhook",
      )({
        context: fixture.context as any,
        request: new Request("http://localhost:3000/webhook", {
          method: "POST",
          body: `${raw} `,
          headers: { "flutterwave-signature": signature },
        }),
      }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect(fixture.adapter.create).not.toHaveBeenCalled();
    expect(fixture.sdk.Transaction.verify).not.toHaveBeenCalled();
  });

  it("only runs one callback for concurrent deliveries, including retry of a failed event", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    fixture.options.onEvent = vi.fn().mockRejectedValueOnce(new Error("temporary failure"));
    await fixture.webhook().catch(() => undefined);
    let finish!: () => void;
    vi.mocked(fixture.options.onEvent).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = fixture.webhook();
    await vi.waitFor(() => expect(fixture.options.onEvent).toHaveBeenCalledTimes(2));
    const duplicate = await fixture.webhook().catch((error: unknown) => error);
    expect(duplicate).toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(fixture.options.onEvent).toHaveBeenCalledTimes(2);
    finish();
    await first;
  });

  it("does not fulfill a mismatched signed payment event", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    fixture.verified.amount = 1;
    fixture.options.onEvent = vi.fn();
    await expect(fixture.webhook()).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(fixture.options.onEvent).not.toHaveBeenCalled();
  });

  it("waits for provider success before delivering a successful event to application fulfillment", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    fixture.verified.status = "pending";
    fixture.options.onEvent = vi.fn();
    await expect(fixture.webhook()).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(fixture.options.onEvent).not.toHaveBeenCalled();
    fixture.verified.status = "successful";
    await fixture.webhook();
    expect(fixture.options.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "successful", amount: 5000, currency: "NGN" }),
      }),
    );
  });

  it("keeps a native subscription incomplete during reconciliation until it is identified", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    const subscription = fixture.addSubscription({ paymentPlanId: 9 });
    await reconcileFlutterwaveTransaction(fixture.ctx, fixture.options, { txRef: "checkout-1" });
    expect(subscription.status).toBe("incomplete");
  });

  it("allows local subscription cancellation by local ID", async () => {
    const fixture = billingFixture();
    const subscription = fixture.addSubscription({ status: "active" });
    await cancelSubscription(
      fixture.options,
      "/cancel",
    )({ context: fixture.context as any, body: { subscriptionId: subscription.id } });
    expect(subscription.status).toBe("canceled");
    expect(fixture.sdk.Subscription.cancel).not.toHaveBeenCalled();
  });

  it("renews the same seat price used by checkout", async () => {
    const fixture = billingFixture();
    const encryptedPaymentToken = await encryptPaymentToken("token", fixture.context.secret);
    fixture.addSubscription({ status: "active", seats: 3, encryptedPaymentToken });
    fixture.sdk.Tokenized.charge.mockImplementation(async () => {
      const charge = fixture.sdk.Tokenized.charge.mock.calls[0] as unknown as [Row];
      Object.assign(fixture.verified, { tx_ref: charge[0].tx_ref, amount: charge[0].amount });
      return { status: "success", data: fixture.verified };
    });
    await chargeSubscriptionRenewal(fixture.ctx, fixture.options, {
      subscriptionId: "subscription-1",
    });
    expect(fixture.sdk.Tokenized.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 7000 }),
    );
  });

  it("recovers a recorded renewal before fulfillment without advancing its period twice", async () => {
    const fixture = billingFixture();
    fixture.addPayment({
      status: "successful",
      metadata: JSON.stringify({ type: "renewal", subscriptionId: "subscription-1" }),
    });
    const subscription = fixture.addSubscription({
      status: "past_due",
      periodStart: new Date("2026-01-01T12:00:00Z"),
      periodEnd: new Date("2026-02-01T12:00:00Z"),
    });

    await reconcileFlutterwaveTransaction(fixture.ctx, fixture.options, { txRef: "checkout-1" });
    expect(subscription.status).toBe("active");
    expect(subscription.periodStart).toEqual(new Date("2026-02-01T12:00:00Z"));
    expect(subscription.periodEnd).toEqual(new Date("2026-03-01T12:00:00Z"));
    await reconcileFlutterwaveTransaction(fixture.ctx, fixture.options, { txRef: "checkout-1" });
    expect(subscription.periodEnd).toEqual(new Date("2026-03-01T12:00:00Z"));
  });

  it("executes due native and local cancellations while retaining future schedules", async () => {
    const fixture = billingFixture();
    const now = new Date("2026-03-01T12:00:00Z");
    const native = fixture.addSubscription({
      id: "native",
      status: "active",
      subscriptionId: 9,
      paymentPlanId: 2,
      cancelAtPeriodEnd: true,
      cancelAt: new Date("2026-02-28T12:00:00Z"),
    });
    const local = fixture.addSubscription({
      id: "local",
      status: "active",
      cancelAtPeriodEnd: true,
      cancelAt: now,
    });
    const future = fixture.addSubscription({
      id: "future",
      status: "active",
      cancelAtPeriodEnd: true,
      cancelAt: new Date("2026-03-31T12:00:00Z"),
    });
    await expect(
      processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now }),
    ).resolves.toEqual({ canceled: 2, failed: [], hasMore: false });
    expect(native.status).toBe("canceled");
    expect(local.status).toBe("canceled");
    expect(future.status).toBe("active");
    expect(fixture.sdk.Subscription.cancel).toHaveBeenCalledExactlyOnceWith({ id: 9 });
    await expect(
      processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now }),
    ).resolves.toMatchObject({ canceled: 0 });
  });

  it("retains failed provider cancellations for a later scheduled retry", async () => {
    const fixture = billingFixture();
    const now = new Date("2026-03-01T12:00:00Z");
    const subscription = fixture.addSubscription({
      status: "active",
      subscriptionId: 9,
      paymentPlanId: 2,
      cancelAtPeriodEnd: true,
      cancelAt: now,
    });
    fixture.sdk.Subscription.cancel.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now }),
    ).resolves.toMatchObject({ canceled: 0, failed: [subscription.id] });
    expect(subscription.status).toBe("active");
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    await expect(
      processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now }),
    ).resolves.toMatchObject({ canceled: 1, failed: [] });
  });

  it("schedules local cancellation at its paid period and restores it before cancellation", async () => {
    const fixture = billingFixture();
    const end = new Date("2026-11-01T12:00:00Z");
    const subscription = fixture.addSubscription({ status: "active", periodEnd: end });
    await cancelSubscription(
      fixture.options,
      "/cancel",
    )({
      context: fixture.context as any,
      body: { subscriptionId: subscription.id, atPeriodEnd: true },
    });
    expect(subscription.cancelAt).toEqual(end);
    expect(subscription.status).toBe("active");
    await restoreSubscription(
      fixture.options,
      "/restore",
    )({ context: fixture.context as any, body: { subscriptionId: subscription.id } });
    expect(subscription.cancelAtPeriodEnd).toBe(false);
    await expect(
      restoreSubscription(
        fixture.options,
        "/restore",
      )({ context: fixture.context as any, body: { subscriptionId: subscription.id } }),
    ).resolves.toEqual({ status: "active" });
    expect(fixture.sdk.Subscription.activate).not.toHaveBeenCalled();
  });

  it("rejects scheduled cancellation when the paid period is unknown", async () => {
    const fixture = billingFixture();
    const subscription = fixture.addSubscription({ status: "active" });
    await expect(
      cancelSubscription(
        fixture.options,
        "/cancel",
      )({
        context: fixture.context as any,
        body: { subscriptionId: subscription.id, atPeriodEnd: true },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(subscription.cancelAtPeriodEnd).toBe(false);
  });

  it("does not cancel a schedule withdrawn after the due batch was read", async () => {
    const fixture = billingFixture();
    const now = new Date("2026-03-01T12:00:00Z");
    const subscription = fixture.addSubscription({
      status: "active",
      cancelAtPeriodEnd: true,
      cancelAt: now,
    });
    fixture.adapter.findMany.mockImplementationOnce(async () => {
      const snapshot = { ...subscription };
      subscription.cancelAtPeriodEnd = false;
      subscription.cancelAt = null;
      return [snapshot];
    });
    await expect(
      processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now }),
    ).resolves.toMatchObject({ canceled: 0 });
    expect(subscription.status).toBe("active");
  });

  it("does not restore an expired local subscription without another paid checkout", async () => {
    const fixture = billingFixture();
    const subscription = fixture.addSubscription({
      status: "active",
      cancelAtPeriodEnd: true,
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    await expect(
      restoreSubscription(
        fixture.options,
        "/restore",
      )({ context: fixture.context as any, body: { subscriptionId: subscription.id } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(subscription.cancelAtPeriodEnd).toBe(true);
  });

  it("does not manually charge canceled or provider-managed subscriptions", async () => {
    const fixture = billingFixture();
    fixture.addSubscription({ status: "canceled" });
    fixture.addSubscription({
      id: "native",
      status: "active",
      paymentPlanId: 9,
      subscriptionId: 3,
    });
    for (const subscriptionId of ["subscription-1", "native"]) {
      await expect(
        chargeSubscriptionRenewal(fixture.ctx, fixture.options, { subscriptionId }),
      ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    }
    expect(fixture.sdk.Tokenized.charge).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("stops native billing when cancellation is scheduled and preserves access until period end", async () => {
    const fixture = billingFixture();
    const now = new Date("2026-03-01T12:00:00Z");
    const subscription = fixture.addSubscription({
      status: "active",
      subscriptionId: 9,
      paymentPlanId: 2,
      periodEnd: now,
    });
    await cancelSubscription(
      fixture.options,
      "/cancel",
    )({ context: fixture.context as any, body: { subscriptionId: 9, atPeriodEnd: true } });
    expect(subscription.status).toBe("active");
    expect(fixture.sdk.Subscription.cancel).toHaveBeenCalledTimes(1);
    await processScheduledFlutterwaveCancellations(fixture.ctx, fixture.options, { now });
    expect(subscription.status).toBe("canceled");
    expect(fixture.sdk.Subscription.cancel).toHaveBeenCalledTimes(1);
  });

  it("calculates supported provider periods without guessing an unknown interval", () => {
    const start = new Date("2024-02-29T12:00:00Z");
    expect(getNextPeriodEnd(start, "yearly")).toEqual(new Date("2025-02-28T12:00:00Z"));
    expect(getNextPeriodEnd(start, "hourly")).toEqual(new Date("2024-02-29T13:00:00Z"));
    expect(getNextPeriodEnd(start, "bi-annually")).toEqual(new Date("2024-08-29T12:00:00Z"));
    expect(getNextPeriodEnd(start, "every 90 days")).toEqual(new Date("2024-05-29T12:00:00Z"));
    expect(getNextPeriodEnd(start, "invalid")).toBeNull();
  });

  it("does not treat a busy event as processed and reclaims an abandoned lease", async () => {
    const fixture = billingFixture();
    fixture.addPayment();
    fixture.options.onEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    await fixture.webhook().catch(() => undefined);
    const event = fixture.rows.flutterwaveWebhookEvent[0];
    event.status = "processing";
    event.updatedAt = new Date();
    await expect(fixture.webhook()).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    event.updatedAt = new Date(Date.now() - 10 * 60_000);
    await expect(fixture.webhook()).resolves.toEqual({ received: true });
    expect(fixture.options.onEvent).toHaveBeenCalledTimes(2);
  });
});
