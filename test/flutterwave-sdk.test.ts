/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi } from "vitest";
import {
  createFlutterwaveAdapter,
  FlutterwaveAdapterError,
  type FlutterwaveSdkClient,
} from "../src/flutterwave-sdk";

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
