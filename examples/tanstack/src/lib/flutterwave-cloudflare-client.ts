import type { FlutterwaveSdkClient, FlutterwaveTokenChargeInput } from "better-auth-flutterwave";

type FetchLike = typeof globalThis.fetch;

export function createCloudflareFlutterwaveClient(
  secretKey: string,
  fetchImpl: FetchLike = globalThis.fetch,
  apiBaseUrl = "https://api.flutterwave.com/v3",
): FlutterwaveSdkClient {
  const request = async (
    path: string,
    init?: RequestInit,
    query?: Record<string, unknown>,
  ): Promise<unknown> => {
    const url = new URL(`${apiBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        typeof Reflect.get(body, "message") === "string"
          ? String(Reflect.get(body, "message"))
          : `Flutterwave request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  };

  return {
    Transaction: {
      verify: ({ id }) => request(`transactions/${id}/verify`),
      verify_by_tx: ({ tx_ref }) =>
        request("transactions/verify_by_reference", undefined, { tx_ref }),
      refund: ({ id, amount }) =>
        request(`transactions/${id}/refund`, {
          method: "POST",
          body: JSON.stringify(amount === undefined ? {} : { amount }),
        }),
    },
    PaymentPlan: {
      get_all: (query) => request("payment-plans", undefined, query),
    },
    Subscription: {
      fetch_all: (query) => request("subscriptions", undefined, query),
      cancel: ({ id }) => request(`subscriptions/${id}/cancel`, { method: "PUT" }),
      activate: ({ id }) => request(`subscriptions/${id}/activate`, { method: "PUT" }),
    },
    Tokenized: {
      charge: (input: FlutterwaveTokenChargeInput) =>
        request("tokenized-charges", {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
  };
}
