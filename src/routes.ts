/* oxlint-disable no-restricted-imports, typescript/strict-boolean-expressions */
import { createHash } from "node:crypto";
import { HIDE_METADATA } from "better-auth";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx, originCheck, sessionMiddleware } from "better-auth/api";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { createBillingStore } from "./billing-store.ts";
import { paymentMatches, recordVerifiedPayment } from "./billing-lifecycle.ts";
import type { FlutterwaveTransactionData } from "./flutterwave-contracts.ts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk.ts";
import { createCheckoutMetadata, stringifyFlutterwaveMetadata } from "./metadata.ts";
import { authorizeBillingReference, resolveBillingReferenceId } from "./reference-access.ts";
import { getWebhookHeaders, getWebhookRequest } from "./route-modules/webhook.ts";
import {
  FLUTTERWAVE_ERROR_CODES,
  hmacSha256Base64,
  timingSafeEqualString,
} from "./route-modules/shared.ts";
import type {
  AnyFlutterwaveOptions,
  FlutterwaveInitializeResult,
  FlutterwaveProduct,
  FlutterwaveTransactionResponse,
  Session,
  User,
} from "./types.ts";
import {
  calculatePlanAmount,
  getPlanSeatAmount,
  getPlans,
  normalizeSubscriptionGroup,
} from "./utils.ts";

export { FLUTTERWAVE_ERROR_CODES };

const subaccountSchema = z.object({
  id: z.string().min(1),
  transactionSplitRatio: z.number().positive().optional(),
  transactionChargeType: z.enum(["flat", "percentage", "flat_subaccount"]).optional(),
  transactionCharge: z.number().nonnegative().optional(),
});

const initializeBodySchema = z.object({
  amount: z.number().positive().optional(),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  redirectUrl: z.string().url(),
  txRef: z.string().min(1).max(100).optional(),
  referenceId: z.string().optional(),
  plan: z.string().optional(),
  product: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  paymentOptions: z.string().optional(),
  subaccounts: z.array(subaccountSchema).optional(),
});

const verifyBodySchema = z
  .object({
    transactionId: z.union([z.string(), z.number()]).optional(),
    txRef: z.string().optional(),
    referenceId: z.string().optional(),
  })
  .refine((body) => (body.transactionId === undefined) !== (body.txRef === undefined), {
    message: "Provide exactly one of transactionId or txRef",
  });

const webhookPayloadSchema = z.object({
  event: z.string().min(1),
  data: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      tx_ref: z.string().optional(),
      flw_ref: z.string().optional(),
      status: z.string().optional(),
      amount: z.coerce.number().optional(),
      charged_amount: z.coerce.number().optional(),
      currency: z.string().optional(),
      payment_type: z.string().optional(),
      customer: z.object({ email: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
});

function adapter(options: AnyFlutterwaveOptions) {
  return createFlutterwaveAdapter({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    flutterwaveClient: options.flutterwaveClient,
    fetch: options.fetch,
    apiBaseUrl: options.apiBaseUrl,
  });
}

function mapTransaction(data: FlutterwaveTransactionData): FlutterwaveTransactionResponse {
  return {
    id: data.id,
    txRef: data.tx_ref,
    flwRef: data.flw_ref ?? undefined,
    status: data.status,
    amount: data.amount,
    chargedAmount: data.charged_amount,
    currency: data.currency,
    paymentType: data.payment_type ?? undefined,
    customer: data.customer
      ? {
          email: data.customer.email,
          name: data.customer.name ?? undefined,
        }
      : undefined,
  };
}

async function authenticatedReference(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  action:
    | "initialize-transaction"
    | "verify-transaction"
    | "list-subscriptions"
    | "list-transactions"
    | "disable-subscription"
    | "enable-subscription",
  requested?: string,
): Promise<{ user: User; session: Session; referenceId: string }> {
  const current = await getSessionFromCtx(ctx);
  if (!current) throw new APIError("UNAUTHORIZED");
  const referenceId = requested ?? current.user.id;
  await authorizeBillingReference(ctx, options, {
    user: current.user,
    session: current.session,
    referenceId,
    action,
  });
  return { user: current.user, session: current.session, referenceId };
}

async function resolveBillingEmail(
  ctx: GenericEndpointContext,
  options: AnyFlutterwaveOptions,
  referenceId: string,
  user: User,
): Promise<string> {
  if (referenceId === user.id) return user.email;
  if (options.organization?.enabled !== true) throw new APIError("UNAUTHORIZED");
  const store = createBillingStore(ctx);
  const organization = await store.findOrganization(referenceId);
  const explicit = (organization as { email?: string | null } | null)?.email;
  if (explicit) return explicit;
  const owner = await store.findOrganizationOwner(referenceId);
  const ownerUser = owner ? await store.findUser(owner.userId) : null;
  if (!ownerUser?.email) throw new APIError("BAD_REQUEST", { message: "Billing email not found" });
  return ownerUser.email;
}

async function configuredProducts(options: AnyFlutterwaveOptions): Promise<FlutterwaveProduct[]> {
  const source = options.products?.products;
  if (!source) return [];
  return typeof source === "function" ? source() : source;
}

export const initializeTransaction = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    {
      method: "POST",
      body: initializeBodySchema,
      use: [sessionMiddleware, originCheck],
    },
    async (ctx) => {
      const { user, referenceId } = await authenticatedReference(
        ctx,
        options,
        "initialize-transaction",
        ctx.body.referenceId,
      );
      if (
        options.subscription?.requireEmailVerification === true &&
        ctx.body.plan &&
        user.emailVerified !== true
      ) {
        throw new APIError("BAD_REQUEST", FLUTTERWAVE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED);
      }

      const billingEmail = await resolveBillingEmail(ctx, options, referenceId, user);
      const plans = await getPlans(options.subscription);
      const plan = ctx.body.plan
        ? plans.find((candidate) => candidate.name.toLowerCase() === ctx.body.plan?.toLowerCase())
        : undefined;
      if (ctx.body.plan && !plan) throw new APIError("NOT_FOUND", { message: "Plan not found" });

      const products = await configuredProducts(options);
      const product = ctx.body.product
        ? products.find(
            (candidate) =>
              candidate.name.toLowerCase() === ctx.body.product?.toLowerCase() ||
              candidate.slug === ctx.body.product,
          )
        : undefined;
      if (ctx.body.product && !product) {
        throw new APIError("NOT_FOUND", { message: "Product not found" });
      }
      if (plan && product) {
        throw new APIError("BAD_REQUEST", { message: "Select a plan or a product, not both" });
      }
      if (plan) {
        if (plan.amount === undefined || !Number.isFinite(plan.amount) || plan.amount <= 0) {
          throw new APIError("BAD_REQUEST", {
            message: "The plan requires a configured positive amount",
          });
        }
        if (
          ctx.body.quantity > 1 &&
          (plan.paymentPlanId != null || getPlanSeatAmount(plan) === undefined)
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Additional seats require a locally billed per-seat price",
          });
        }
      }

      const amount = plan
        ? calculatePlanAmount(plan, ctx.body.quantity)
        : product
          ? product.price * ctx.body.quantity
          : ctx.body.amount;
      const currency = plan ? plan.currency : product ? product.currency : ctx.body.currency;
      if (!amount || !currency) {
        throw new APIError("BAD_REQUEST", { message: "amount and currency are required" });
      }

      const requestedSplits = ctx.body.subaccounts ?? options.marketplace?.defaultSplit;
      const allowed = new Set(options.marketplace?.allowedSubaccountIds ?? []);
      if (requestedSplits?.some(({ id }) => !allowed.has(id))) {
        throw new APIError("FORBIDDEN", { message: "Subaccount is not allowlisted" });
      }
      const txRef = ctx.body.txRef ?? `flw_${crypto.randomUUID()}`;
      const groupId = normalizeSubscriptionGroup(plan?.group);
      const metadata = createCheckoutMetadata({
        referenceId,
        userId: user.id,
        plan: plan?.name,
        groupId,
        product: product?.name,
        extra: ctx.body.metadata,
        trial: { isTrial: false, requested: false, granted: false },
      });
      const result = await adapter(options).initializePayment({
        tx_ref: txRef,
        amount,
        currency,
        redirect_url: ctx.body.redirectUrl,
        customer: { email: billingEmail, name: user.name },
        payment_options: plan?.paymentPlanId ? "card" : ctx.body.paymentOptions,
        payment_plan: plan?.paymentPlanId,
        subaccounts: requestedSplits?.map((split) => ({
          id: split.id,
          transaction_charge_type:
            split.transactionChargeType === "flat_subaccount"
              ? "flat"
              : split.transactionChargeType,
          transaction_charge: split.transactionCharge,
          transaction_split_ratio: split.transactionSplitRatio,
        })),
        meta: metadata,
      });

      const store = createBillingStore(ctx);
      const now = new Date();
      await store.createTransaction({
        txRef,
        referenceId,
        userId: user.id,
        amount,
        currency,
        status: "pending",
        plan: plan?.name,
        product: product?.name,
        subaccountId: requestedSplits?.[0]?.id,
        metadata: stringifyFlutterwaveMetadata(metadata),
        createdAt: now,
        updatedAt: now,
      });
      if (plan) {
        await store.createSubscription({
          userId: user.id,
          referenceId,
          plan: plan.name,
          paymentPlanId: plan.paymentPlanId,
          txRef,
          billingEmail,
          status: "incomplete",
          seats: ctx.body.quantity,
          groupId,
          cancelAtPeriodEnd: false,
          billingInterval: plan.interval,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        kind: "checkout",
        url: result.link,
        txRef,
        redirect: true,
      } satisfies FlutterwaveInitializeResult;
    },
  );

export const verifyTransaction = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    { method: "POST", body: verifyBodySchema, use: [sessionMiddleware, originCheck] },
    async (ctx) => {
      const store = createBillingStore(ctx);
      const verified = await adapter(options).verifyTransaction({
        transactionId:
          ctx.body.transactionId === undefined ? undefined : Number(ctx.body.transactionId),
        txRef: ctx.body.txRef,
      });
      const expected = await store.findTransactionByTxRef(verified.tx_ref);
      if (!expected) throw new APIError("NOT_FOUND", { message: "Transaction not found" });
      if (ctx.body.referenceId !== undefined && ctx.body.referenceId !== expected.referenceId) {
        throw new APIError("UNAUTHORIZED");
      }
      await authenticatedReference(ctx, options, "verify-transaction", expected.referenceId);
      if (
        (ctx.body.txRef !== undefined && verified.tx_ref !== ctx.body.txRef) ||
        !paymentMatches(expected, verified) ||
        verified.status !== "successful"
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Verified transaction does not match the expected payment",
        });
      }
      await recordVerifiedPayment(ctx, options, expected, verified);
      return {
        status: verified.status,
        txRef: verified.tx_ref,
        data: mapTransaction(verified),
      };
    },
  );

const referenceQuerySchema = z.object({ referenceId: z.string().optional() });

export const listTransactions = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    { method: "GET", query: referenceQuerySchema, use: [sessionMiddleware] },
    async (ctx) => {
      const current = await getSessionFromCtx(ctx);
      if (!current) throw new APIError("UNAUTHORIZED");
      const referenceId = resolveBillingReferenceId({
        query: ctx.query,
        requestUrl: ctx.request?.url,
        fallbackUserId: current.user.id,
      });
      await authenticatedReference(ctx, options, "list-transactions", referenceId);
      return { transactions: await createBillingStore(ctx).listTransactions(referenceId) };
    },
  );

export const listSubscriptions = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    { method: "GET", query: referenceQuerySchema, use: [sessionMiddleware] },
    async (ctx) => {
      const current = await getSessionFromCtx(ctx);
      if (!current) throw new APIError("UNAUTHORIZED");
      const referenceId = resolveBillingReferenceId({
        query: ctx.query,
        requestUrl: ctx.request?.url,
        fallbackUserId: current.user.id,
      });
      await authenticatedReference(ctx, options, "list-subscriptions", referenceId);
      return {
        subscriptions: await createBillingStore(ctx).findSubscriptionsByReference(referenceId),
      };
    },
  );

const subscriptionBodySchema = z.object({
  subscriptionId: z.union([z.number().int().positive(), z.string().min(1)]),
  atPeriodEnd: z.boolean().optional(),
});

async function findSubscription(ctx: GenericEndpointContext, id: string | number) {
  const store = createBillingStore(ctx);
  if (typeof id === "string") {
    const local = await store.findSubscriptionById(id);
    if (local) return local;
  }
  const providerId = Number(id);
  return Number.isInteger(providerId) && providerId > 0
    ? store.findSubscriptionByProviderId(providerId)
    : null;
}

export const cancelSubscription = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    { method: "POST", body: subscriptionBodySchema, use: [sessionMiddleware, originCheck] },
    async (ctx) => {
      const store = createBillingStore(ctx);
      const local = await findSubscription(ctx, ctx.body.subscriptionId);
      if (!local) throw new APIError("NOT_FOUND", { message: "Subscription not found" });
      await authenticatedReference(ctx, options, "disable-subscription", local.referenceId);
      const now = new Date();
      if (
        ctx.body.atPeriodEnd === true ||
        options.subscription?.cancelBehavior === "at_period_end"
      ) {
        if (!local.periodEnd || !Number.isFinite(new Date(local.periodEnd).getTime())) {
          throw new APIError("BAD_REQUEST", {
            message: "The paid subscription period is unknown; cancel immediately instead",
          });
        }
        if (local.paymentPlanId != null && local.subscriptionId == null) {
          throw new APIError("BAD_REQUEST", {
            message:
              "The native subscription has not been identified yet; reconcile its payment first",
          });
        }
        // Stop the next provider charge now; the scheduler ends the already-paid access later.
        if (local.subscriptionId != null && local.cancelAtPeriodEnd !== true) {
          await adapter(options).cancelSubscription(local.subscriptionId);
        }
        await store.updateSubscription(local.id, {
          cancelAtPeriodEnd: true,
          cancelAt: local.periodEnd,
          ...(local.subscriptionId != null ? { canceledAt: local.canceledAt ?? now } : {}),
          updatedAt: now,
        });
        return { status: "scheduled" };
      }
      if (local.paymentPlanId != null && local.subscriptionId == null) {
        throw new APIError("BAD_REQUEST", {
          message:
            "The native subscription has not been identified yet; reconcile its payment first",
        });
      }
      if (local.subscriptionId != null)
        await adapter(options).cancelSubscription(local.subscriptionId);
      await store.updateSubscription(local.id, {
        status: "canceled",
        cancelAtPeriodEnd: false,
        canceledAt: now,
        endedAt: now,
        updatedAt: now,
      });
      return { status: "canceled" };
    },
  );

export const restoreSubscription = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    {
      method: "POST",
      body: subscriptionBodySchema.omit({ atPeriodEnd: true }),
      use: [sessionMiddleware, originCheck],
    },
    async (ctx) => {
      const store = createBillingStore(ctx);
      const local = await findSubscription(ctx, ctx.body.subscriptionId);
      if (!local) throw new APIError("NOT_FOUND", { message: "Subscription not found" });
      await authenticatedReference(ctx, options, "enable-subscription", local.referenceId);
      if (
        local.subscriptionId == null &&
        local.periodEnd != null &&
        new Date(local.periodEnd) <= new Date()
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "The paid period has ended; renew through checkout instead",
        });
      }
      if (local.cancelAtPeriodEnd !== true || local.canceledAt != null) {
        if (local.subscriptionId == null) {
          if (local.status === "active" && local.endedAt == null) return { status: "active" };
          throw new APIError("BAD_REQUEST", {
            message: "A canceled local subscription requires a new checkout",
          });
        }
        await adapter(options).activateSubscription(local.subscriptionId);
      }
      await store.updateSubscription(local.id, {
        status: local.cancelAtPeriodEnd === true ? local.status : "active",
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        endedAt: null,
        updatedAt: new Date(),
      });
      return { status: local.cancelAtPeriodEnd === true ? local.status : "active" };
    },
  );

export const createSubscription = initializeTransaction;
export const upgradeSubscription = initializeTransaction;
export const disableFlutterwaveSubscription = cancelSubscription;
export const enableFlutterwaveSubscription = restoreSubscription;

export const listProducts = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(path, { method: "GET" }, async (ctx) => {
    const configured = await configuredProducts(options);
    const stored = await createBillingStore(ctx).listProducts();
    return { products: stored.length > 0 ? stored : configured };
  });

export const listPlans = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(path, { method: "GET" }, async (ctx) => {
    const configured = await getPlans(options.subscription);
    const stored = await createBillingStore(ctx).listPlans();
    return { plans: stored.length > 0 ? stored : configured };
  });

export const getConfig = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(path, { method: "GET" }, async (ctx) => ({
    plans: (await createBillingStore(ctx).listPlans()).concat(await getPlans(options.subscription)),
    products: await configuredProducts(options),
    subscriptions: options.subscription?.enabled === true,
    marketplace: options.marketplace !== undefined,
  }));

export const flutterwaveWebhook = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    {
      method: "POST",
      metadata: { ...HIDE_METADATA, openapi: { operationId: "flutterwaveWebhook" } },
      cloneRequest: true,
      disableBody: true,
    },
    async (ctx) => {
      const request = getWebhookRequest(ctx as GenericEndpointContext);
      if (!request) throw new APIError("BAD_REQUEST", { message: "Request is missing" });
      const rawBody = await request.text();
      const signature = getWebhookHeaders(ctx as GenericEndpointContext)?.get(
        "flutterwave-signature",
      );
      if (!signature) throw new APIError("UNAUTHORIZED", { message: "Missing signature" });
      const expectedSignature = await hmacSha256Base64(
        options.webhook?.secretHash ?? options.secretHash,
        rawBody,
      );
      if (!timingSafeEqualString(signature, expectedSignature)) {
        throw new APIError("UNAUTHORIZED", { message: "Invalid signature" });
      }

      let webhookJson: unknown;
      try {
        webhookJson = JSON.parse(rawBody);
      } catch {
        ctx.context.logger.warn("Ignoring non-JSON signed Flutterwave webhook");
        return ctx.json({ received: true });
      }
      const parsedEvent = webhookPayloadSchema.safeParse(webhookJson);
      if (!parsedEvent.success) {
        ctx.context.logger.warn("Ignoring malformed signed Flutterwave webhook");
        return ctx.json({ received: true });
      }
      const event = parsedEvent.data;
      const data = event.data;
      const eventId = createHash("sha256")
        .update(
          data.id === undefined
            ? rawBody
            : `${event.event}:${String(data.id)}:${String(data.status ?? "")}`,
        )
        .digest("hex");
      const store = createBillingStore(ctx);
      const existingEvent = await store.findWebhookEvent(eventId);
      if (existingEvent?.status === "processed") return ctx.json({ received: true });
      const now = new Date();
      const busy = () =>
        new APIError("SERVICE_UNAVAILABLE", {
          message: "Webhook processing is still in progress; retry delivery",
        });
      if (existingEvent === null) {
        try {
          await store.createWebhookEvent({
            eventId,
            eventType: event.event,
            transactionId: data.id === undefined ? undefined : Number(data.id),
            txRef: data.tx_ref,
            payload: rawBody,
            status: "processing",
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          const concurrent = await store.findWebhookEvent(eventId);
          if (concurrent === null) throw error;
          if (concurrent.status === "processed") {
            return ctx.json({ received: true });
          }
          throw busy();
        }
      } else {
        const leaseExpiresAt = new Date(existingEvent.updatedAt).getTime() + 5 * 60_000;
        if (existingEvent.status === "processing" && leaseExpiresAt > now.getTime()) throw busy();
        if (!(await store.claimWebhookEvent(existingEvent, now))) throw busy();
      }

      try {
        if (data.tx_ref && data.id !== undefined) {
          const local = await store.findTransactionByTxRef(data.tx_ref);
          if (!local) throw new Error("The webhook payment has not been recorded locally yet");
          const verified = await adapter(options).verifyTransaction({
            transactionId: Number(data.id),
          });
          if (data.status === "successful" && verified.status !== "successful") {
            throw new Error("The provider has not verified the successful payment yet");
          }
          await recordVerifiedPayment(ctx, options, local, verified);
          // Application fulfillment must see verified payment details, including its status.
          Object.assign(data, {
            id: verified.id,
            tx_ref: verified.tx_ref,
            amount: verified.amount,
            currency: verified.currency,
            status: verified.status,
          });
        }
        await options.onEvent?.(event);
        await store.updateWebhookEvent(eventId, {
          status: "processed",
          processedAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (error) {
        ctx.context.logger.error("Flutterwave webhook processing failed", error);
        await store.updateWebhookEvent(eventId, { status: "failed", updatedAt: new Date() });
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "Webhook processing failed; retry delivery",
        });
      }
      return ctx.json({ received: true });
    },
  );
