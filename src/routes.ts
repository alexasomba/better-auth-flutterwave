/* oxlint-disable no-restricted-imports, typescript/strict-boolean-expressions */
import { createHash } from "node:crypto";
import { HIDE_METADATA } from "better-auth";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx, originCheck, sessionMiddleware } from "better-auth/api";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { createBillingStore } from "./billing-store";
import type { FlutterwaveTransactionData } from "./flutterwave-contracts";
import { createFlutterwaveAdapter } from "./flutterwave-sdk";
import { createCheckoutMetadata, stringifyFlutterwaveMetadata } from "./metadata";
import { authorizeBillingReference, resolveBillingReferenceId } from "./reference-access";
import { getWebhookHeaders, getWebhookRequest } from "./route-modules/webhook";
import {
  FLUTTERWAVE_ERROR_CODES,
  hmacSha256Base64,
  timingSafeEqualString,
} from "./route-modules/shared";
import { encryptPaymentToken } from "./token-crypto";
import type {
  AnyFlutterwaveOptions,
  FlutterwaveInitializeResult,
  FlutterwaveProduct,
  FlutterwaveTransactionResponse,
  Session,
  User,
} from "./types";
import { getPlans, normalizeSubscriptionGroup } from "./utils";

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

      const amount =
        ctx.body.amount ??
        (plan?.amount !== undefined
          ? plan.amount + (plan.seatAmount ?? 0) * Math.max(0, ctx.body.quantity - 1)
          : product
            ? product.price * ctx.body.quantity
            : undefined);
      const currency = ctx.body.currency ?? plan?.currency ?? product?.currency;
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
      const expected = ctx.body.txRef
        ? await store.findTransactionByTxRef(ctx.body.txRef)
        : await store.findTransactionById(Number(ctx.body.transactionId));
      if (!expected) throw new APIError("NOT_FOUND", { message: "Transaction not found" });
      if (ctx.body.referenceId !== undefined && ctx.body.referenceId !== expected.referenceId) {
        throw new APIError("UNAUTHORIZED");
      }
      await authenticatedReference(ctx, options, "verify-transaction", expected.referenceId);
      const verified = await adapter(options).verifyTransaction({
        transactionId:
          ctx.body.transactionId === undefined ? undefined : Number(ctx.body.transactionId),
        txRef: ctx.body.txRef,
      });
      if (
        verified.tx_ref !== expected.txRef ||
        verified.amount !== expected.amount ||
        verified.currency !== expected.currency ||
        verified.status !== "successful"
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Verified transaction does not match the expected payment",
        });
      }
      const now = new Date();
      await store.updateTransactionByTxRef(expected.txRef, {
        transactionId: verified.id,
        flwRef: verified.flw_ref,
        chargedAmount: verified.charged_amount,
        paymentType: verified.payment_type,
        status: verified.status,
        verifiedAt: now,
        reconciledAt: now,
        updatedAt: now,
      });

      const linked = await store.findSubscriptionsByTxRef(expected.txRef);
      for (const subscription of linked) {
        let subscriptionId = subscription.subscriptionId;
        if (subscription.paymentPlanId && subscription.billingEmail) {
          const remote = await adapter(options).listSubscriptions({
            email: subscription.billingEmail,
            plan: subscription.paymentPlanId,
            transactionId: verified.id,
          });
          const matches = remote.filter((candidate) => candidate.status !== "cancelled");
          subscriptionId = matches.length === 1 ? matches[0]?.id : undefined;
        }
        await store.updateSubscription(subscription.id, {
          subscriptionId,
          status:
            subscription.paymentPlanId !== undefined &&
            subscription.paymentPlanId !== null &&
            subscriptionId === undefined
              ? "incomplete"
              : "active",
          encryptedPaymentToken: verified.card?.token
            ? await encryptPaymentToken(verified.card.token, ctx.context.secret)
            : subscription.encryptedPaymentToken,
          periodStart: now,
          reconciledAt: now,
          updatedAt: now,
        });
        await store.retireCompetingSubscriptions(
          subscription.referenceId,
          subscription.groupId ?? null,
          subscription.id,
        );
      }
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
  subscriptionId: z.coerce.number().int().positive(),
  atPeriodEnd: z.boolean().optional(),
});

export const cancelSubscription = <P extends string>(options: AnyFlutterwaveOptions, path: P) =>
  createAuthEndpoint(
    path,
    { method: "POST", body: subscriptionBodySchema, use: [sessionMiddleware, originCheck] },
    async (ctx) => {
      const store = createBillingStore(ctx);
      const local = await store.findSubscriptionByProviderId(ctx.body.subscriptionId);
      if (!local) throw new APIError("NOT_FOUND", { message: "Subscription not found" });
      await authenticatedReference(ctx, options, "disable-subscription", local.referenceId);
      const now = new Date();
      if (
        ctx.body.atPeriodEnd === true ||
        options.subscription?.cancelBehavior === "at_period_end"
      ) {
        await store.updateSubscription(local.id, {
          cancelAtPeriodEnd: true,
          cancelAt: local.periodEnd ?? now,
          updatedAt: now,
        });
        return { status: "scheduled" };
      }
      await adapter(options).cancelSubscription(ctx.body.subscriptionId);
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
      const local = await store.findSubscriptionByProviderId(ctx.body.subscriptionId);
      if (!local) throw new APIError("NOT_FOUND", { message: "Subscription not found" });
      await authenticatedReference(ctx, options, "enable-subscription", local.referenceId);
      await adapter(options).activateSubscription(ctx.body.subscriptionId);
      await store.updateSubscription(local.id, {
        status: "active",
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        endedAt: null,
        updatedAt: new Date(),
      });
      return { status: "active" };
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
        .update(`${event.event}:${String(data.id ?? "")}:${String(data.status ?? "")}`)
        .digest("hex");
      const store = createBillingStore(ctx);
      const existingEvent = await store.findWebhookEvent(eventId);
      if (existingEvent?.status === "processed") return ctx.json({ received: true });
      const now = new Date();
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
          if (concurrent.status === "processed" || concurrent.status === "processing") {
            return ctx.json({ received: true });
          }
        }
      } else {
        await store.updateWebhookEvent(eventId, { status: "processing", updatedAt: now });
      }

      if (data.tx_ref && data.id !== undefined) {
        try {
          const local = await store.findTransactionByTxRef(data.tx_ref);
          const verified = await adapter(options).verifyTransaction({
            transactionId: Number(data.id),
          });
          if (
            local &&
            verified.tx_ref === local.txRef &&
            verified.amount === local.amount &&
            verified.currency === local.currency
          ) {
            await store.updateTransactionByTxRef(local.txRef, {
              transactionId: verified.id,
              flwRef: verified.flw_ref,
              chargedAmount: verified.charged_amount,
              paymentType: verified.payment_type,
              status: verified.status,
              verifiedAt: now,
              reconciledAt: now,
              updatedAt: now,
            });
            if (verified.status === "successful") {
              for (const subscription of await store.findSubscriptionsByTxRef(local.txRef)) {
                let subscriptionId = subscription.subscriptionId;
                if (
                  subscription.paymentPlanId !== undefined &&
                  subscription.paymentPlanId !== null &&
                  subscription.billingEmail !== undefined &&
                  subscription.billingEmail !== null &&
                  subscription.billingEmail !== ""
                ) {
                  const remote = await adapter(options).listSubscriptions({
                    email: subscription.billingEmail,
                    plan: subscription.paymentPlanId,
                    transactionId: verified.id,
                  });
                  const matches = remote.filter((candidate) => candidate.status !== "cancelled");
                  subscriptionId = matches.length === 1 ? matches[0]?.id : undefined;
                }
                await store.updateSubscription(subscription.id, {
                  subscriptionId,
                  status:
                    subscription.paymentPlanId !== undefined &&
                    subscription.paymentPlanId !== null &&
                    subscriptionId === undefined
                      ? "incomplete"
                      : "active",
                  encryptedPaymentToken:
                    verified.card?.token !== undefined
                      ? await encryptPaymentToken(verified.card.token, ctx.context.secret)
                      : subscription.encryptedPaymentToken,
                  reconciledAt: now,
                  updatedAt: now,
                });
                await store.retireCompetingSubscriptions(
                  subscription.referenceId,
                  subscription.groupId ?? null,
                  subscription.id,
                );
              }
            }
          }
        } catch (error) {
          ctx.context.logger.error("Flutterwave webhook reconciliation failed", error);
          await store.updateWebhookEvent(eventId, { status: "failed", updatedAt: new Date() });
          return ctx.json({ received: true });
        }
      }
      await store.updateWebhookEvent(eventId, {
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      });
      await options.onEvent?.(event);
      return ctx.json({ received: true });
    },
  );
