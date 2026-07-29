import { mergeSchema, type BetterAuthPluginDBSchema, type DBFieldAttribute } from "better-auth/db";

import type { FlutterwaveOptions } from "./types";

type PluginSchemaTable<TableName extends string, FieldName extends string> = Record<
  TableName,
  {
    fields: Record<FieldName, DBFieldAttribute>;
    disableMigration?: boolean;
    modelName?: string;
  }
>;

type TransactionsSchema = PluginSchemaTable<
  "flutterwaveTransaction",
  | "txRef"
  | "transactionId"
  | "flwRef"
  | "referenceId"
  | "userId"
  | "amount"
  | "chargedAmount"
  | "currency"
  | "status"
  | "paymentPlanId"
  | "plan"
  | "product"
  | "paymentType"
  | "subaccountId"
  | "metadata"
  | "verifiedAt"
  | "reconciledAt"
  | "createdAt"
  | "updatedAt"
>;

type SubscriptionsSchema = PluginSchemaTable<
  "flutterwaveSubscription",
  | "plan"
  | "referenceId"
  | "userId"
  | "billingEmail"
  | "subscriptionId"
  | "paymentPlanId"
  | "txRef"
  | "encryptedPaymentToken"
  | "status"
  | "periodStart"
  | "periodEnd"
  | "trialStart"
  | "trialEnd"
  | "cancelAtPeriodEnd"
  | "cancelAt"
  | "canceledAt"
  | "endedAt"
  | "billingInterval"
  | "groupId"
  | "seats"
  | "pendingPlan"
  | "reconciledAt"
  | "createdAt"
  | "updatedAt"
>;

type ProductsSchema = PluginSchemaTable<
  "flutterwaveProduct",
  | "name"
  | "description"
  | "price"
  | "currency"
  | "quantity"
  | "unlimited"
  | "slug"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;

type PlansSchema = PluginSchemaTable<
  "flutterwavePlan",
  | "name"
  | "description"
  | "amount"
  | "currency"
  | "interval"
  | "group"
  | "paymentPlanId"
  | "metadata"
  | "reconciledAt"
  | "createdAt"
  | "updatedAt"
>;

type WebhookEventsSchema = PluginSchemaTable<
  "flutterwaveWebhookEvent",
  | "eventId"
  | "eventType"
  | "transactionId"
  | "txRef"
  | "payload"
  | "status"
  | "processedAt"
  | "createdAt"
  | "updatedAt"
>;

type RefundsSchema = PluginSchemaTable<
  "flutterwaveRefund",
  | "refundId"
  | "transactionId"
  | "txRef"
  | "referenceId"
  | "amount"
  | "currency"
  | "status"
  | "reason"
  | "metadata"
  | "reconciledAt"
  | "createdAt"
  | "updatedAt"
>;

export type FlutterwavePluginSchema = TransactionsSchema &
  SubscriptionsSchema &
  ProductsSchema &
  PlansSchema &
  WebhookEventsSchema &
  RefundsSchema;

export const transactions: TransactionsSchema = {
  flutterwaveTransaction: {
    fields: {
      txRef: { type: "string", required: true, unique: true },
      transactionId: { type: "number", required: false, unique: true },
      flwRef: { type: "string", required: false, index: true },
      referenceId: { type: "string", required: true, index: true },
      userId: { type: "string", required: true, index: true },
      amount: { type: "number", required: false },
      chargedAmount: { type: "number", required: false },
      currency: { type: "string", required: true },
      status: { type: "string", required: true, index: true },
      paymentPlanId: { type: "number", required: false, index: true },
      plan: { type: "string", required: false, index: true },
      product: { type: "string", required: false },
      paymentType: { type: "string", required: false },
      subaccountId: { type: "string", required: false, index: true },
      metadata: { type: "string", required: false },
      verifiedAt: { type: "date", required: false },
      reconciledAt: { type: "date", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const subscriptions: SubscriptionsSchema = {
  flutterwaveSubscription: {
    fields: {
      plan: { type: "string", required: true, index: true },
      referenceId: { type: "string", required: true, index: true },
      userId: { type: "string", required: true, index: true },
      billingEmail: { type: "string", required: true, index: true },
      subscriptionId: { type: "number", required: false, unique: true },
      paymentPlanId: { type: "number", required: false, index: true },
      txRef: { type: "string", required: false, index: true },
      encryptedPaymentToken: { type: "string", required: false },
      status: { type: "string", required: true, defaultValue: "incomplete", index: true },
      periodStart: { type: "date", required: false },
      periodEnd: { type: "date", required: false },
      trialStart: { type: "date", required: false },
      trialEnd: { type: "date", required: false },
      cancelAtPeriodEnd: { type: "boolean", required: false, defaultValue: false },
      cancelAt: { type: "date", required: false },
      canceledAt: { type: "date", required: false },
      endedAt: { type: "date", required: false },
      billingInterval: { type: "string", required: false },
      groupId: { type: "string", required: false, index: true },
      seats: { type: "number", required: false },
      pendingPlan: { type: "string", required: false },
      reconciledAt: { type: "date", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const products: ProductsSchema = {
  flutterwaveProduct: {
    fields: {
      name: { type: "string", required: true },
      description: { type: "string", required: false },
      price: { type: "number", required: true },
      currency: { type: "string", required: true },
      quantity: { type: "number", required: false, defaultValue: 0 },
      unlimited: { type: "boolean", required: false, defaultValue: true },
      slug: { type: "string", required: true, unique: true },
      metadata: { type: "string", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const plans: PlansSchema = {
  flutterwavePlan: {
    fields: {
      name: { type: "string", required: true },
      description: { type: "string", required: false },
      amount: { type: "number", required: true },
      currency: { type: "string", required: true },
      interval: { type: "string", required: true },
      group: { type: "string", required: false },
      paymentPlanId: { type: "number", required: false, unique: true },
      metadata: { type: "string", required: false },
      reconciledAt: { type: "date", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const webhookEvents: WebhookEventsSchema = {
  flutterwaveWebhookEvent: {
    fields: {
      eventId: { type: "string", required: true, unique: true },
      eventType: { type: "string", required: true, index: true },
      transactionId: { type: "number", required: false, index: true },
      txRef: { type: "string", required: false, index: true },
      payload: { type: "string", required: true },
      status: { type: "string", required: true, defaultValue: "pending", index: true },
      processedAt: { type: "date", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const refunds: RefundsSchema = {
  flutterwaveRefund: {
    fields: {
      refundId: { type: "number", required: false, unique: true },
      transactionId: { type: "number", required: true, index: true },
      txRef: { type: "string", required: true, index: true },
      referenceId: { type: "string", required: true, index: true },
      amount: { type: "number", required: true },
      currency: { type: "string", required: true },
      status: { type: "string", required: true, index: true },
      reason: { type: "string", required: false },
      metadata: { type: "string", required: false },
      reconciledAt: { type: "date", required: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    },
  },
};

export const flutterwavePluginSchema: FlutterwavePluginSchema = {
  ...transactions,
  ...subscriptions,
  ...products,
  ...plans,
  ...webhookEvents,
  ...refunds,
};

export const getSchema = (options: FlutterwaveOptions): BetterAuthPluginDBSchema => {
  const { flutterwaveSubscription: _subscription, ...withoutSubscriptions } =
    flutterwavePluginSchema;
  const baseSchema =
    options.subscription?.enabled === true ? flutterwavePluginSchema : withoutSubscriptions;
  const optionSchema = options.schema as Parameters<typeof mergeSchema>[1];

  if (
    options.schema !== undefined &&
    options.subscription?.enabled !== true &&
    "flutterwaveSubscription" in options.schema
  ) {
    const { flutterwaveSubscription: _customSubscription, ...restSchema } = optionSchema ?? {};
    return mergeSchema(baseSchema, restSchema);
  }

  return mergeSchema(baseSchema, optionSchema);
};
