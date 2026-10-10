import { describe, expect, it, vi } from "vite-plus/test";
import { createFlutterwaveV4Adapter } from "../src/flutterwave-v4.ts";

const tokenResponse = (accessToken: string, expiresIn = 600) =>
  Response.json({ access_token: accessToken, expires_in: expiresIn });

const resourceResponse = (id = "resource_123") =>
  Response.json({ status: "success", data: { id } }, { status: 201 });

function inputUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") throw new Error("Expected a serialized JSON request body");
  return JSON.parse(body) as unknown;
}

describe("Flutterwave v4 adapter", () => {
  it("uses OAuth, documented trace and idempotency headers, and v4 resources", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) =>
      Promise.resolve(
        inputUrl(input).includes("/token") ? tokenResponse("oauth-token") : resourceResponse(),
      ),
    );
    const adapter = createFlutterwaveV4Adapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      apiBaseUrl: "https://sandbox.example.test",
      identityUrl: "https://identity.example.test/token",
      fetch,
    });

    await adapter.createCustomer({
      email: "buyer@example.test",
      idempotencyKey: "req-customer-0001",
      traceId: "trace-customer-0001",
    });
    await adapter.createCardPaymentMethod({
      customerId: "cus_customer_1",
      encrypted_card_number: "enc-number",
      encrypted_expiry_month: "enc-month",
      encrypted_expiry_year: "enc-year",
      encrypted_cvv: "enc-cvv",
      nonce: "123456789012",
      idempotencyKey: "req-payment-method-1",
      traceId: "trace-payment-method-1",
    });
    await adapter.createCharge({
      amount: 25.5,
      currency: "NGN",
      reference: "invoice-20261010-1",
      customerId: "cus_customer_1",
      paymentMethodId: "pmd_payment_1",
      recurring: true,
      idempotencyKey: "req-charge-000001",
      traceId: "trace-charge-000001",
    });
    await adapter.updateChargeAuthorization({
      chargeId: "chg_charge_1",
      authorization: { type: "otp", otp: { code: "123456" } },
      idempotencyKey: "req-auth-000001",
      traceId: "trace-auth-000001",
    });
    await adapter.retrieveCharge("chg_charge_1");
    await adapter.createRefund({
      chargeId: "chg_charge_1",
      amount: 10,
      reason: "requested_by_customer",
      idempotencyKey: "req-refund-000001",
      traceId: "trace-refund-000001",
    });

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://identity.example.test/token",
      expect.objectContaining({ method: "POST" }),
    );
    const createCustomerRequest = fetch.mock.calls[1]?.[1];
    const customerHeaders = new Headers(createCustomerRequest?.headers);
    expect(customerHeaders.get("authorization")).toBe("Bearer oauth-token");
    expect(customerHeaders.get("x-idempotency-key")).toBe("req-customer-0001");
    expect(customerHeaders.get("x-trace-id")).toBe("trace-customer-0001");
    expect(parseJsonBody(createCustomerRequest?.body)).toMatchObject({
      email: "buyer@example.test",
    });
    const paymentMethodRequest = fetch.mock.calls[2]?.[1];
    expect(parseJsonBody(paymentMethodRequest?.body)).toMatchObject({
      type: "card",
      customer_id: "cus_customer_1",
      card: { encrypted_card_number: "enc-number", nonce: "123456789012" },
    });
    expect(fetch.mock.calls[4]?.[0]).toBe("https://sandbox.example.test/charges/chg_charge_1");
    expect(fetch.mock.calls[5]?.[0]).toBe("https://sandbox.example.test/charges/chg_charge_1");
    expect(parseJsonBody(fetch.mock.calls[6]?.[1]?.body)).toEqual({
      charge_id: "chg_charge_1",
      amount: 10,
      reason: "requested_by_customer",
    });
  });

  it("coalesces concurrent OAuth requests and refreshes before token expiry", async () => {
    let now = 0;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(tokenResponse("first-token", 120))
      .mockResolvedValueOnce(resourceResponse("customer_1"))
      .mockResolvedValueOnce(resourceResponse("customer_2"))
      .mockResolvedValueOnce(tokenResponse("second-token", 600))
      .mockResolvedValueOnce(resourceResponse("customer_3"));
    const adapter = createFlutterwaveV4Adapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch,
      now: () => now,
    });

    await Promise.all([
      adapter.createCustomer({ email: "one@example.test", idempotencyKey: "customer-key-0001" }),
      adapter.createCustomer({ email: "two@example.test", idempotencyKey: "customer-key-0002" }),
    ]);
    now = 61_000;
    await adapter.createCustomer({
      email: "three@example.test",
      idempotencyKey: "customer-key-0003",
    });

    expect(fetch.mock.calls.filter(([url]) => inputUrl(url).includes("/token"))).toHaveLength(2);
    expect(new Headers(fetch.mock.calls[4]?.[1]?.headers).get("authorization")).toBe(
      "Bearer second-token",
    );
  });

  it("refreshes once after an expired-token response and reuses the idempotency key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(tokenResponse("expired-token"))
      .mockResolvedValueOnce(Response.json({ message: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("fresh-token"))
      .mockResolvedValueOnce(resourceResponse("customer_1"));
    const adapter = createFlutterwaveV4Adapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch,
    });

    await adapter.createCustomer({
      email: "buyer@example.test",
      idempotencyKey: "customer-key-0001",
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    const expiredHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    const freshHeaders = new Headers(fetch.mock.calls[3]?.[1]?.headers);
    expect(expiredHeaders.get("authorization")).toBe("Bearer expired-token");
    expect(expiredHeaders.get("x-idempotency-key")).toBe("customer-key-0001");
    expect(freshHeaders.get("authorization")).toBe("Bearer fresh-token");
    expect(freshHeaders.get("x-idempotency-key")).toBe("customer-key-0001");
  });

  it("rejects malformed references, headers, encrypted card fields, and refund reasons", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createFlutterwaveV4Adapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch,
    });

    await expect(
      adapter.createCustomer({ email: "buyer@example.test", idempotencyKey: "short" }),
    ).rejects.toThrow("idempotency keys");
    await expect(
      adapter.createCustomer({
        email: "buyer@example.test",
        idempotencyKey: "customer-key-0001",
        traceId: "bad\ntrace-id-0001",
      }),
    ).rejects.toThrow("trace ids");
    await expect(
      adapter.createCharge({
        amount: 10,
        currency: "NGN",
        reference: "bad reference",
        customerId: "cus_1",
        paymentMethodId: "pmd_1",
        idempotencyKey: "charge-key-000001",
      }),
    ).rejects.toThrow("references");
    await expect(
      adapter.createCardPaymentMethod({
        encrypted_card_number: "",
        encrypted_expiry_month: "month",
        encrypted_expiry_year: "year",
        encrypted_cvv: "cvv",
        nonce: "123456789012",
        idempotencyKey: "payment-key-0001",
      }),
    ).rejects.toThrow("encrypted card fields");
    await expect(
      adapter.createRefund({
        chargeId: "chg_1",
        amount: 10,
        reason: "made-up" as never,
        idempotencyKey: "refund-key-000001",
      }),
    ).rejects.toThrow("refund chargeId and reason");
    expect(fetch).not.toHaveBeenCalled();
  });
});
