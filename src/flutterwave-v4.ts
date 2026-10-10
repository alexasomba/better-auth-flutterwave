import { randomBytes } from "node:crypto";

export interface FlutterwaveV4Options {
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  identityUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface FlutterwaveV4CustomerInput {
  email: string;
  name?: { first?: string; middle?: string; last?: string };
  phone?: { country_code?: string; number?: string };
  address?: {
    city?: string;
    country?: string;
    line1?: string;
    line2?: string;
    postal_code?: string;
    state?: string;
  };
  meta?: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
}

export interface FlutterwaveV4CardPaymentMethodInput {
  customerId?: string;
  encrypted_card_number: string;
  encrypted_expiry_month: string;
  encrypted_expiry_year: string;
  encrypted_cvv: string;
  nonce: string;
  idempotencyKey: string;
  traceId?: string;
}

export interface FlutterwaveV4ChargeInput {
  amount: number;
  currency: string;
  reference: string;
  customerId: string;
  paymentMethodId: string;
  recurring?: boolean;
  redirectUrl?: string;
  meta?: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
}

export interface FlutterwaveV4RefundInput {
  chargeId: string;
  amount: number;
  reason: FlutterwaveV4RefundReason;
  idempotencyKey: string;
  traceId?: string;
}

export type FlutterwaveV4RefundReason =
  | "duplicate"
  | "fraudulent"
  | "requested_by_customer"
  | "expired_uncaptured_charge";

export type FlutterwaveV4ChargeAuthorization =
  | { type: "pin"; pin: { nonce: string; encrypted_pin: string } }
  | { type: "otp"; otp: { code: string } };

export interface FlutterwaveV4Resource {
  id: string;
  [key: string]: unknown;
}

export interface FlutterwaveV4Adapter {
  createCustomer(input: FlutterwaveV4CustomerInput): Promise<FlutterwaveV4Resource>;
  createCardPaymentMethod(
    input: FlutterwaveV4CardPaymentMethodInput,
  ): Promise<FlutterwaveV4Resource>;
  createCharge(input: FlutterwaveV4ChargeInput): Promise<FlutterwaveV4Resource>;
  retrieveCharge(chargeId: string): Promise<FlutterwaveV4Resource>;
  updateChargeAuthorization(input: {
    chargeId: string;
    authorization: FlutterwaveV4ChargeAuthorization;
    idempotencyKey: string;
    traceId?: string;
  }): Promise<FlutterwaveV4Resource>;
  createRefund(input: FlutterwaveV4RefundInput): Promise<FlutterwaveV4Resource>;
}

const DEFAULT_IDENTITY_URL =
  "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const DEFAULT_API_URL = "https://f4bexperience.flutterwave.com";

/**
 * Create a server-only Flutterwave v4 transport. It accepts encrypted card
 * fields only; raw PAN/CVV handling belongs in a PCI-compliant client flow.
 */
export function createFlutterwaveV4Adapter(options: FlutterwaveV4Options): FlutterwaveV4Adapter {
  if (!options.clientId || !options.clientSecret) {
    throw new Error("Flutterwave v4 clientId and clientSecret are required");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available");
  const baseUrl = (options.apiBaseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const identityUrl = options.identityUrl ?? DEFAULT_IDENTITY_URL;
  const now = options.now ?? Date.now;
  let token: string | undefined;
  let refreshAt = 0;
  let tokenRequest: Promise<string> | undefined;

  const getToken = async (): Promise<string> => {
    if (token !== undefined && token.length > 0 && now() < refreshAt) return token;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const response = await fetchImpl(identityUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          grant_type: "client_credentials",
        }),
      });
      const raw = await parseJson(response, "authenticate");
      const accessToken = field(raw, "access_token");
      const expiresIn = Number(field(raw, "expires_in"));
      if (!response.ok || typeof accessToken !== "string" || !Number.isFinite(expiresIn)) {
        throw v4Error("authenticate", response.status, raw);
      }
      token = accessToken;
      // Flutterwave recommends refresh at least 60 seconds before expiry.
      refreshAt = now() + Math.max(0, expiresIn - 60) * 1_000;
      return accessToken;
    })().finally(() => {
      tokenRequest = undefined;
    });
    return tokenRequest;
  };

  const request = async (
    operation: string,
    path: string,
    input: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      idempotencyKey?: string;
      traceId?: string;
    } = {},
    allowAuthRetry = true,
  ): Promise<FlutterwaveV4Resource> => {
    const method = input.method ?? "GET";
    if (method !== "GET") validateIdempotencyKey(input.idempotencyKey);
    if (input.traceId !== undefined) validateTraceId(input.traceId);
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${await getToken()}`,
      "content-type": "application/json",
    });
    if (input.idempotencyKey !== undefined) headers.set("x-idempotency-key", input.idempotencyKey);
    if (input.traceId !== undefined) headers.set("x-trace-id", input.traceId);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    const raw = await parseJson(response, operation);
    if (response.status === 401 && allowAuthRetry) {
      token = undefined;
      refreshAt = 0;
      // Retry once with a fresh OAuth token; POST idempotency keys make this safe.
      return request(operation, path, input, false);
    }
    if (!response.ok) throw v4Error(operation, response.status, raw);
    const status = field(raw, "status");
    const data = field(raw, "data");
    if (status !== "success" || !isObject(data) || typeof data.id !== "string") {
      throw new Error(`Flutterwave v4 ${operation} returned an invalid response`);
    }
    return data as FlutterwaveV4Resource;
  };

  const withTraceId = (value?: string) => value ?? randomBytes(16).toString("hex");

  return {
    createCustomer: async (input) => {
      const { idempotencyKey, traceId, ...body } = input;
      if (!input.email.includes("@")) throw new Error("A valid customer email is required");
      return request("create customer", "/customers", {
        method: "POST",
        body,
        idempotencyKey,
        traceId: withTraceId(traceId),
      });
    },
    createCardPaymentMethod: async (input) => {
      const { idempotencyKey, traceId, customerId, ...card } = input;
      if (Object.values(card).some((value) => typeof value !== "string" || value.length === 0)) {
        throw new Error("Flutterwave v4 requires encrypted card fields and a nonce");
      }
      return request("create payment method", "/payment-methods", {
        method: "POST",
        body: {
          type: "card",
          card,
          ...(customerId !== undefined ? { customer_id: customerId } : {}),
        },
        idempotencyKey,
        traceId: withTraceId(traceId),
      });
    },
    createCharge: async (input) => {
      validateReference(input.reference);
      if (!Number.isFinite(input.amount) || input.amount < 0.01) {
        throw new Error("Flutterwave v4 charge amount must be at least 0.01");
      }
      const { idempotencyKey, traceId, customerId, paymentMethodId, redirectUrl, ...charge } =
        input;
      return request("create charge", "/charges", {
        method: "POST",
        body: {
          ...charge,
          customer_id: customerId,
          payment_method_id: paymentMethodId,
          ...(redirectUrl !== undefined ? { redirect_url: redirectUrl } : {}),
        },
        idempotencyKey,
        traceId: withTraceId(traceId),
      });
    },
    retrieveCharge: async (chargeId) => {
      if (!chargeId) throw new Error("Flutterwave v4 charge id is required");
      return request("retrieve charge", `/charges/${encodeURIComponent(chargeId)}`);
    },
    updateChargeAuthorization: async (input) => {
      if (!input.chargeId) throw new Error("Flutterwave v4 charge id is required");
      return request(
        "update charge authorization",
        `/charges/${encodeURIComponent(input.chargeId)}`,
        {
          method: "PUT",
          body: { authorization: input.authorization },
          idempotencyKey: input.idempotencyKey,
          traceId: withTraceId(input.traceId),
        },
      );
    },
    createRefund: async (input) => {
      if (!input.chargeId || !isV4RefundReason(input.reason)) {
        throw new Error("Flutterwave v4 refund chargeId and reason are required");
      }
      if (!Number.isFinite(input.amount) || input.amount < 0.01) {
        throw new Error("Flutterwave v4 refund amount must be at least 0.01");
      }
      const { idempotencyKey, traceId, chargeId, ...refund } = input;
      return request("create refund", "/refunds", {
        method: "POST",
        body: { charge_id: chargeId, ...refund },
        idempotencyKey,
        traceId: withTraceId(traceId),
      });
    },
  };
}

async function parseJson(response: Response, operation: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`Flutterwave v4 ${operation} returned non-JSON HTTP ${response.status}`, {
      cause,
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function validateIdempotencyKey(value: string | undefined): asserts value is string {
  if (value === undefined || value.length === 0 || !/^[\x21-\x7E]{12,255}$/.test(value)) {
    throw new Error("Flutterwave v4 idempotency keys must be 12-255 printable ASCII characters");
  }
}

function validateTraceId(value: string): void {
  if (!/^[\x21-\x7E]{12,255}$/.test(value)) {
    throw new Error("Flutterwave v4 trace ids must be 12-255 printable ASCII characters");
  }
}

function validateReference(value: string): void {
  if (!/^[A-Za-z0-9-]{6,42}$/.test(value)) {
    throw new Error("Flutterwave v4 references must be 6-42 letters, digits, or hyphens");
  }
}

function isV4RefundReason(value: unknown): value is FlutterwaveV4RefundReason {
  return (
    value === "duplicate" ||
    value === "fraudulent" ||
    value === "requested_by_customer" ||
    value === "expired_uncaptured_charge"
  );
}

function v4Error(operation: string, status: number, raw: unknown): Error {
  const message = field(field(raw, "error"), "message") ?? field(raw, "message");
  const error = new Error(
    typeof message === "string"
      ? message
      : `Flutterwave v4 ${operation} failed with HTTP ${status}`,
  );
  Object.assign(error, { status, retryable: status === 408 || status === 429 || status >= 500 });
  return error;
}
