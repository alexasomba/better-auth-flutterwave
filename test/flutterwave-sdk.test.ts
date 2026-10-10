/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createFlutterwaveAdapter,
  FlutterwaveAdapterError,
  type FlutterwaveSdkClient,
} from "../src/flutterwave-sdk.ts";

const transaction = {
  id: 42,
  tx_ref: "better-auth_123",
  flw_ref: "FLW-MOCK-123",
  amount: 2500,
  charged_amount: 2500,
  currency: "NGN",
  status: "successful",
  customer: { email: "customer@example.com" },
};

function mockClient(): FlutterwaveSdkClient {
  return {
    Transaction: {
      verify: vi.fn().mockResolvedValue({ status: "success", data: transaction }),
      verify_by_tx: vi.fn().mockResolvedValue({ status: "success", data: transaction }),
      refund: vi.fn().mockResolvedValue({
        status: "success",
        data: { id: 7, transaction_id: 42, status: "pending", amount_refunded: 500 },
      }),
    },
    PaymentPlan: {
      get_all: vi.fn().mockResolvedValue({
        status: "success",
        data: [
          {
            id: 9,
            name: "Monthly",
            amount: 2500,
            interval: "monthly",
            currency: "NGN",
          },
        ],
      }),
    },
    Subscription: {
      fetch_all: vi.fn().mockResolvedValue({
        status: "success",
        data: [{ id: 3, amount: 2500, plan: 9, status: "active", currency: "NGN" }],
      }),
      cancel: vi.fn().mockResolvedValue({
        status: "success",
        data: { id: 3, amount: 2500, plan: 9, status: "cancelled", currency: "NGN" },
      }),
      activate: vi.fn().mockResolvedValue({
        status: "success",
        data: { id: 3, amount: 2500, plan: 9, status: "active", currency: "NGN" },
      }),
    },
    Tokenized: {
      charge: vi.fn().mockResolvedValue({ status: "success", data: transaction }),
    },
  };
}

function adapter(client = mockClient(), fetch = vi.fn()) {
  return {
    client,
    fetch,
    adapter: createFlutterwaveAdapter({
      publicKey: "FLWPUBK_TEST",
      secretKey: "FLWSECK_TEST",
      flutterwaveClient: client,
      fetch,
    }),
  };
}

describe("Flutterwave provider adapter", () => {
  it("uses authenticated v3 HTTP endpoints without a provider SDK dependency", async () => {
    const plan = {
      id: 9,
      name: "Monthly",
      amount: 2500,
      interval: "monthly",
      currency: "NGN",
    };
    const subscription = {
      id: 3,
      amount: 2500,
      plan: 9,
      status: "active",
      currency: "NGN",
    };
    const refund = { id: 7, transaction_id: 42, status: "pending", amount_refunded: 500 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "success", data: transaction }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: transaction }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: [plan] }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: [subscription] }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: subscription }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: subscription }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: transaction }))
      .mockResolvedValueOnce(Response.json({ status: "success", data: refund }));
    const flutterwave = createFlutterwaveAdapter({
      publicKey: "FLWPUBK_TEST",
      secretKey: "FLWSECK_TEST",
      fetch,
      apiBaseUrl: "https://api.example.test",
    });

    await flutterwave.verifyTransaction({ transactionId: 42 });
    await flutterwave.verifyTransaction({ txRef: "better-auth_123" });
    await flutterwave.listPaymentPlans();
    await flutterwave.listSubscriptions({ email: "customer@example.com", plan: 9 });
    await flutterwave.cancelSubscription(3);
    await flutterwave.activateSubscription(3);
    await flutterwave.chargeToken({
      token: "flw-t1nf-123",
      currency: "NGN",
      amount: 2500,
      email: "customer@example.com",
      tx_ref: "renewal_123",
    });
    await flutterwave.refundTransaction(42, 500, "Customer requested a refund");

    expect(fetch).toHaveBeenCalledTimes(8);
    const authenticated = {
      accept: "application/json",
      authorization: "Bearer FLWSECK_TEST",
      "content-type": "application/json",
    };
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/v3/transactions/42/verify",
      expect.objectContaining({ method: "GET", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/v3/transactions/verify_by_reference?tx_ref=better-auth_123",
      expect.objectContaining({ method: "GET", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://api.example.test/v3/payment-plans",
      expect.objectContaining({ method: "GET", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "https://api.example.test/v3/subscriptions?email=customer%40example.com&plan=9",
      expect.objectContaining({ method: "GET", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "https://api.example.test/v3/subscriptions/3/cancel",
      expect.objectContaining({ method: "PUT", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      "https://api.example.test/v3/subscriptions/3/activate",
      expect.objectContaining({ method: "PUT", headers: authenticated }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      7,
      "https://api.example.test/v3/tokenized-charges",
      expect.objectContaining({
        method: "POST",
        headers: authenticated,
        body: expect.stringContaining('"tx_ref":"renewal_123"'),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      8,
      "https://api.example.test/v3/transactions/42/refund",
      expect.objectContaining({
        method: "POST",
        headers: authenticated,
        body: JSON.stringify({ amount: 500, comments: "Customer requested a refund" }),
      }),
    );
  });

  it("maps provider HTTP failures to operation-specific errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { status: "error", message: "Invalid secret key", data: null },
          { status: 401 },
        ),
      );
    const flutterwave = createFlutterwaveAdapter({
      publicKey: "FLWPUBK_TEST",
      secretKey: "FLWSECK_TEST",
      fetch,
    });

    await expect(flutterwave.verifyTransaction({ transactionId: 42 })).rejects.toMatchObject({
      name: "FlutterwaveAdapterError",
      operation: "verify transaction",
      message: "Invalid secret key",
    });
  });

  it.each([
    ["https://api.example.test", "https://api.example.test/v3/payments"],
    ["https://api.example.test/", "https://api.example.test/v3/payments"],
    ["https://api.example.test////", "https://api.example.test/v3/payments"],
    ["https://api.example.test//gateway///", "https://api.example.test//gateway/v3/payments"],
  ])("normalizes only trailing slashes in %s", async (apiBaseUrl, expectedUrl) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "success", data: { link: "https://checkout.example.test/pay" } }),
      );
    const flutterwave = createFlutterwaveAdapter({
      publicKey: "FLWPUBK_TEST",
      secretKey: "FLWSECK_TEST",
      flutterwaveClient: mockClient(),
      fetch,
      apiBaseUrl,
    });
    await flutterwave.initializePayment({
      tx_ref: "better-auth_123",
      amount: 2500,
      currency: "NGN",
      redirect_url: "https://example.com/billing/callback",
      customer: { email: "customer@example.com" },
    });
    expect(fetch).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
  });

  it("handles long interior and trailing slash runs without blocking", async () => {
    const interior = `https://api.example.test/${"/".repeat(100_000)}gateway`;
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "success", data: { link: "https://checkout.example.test/pay" } }),
      );
    const startedAt = performance.now();
    const flutterwave = createFlutterwaveAdapter({
      publicKey: "FLWPUBK_TEST",
      secretKey: "FLWSECK_TEST",
      flutterwaveClient: mockClient(),
      fetch,
      apiBaseUrl: `${interior}${"/".repeat(100_000)}`,
    });
    expect(performance.now() - startedAt).toBeLessThan(1500);
    await flutterwave.initializePayment({
      tx_ref: "better-auth_123",
      amount: 2500,
      currency: "NGN",
      redirect_url: "https://example.com/billing/callback",
      customer: { email: "customer@example.com" },
    });
    expect(fetch).toHaveBeenCalledWith(`${interior}/v3/payments`, expect.any(Object));
  });

  it("initializes Standard checkout with bearer authentication", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          message: "Hosted Link",
          data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/example" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { adapter: flutterwave } = adapter(mockClient(), fetch);

    await expect(
      flutterwave.initializePayment({
        tx_ref: "better-auth_123",
        amount: 2500,
        currency: "NGN",
        redirect_url: "https://example.com/billing/callback",
        customer: { email: "customer@example.com" },
      }),
    ).resolves.toEqual({
      link: "https://checkout.flutterwave.com/v3/hosted/pay/example",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/payments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer FLWSECK_TEST" }),
      }),
    );
  });

  it("uses the correct Promise SDK methods for transaction verification", async () => {
    const { adapter: flutterwave, client } = adapter();

    await flutterwave.verifyTransaction({ transactionId: 42 });
    await flutterwave.verifyTransaction({ txRef: "better-auth_123" });

    expect(client.Transaction.verify).toHaveBeenCalledWith({ id: 42 });
    expect(client.Transaction.verify_by_tx).toHaveBeenCalledWith({
      tx_ref: "better-auth_123",
    });
  });

  it("requires exactly one transaction locator", async () => {
    const { adapter: flutterwave } = adapter();

    await expect(flutterwave.verifyTransaction({})).rejects.toBeInstanceOf(FlutterwaveAdapterError);
    await expect(
      flutterwave.verifyTransaction({ transactionId: 42, txRef: "duplicate" }),
    ).rejects.toThrow("exactly one");
  });

  it("validates SDK responses before returning them", async () => {
    const client = mockClient();
    vi.mocked(client.Transaction.verify).mockResolvedValue({
      status: "success",
      data: { id: 42, status: "successful" },
    });
    const { adapter: flutterwave } = adapter(client);

    await expect(flutterwave.verifyTransaction({ transactionId: 42 })).rejects.toThrow(
      "invalid response",
    );
  });

  it("normalizes unsuccessful SDK envelopes", async () => {
    const client = mockClient();
    vi.mocked(client.PaymentPlan.get_all).mockResolvedValue({
      status: "error",
      message: "Invalid secret key",
      data: [],
    });
    const { adapter: flutterwave } = adapter(client);

    await expect(flutterwave.listPaymentPlans()).rejects.toMatchObject({
      name: "FlutterwaveAdapterError",
      operation: "list payment plans",
      message: "Invalid secret key",
    });
  });

  it("supports plans, subscriptions, token charges, and partial refunds", async () => {
    const { adapter: flutterwave, client } = adapter();

    await expect(flutterwave.listPaymentPlans()).resolves.toHaveLength(1);
    await expect(
      flutterwave.listSubscriptions({ email: "customer@example.com", plan: 9 }),
    ).resolves.toHaveLength(1);
    await expect(flutterwave.cancelSubscription(3)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(flutterwave.activateSubscription(3)).resolves.toMatchObject({
      status: "active",
    });
    await expect(
      flutterwave.chargeToken({
        token: "flw-t1nf-123",
        currency: "NGN",
        amount: 2500,
        email: "customer@example.com",
        tx_ref: "renewal_123",
      }),
    ).resolves.toMatchObject({ id: 42, status: "successful" });
    await expect(flutterwave.refundTransaction(42, 500)).resolves.toMatchObject({
      status: "pending",
      amount_refunded: 500,
    });

    expect(client.Subscription.fetch_all).toHaveBeenCalledWith({
      email: "customer@example.com",
      plan: "9",
    });
    expect(client.Tokenized.charge).toHaveBeenCalledWith(
      expect.objectContaining({ token: "flw-t1nf-123", tx_ref: "renewal_123" }),
    );
    expect(client.Transaction.refund).toHaveBeenCalledWith({ id: 42, amount: 500 });
  });
});
