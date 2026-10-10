/* oxlint-disable no-restricted-imports */
import * as z from "zod";
import {
  checkoutDataSchema,
  flutterwaveEnvelopeSchema,
  paymentPlanSchema,
  refundSchema,
  standardCheckoutInputSchema,
  subscriptionSchema,
  tokenChargeInputSchema,
  transactionSchema,
  type FlutterwaveCheckoutData,
  type FlutterwavePaymentPlanData,
  type FlutterwaveRefundData,
  type FlutterwaveSubscriptionData,
  type FlutterwaveTokenChargeInput,
  type FlutterwaveTransactionData,
  type StandardCheckoutInput,
} from "./flutterwave-contracts.ts";

type SdkResult = Promise<unknown>;

/** The deliberately small provider boundary used by this package. */
export interface FlutterwaveClient {
  Transaction: {
    verify(input: { id: number }): SdkResult;
    verify_by_tx(input: { tx_ref: string }): SdkResult;
    refund(input: { id: number; amount?: number; comments?: string }): SdkResult;
  };
  PaymentPlan: {
    get_all(input: Record<string, unknown>): SdkResult;
  };
  Subscription: {
    fetch_all(input: Record<string, unknown>): SdkResult;
    cancel(input: { id: number }): SdkResult;
    activate(input: { id: number }): SdkResult;
  };
  Tokenized: {
    charge(input: FlutterwaveTokenChargeInput): SdkResult;
  };
}

/** @deprecated Use FlutterwaveClient. */
export type FlutterwaveSdkClient = FlutterwaveClient;

export interface FlutterwaveAdapterOptions {
  publicKey: string;
  secretKey: string;
  flutterwaveClient?: FlutterwaveClient;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
}

export interface VerifyTransactionInput {
  transactionId?: number;
  txRef?: string;
}

export interface ListSubscriptionsInput {
  email?: string;
  transactionId?: number;
  plan?: number;
  status?: string;
  page?: number;
}

export interface FlutterwaveAdapter {
  initializePayment(input: StandardCheckoutInput): Promise<FlutterwaveCheckoutData>;
  verifyTransaction(input: VerifyTransactionInput): Promise<FlutterwaveTransactionData>;
  listPaymentPlans(): Promise<FlutterwavePaymentPlanData[]>;
  listSubscriptions(input?: ListSubscriptionsInput): Promise<FlutterwaveSubscriptionData[]>;
  cancelSubscription(subscriptionId: number): Promise<FlutterwaveSubscriptionData>;
  activateSubscription(subscriptionId: number): Promise<FlutterwaveSubscriptionData>;
  chargeToken(input: FlutterwaveTokenChargeInput): Promise<FlutterwaveTransactionData>;
  refundTransaction(
    transactionId: number,
    amount?: number,
    reason?: string,
  ): Promise<FlutterwaveRefundData>;
}

export class FlutterwaveAdapterError extends Error {
  readonly operation: string;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(operation: string, message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "FlutterwaveAdapterError";
    this.operation = operation;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

function queryString(input: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

function createHttpClient(
  fetchImpl: typeof globalThis.fetch,
  apiBaseUrl: string,
  secretKey: string,
): FlutterwaveClient {
  const request = async (
    path: string,
    method: "GET" | "POST" | "PUT" = "GET",
    body?: unknown,
  ): Promise<unknown> => {
    if (typeof fetchImpl !== "function") throw new Error("Fetch is not available");

    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error(`Flutterwave returned a non-JSON response (HTTP ${response.status})`);
    }

    if (!response.ok) {
      throw new Error(
        messageFromUnknown(raw) ?? `Flutterwave request failed with HTTP ${response.status}`,
      );
    }
    return raw;
  };

  const post = (path: string, body: unknown) => request(path, "POST", body);

  return {
    Transaction: {
      verify: ({ id }) => request(`/v3/transactions/${id}/verify`),
      verify_by_tx: ({ tx_ref }) =>
        request(`/v3/transactions/verify_by_reference${queryString({ tx_ref })}`),
      refund: ({ id, amount, comments }) =>
        post(`/v3/transactions/${id}/refund`, {
          ...(amount === undefined ? {} : { amount }),
          ...(comments === undefined ? {} : { comments }),
        }),
    },
    PaymentPlan: {
      get_all: (query) => request(`/v3/payment-plans${queryString(query)}`),
    },
    Subscription: {
      fetch_all: (query) => request(`/v3/subscriptions${queryString(query)}`),
      cancel: ({ id }) => request(`/v3/subscriptions/${id}/cancel`, "PUT"),
      activate: ({ id }) => request(`/v3/subscriptions/${id}/activate`, "PUT"),
    },
    Tokenized: {
      charge: (input) => post("/v3/tokenized-charges", input),
    },
  };
}

function messageFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;
  const message = Reflect.get(value, "message");
  return typeof message === "string" ? message : undefined;
}

function parseEnvelope<T>(operation: string, raw: unknown, dataSchema: z.ZodType<T>): T {
  const envelope = flutterwaveEnvelopeSchema(dataSchema).safeParse(raw);
  if (!envelope.success) {
    throw new FlutterwaveAdapterError(operation, "Flutterwave returned an invalid response", {
      cause: envelope.error,
    });
  }
  if (envelope.data.status.toLowerCase() !== "success") {
    throw new FlutterwaveAdapterError(
      operation,
      envelope.data.message ?? "Flutterwave rejected the request",
    );
  }
  return envelope.data.data;
}

async function sdkCall<T>(
  operation: string,
  action: () => Promise<unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return parseEnvelope(operation, await action(), schema);
  } catch (error) {
    if (error instanceof FlutterwaveAdapterError) throw error;
    throw new FlutterwaveAdapterError(
      operation,
      messageFromUnknown(error) ?? `Flutterwave ${operation} failed`,
      { cause: error },
    );
  }
}

const positiveIdSchema = z.number().int().positive();
const optionalPositiveAmountSchema = z.number().positive().optional();

/**
 * Creates the provider boundary used by the plugin.
 *
 * Uses Flutterwave's v3 HTTP API directly so applications do not need a separate
 * SDK dependency. Inject `flutterwaveClient` for a custom provider boundary or
 * `fetch` for controlled transport and tests.
 */
export function createFlutterwaveAdapter(options: FlutterwaveAdapterOptions): FlutterwaveAdapter {
  if (!options.publicKey)
    throw new FlutterwaveAdapterError("configuration", "publicKey is required");
  if (!options.secretKey)
    throw new FlutterwaveAdapterError("configuration", "secretKey is required");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const configuredApiBaseUrl = options.apiBaseUrl ?? "https://api.flutterwave.com";
  let end = configuredApiBaseUrl.length;
  while (end > 0 && configuredApiBaseUrl.charCodeAt(end - 1) === 47) end--;
  const apiBaseUrl = configuredApiBaseUrl.slice(0, end);
  const client =
    options.flutterwaveClient ?? createHttpClient(fetchImpl, apiBaseUrl, options.secretKey);

  return {
    async initializePayment(input) {
      const body = standardCheckoutInputSchema.parse(input);
      if (typeof fetchImpl !== "function") {
        throw new FlutterwaveAdapterError("initialize payment", "Fetch is not available");
      }

      let response: Response;
      try {
        response = await fetchImpl(`${apiBaseUrl}/v3/payments`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.secretKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new FlutterwaveAdapterError(
          "initialize payment",
          messageFromUnknown(error) ?? "Flutterwave checkout request failed",
          { cause: error },
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new FlutterwaveAdapterError(
          "initialize payment",
          "Flutterwave returned a non-JSON response",
          { status: response.status, cause: error },
        );
      }
      if (!response.ok) {
        throw new FlutterwaveAdapterError(
          "initialize payment",
          messageFromUnknown(raw) ?? `Flutterwave checkout failed with HTTP ${response.status}`,
          { status: response.status },
        );
      }
      return parseEnvelope("initialize payment", raw, checkoutDataSchema);
    },

    async verifyTransaction(input) {
      if ((input.transactionId === undefined) === (input.txRef === undefined)) {
        throw new FlutterwaveAdapterError(
          "verify transaction",
          "Provide exactly one of transactionId or txRef",
        );
      }
      return input.transactionId !== undefined
        ? sdkCall(
            "verify transaction",
            () => client.Transaction.verify({ id: positiveIdSchema.parse(input.transactionId) }),
            transactionSchema,
          )
        : sdkCall(
            "verify transaction",
            () => client.Transaction.verify_by_tx({ tx_ref: z.string().min(1).parse(input.txRef) }),
            transactionSchema,
          );
    },

    listPaymentPlans: () =>
      sdkCall(
        "list payment plans",
        () => client.PaymentPlan.get_all({}),
        z.array(paymentPlanSchema),
      ),

    listSubscriptions: (input = {}) => {
      // Flutterwave's v3 query parameters are serialized as strings while this
      // adapter keeps numeric identifiers in its public interface.
      const query = {
        email: input.email,
        status: input.status,
        ...(input.plan === undefined ? {} : { plan: String(input.plan) }),
        ...(input.transactionId === undefined
          ? {}
          : { transaction_id: String(input.transactionId) }),
        ...(input.page === undefined ? {} : { page: String(input.page) }),
      };
      return sdkCall(
        "list subscriptions",
        () => client.Subscription.fetch_all(query),
        z.array(subscriptionSchema),
      );
    },

    cancelSubscription: (subscriptionId) =>
      sdkCall(
        "cancel subscription",
        () => client.Subscription.cancel({ id: positiveIdSchema.parse(subscriptionId) }),
        subscriptionSchema,
      ),

    activateSubscription: (subscriptionId) =>
      sdkCall(
        "activate subscription",
        () => client.Subscription.activate({ id: positiveIdSchema.parse(subscriptionId) }),
        subscriptionSchema,
      ),

    chargeToken: (input) => {
      const body = tokenChargeInputSchema.parse(input);
      return sdkCall("charge token", () => client.Tokenized.charge(body), transactionSchema);
    },

    refundTransaction: (transactionId, amount, reason) =>
      sdkCall(
        "refund transaction",
        () =>
          client.Transaction.refund({
            id: positiveIdSchema.parse(transactionId),
            amount: optionalPositiveAmountSchema.parse(amount),
            ...(reason === undefined ? {} : { comments: z.string().min(1).parse(reason) }),
          }),
        refundSchema,
      ),
  };
}

/** @deprecated Parse SDK responses through a concrete adapter method instead. */
export function unwrapSdkResult<T>(result: unknown): T {
  if (typeof result === "object" && result !== null && "data" in result) {
    return Reflect.get(result, "data") as T;
  }
  return result as T;
}

/** @deprecated The adapter itself is now the operations boundary. */
export function getFlutterwaveOps<T>(client: T): T {
  return client;
}
