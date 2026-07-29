/* oxlint-disable no-restricted-imports */
import { createRequire } from "node:module";
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
} from "./flutterwave-contracts";

type SdkResult = Promise<unknown>;

/** The deliberately small, typed portion of flutterwave-node-v3 used by this package. */
export interface FlutterwaveSdkClient {
  Transaction: {
    verify(input: { id: number }): SdkResult;
    verify_by_tx(input: { tx_ref: string }): SdkResult;
    refund(input: { id: number; amount?: number }): SdkResult;
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

export interface FlutterwaveAdapterOptions {
  publicKey: string;
  secretKey: string;
  flutterwaveClient?: FlutterwaveSdkClient;
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
  refundTransaction(transactionId: number, amount?: number): Promise<FlutterwaveRefundData>;
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

type FlutterwaveConstructor = new (
  publicKey: string,
  secretKey: string,
  production?: boolean | string,
) => FlutterwaveSdkClient;

const require = createRequire(import.meta.url);

function createSdkClient(publicKey: string, secretKey: string): FlutterwaveSdkClient {
  // The official package is CommonJS and ships no TypeScript declarations. Keeping the
  // assertion here prevents its `any` surface from escaping into application code.
  const Flutterwave = require("flutterwave-node-v3") as FlutterwaveConstructor;
  return new Flutterwave(publicKey, secretKey);
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
 * `flutterwave-node-v3` performs always-on telemetry and writes telemetry state in
 * the operating-system temporary directory. Inject `flutterwaveClient` in tests,
 * serverless environments that prohibit those writes, or when custom transport is
 * required. This adapter intentionally uses only the SDK's Promise API.
 */
export function createFlutterwaveAdapter(options: FlutterwaveAdapterOptions): FlutterwaveAdapter {
  if (!options.publicKey)
    throw new FlutterwaveAdapterError("configuration", "publicKey is required");
  if (!options.secretKey)
    throw new FlutterwaveAdapterError("configuration", "secretKey is required");

  const client = options.flutterwaveClient ?? createSdkClient(options.publicKey, options.secretKey);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiBaseUrl = (options.apiBaseUrl ?? "https://api.flutterwave.com").replace(/\/+$/, "");

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
      // flutterwave-node-v3's Joi schema unusually requires these numeric query
      // values as strings, while our public interface keeps them numeric.
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

    refundTransaction: (transactionId, amount) =>
      sdkCall(
        "refund transaction",
        () =>
          client.Transaction.refund({
            id: positiveIdSchema.parse(transactionId),
            amount: optionalPositiveAmountSchema.parse(amount),
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
