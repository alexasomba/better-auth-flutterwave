import type { GenericEndpointContext, InferOptionSchema, Session, User } from "better-auth";
import type { Member, Organization } from "better-auth/plugins/organization";
import type { FlutterwavePluginSchema } from "./schema";
import type { FlutterwaveSdkClient } from "./flutterwave-sdk";

export type { Member, Organization, Session, User };

export type FlutterwaveCurrency = string;
export type FlutterwaveCheckoutChannel =
  | "card"
  | "account"
  | "banktransfer"
  | "ussd"
  | "mobilemoney"
  | "mpesa"
  | "fawry"
  | "enaira"
  | "opay"
  | "applepay"
  | "googlepay";

export interface FlutterwaveCustomer {
  email: string;
  name?: string;
  phoneNumber?: string;
}

export interface FlutterwaveSubaccountSplit {
  id: string;
  transactionSplitRatio?: number;
  transactionChargeType?: "flat" | "percentage" | "flat_subaccount";
  transactionCharge?: number;
}

export interface FlutterwaveTransaction {
  id: string;
  txRef: string;
  transactionId?: number | null;
  flwRef?: string | null;
  referenceId: string;
  userId: string;
  amount: number;
  chargedAmount?: number | null;
  currency: string;
  status: string;
  plan?: string | null;
  product?: string | null;
  paymentType?: string | null;
  subaccountId?: string | null;
  metadata?: string | null;
  verifiedAt?: Date | null;
  reconciledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlutterwaveProduct {
  id?: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  quantity?: number;
  unlimited?: boolean;
  slug?: string;
  metadata?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InputFlutterwaveProduct {
  name: string;
  description?: string;
  amount: number;
  currency: string;
}

export interface FlutterwavePlan {
  id?: string;
  name: string;
  description?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  duration?: number;
  paymentPlanId?: number;
  seatAmount?: number;
  seatPriceId?: number | string;
  seatPlanCode?: string;
  group?: string;
  freeTrial?: {
    days?: number;
    onTrialStart?: (subscription: Subscription) => Promise<void>;
    onTrialEnd?: (subscription: Subscription) => Promise<void>;
    onTrialExpired?: (subscription: Subscription) => Promise<void>;
  };
  limits?: Record<string, unknown>;
  features?: string[];
  metadata?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FlutterwaveWebhookEvent {
  event: string;
  data: Record<string, unknown> & {
    id?: number | string;
    tx_ref?: string;
    flw_ref?: string;
    status?: string;
    amount?: number;
    charged_amount?: number;
    currency?: string;
    payment_type?: string;
    customer?: { email?: string };
  };
}

export type FlutterwaveWebhookPayload = FlutterwaveWebhookEvent;

export interface FlutterwaveTransactionResponse {
  id: number | string;
  txRef: string;
  flwRef?: string;
  status: string;
  amount: number;
  chargedAmount?: number;
  currency: string;
  paymentType?: string;
  customer?: FlutterwaveCustomer;
  paymentPlanId?: number;
  subscriptionId?: number;
  meta?: Record<string, unknown>;
}

export interface FlutterwaveInitializeResult {
  kind: "checkout";
  url: string;
  txRef: string;
  redirect: true;
}

export interface SubscriptionOptions {
  enabled?: boolean;
  plans: FlutterwavePlan[] | (() => Promise<FlutterwavePlan[]>);
  autoSyncQuantity?: boolean;
  cancelBehavior?: "at_period_end" | "immediately";
  requireEmailVerification?: boolean;
  allowedPaymentChannels?: FlutterwaveCheckoutChannel[];
  authorizeReference?: (
    data: { user: User; session: Session; referenceId: string; action: string },
    ctx: GenericEndpointContext,
  ) => Promise<boolean>;
  onSubscriptionComplete?: (
    data: { event: FlutterwaveWebhookPayload; subscription: Subscription; plan: FlutterwavePlan },
    ctx: GenericEndpointContext,
  ) => Promise<void>;
  onSubscriptionCreated?: (
    data: { event: FlutterwaveWebhookPayload; subscription: Subscription; plan: FlutterwavePlan },
    ctx: GenericEndpointContext,
  ) => Promise<void>;
  onSubscriptionUpdate?: (
    data: { event: FlutterwaveWebhookPayload; subscription: Subscription; plan: FlutterwavePlan },
    ctx: GenericEndpointContext,
  ) => Promise<void>;
  onSubscriptionCancel?: (
    data: { event: FlutterwaveWebhookPayload; subscription: Subscription },
    ctx: GenericEndpointContext,
  ) => Promise<void>;
}

export interface FlutterwaveOptions<
  TFlutterwaveClient extends FlutterwaveClientLike = FlutterwaveClientLike,
> {
  publicKey: string;
  secretKey: string;
  secretHash: string;
  flutterwaveClient?: TFlutterwaveClient;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  billingPattern?: "native" | "local";
  webhook?: { secretHash?: string };
  subscription?: SubscriptionOptions;
  organization?: { enabled?: boolean; billingRoles?: string[] };
  products?: { products?: FlutterwaveProduct[] | (() => Promise<FlutterwaveProduct[]>) };
  marketplace?: {
    allowedSubaccountIds: string[];
    defaultSplit?: FlutterwaveSubaccountSplit[];
  };
  onEvent?: (event: FlutterwaveWebhookEvent) => Promise<void>;
  schema?: InferOptionSchema<FlutterwavePluginSchema>;
}

export interface Subscription {
  id: string;
  userId: string;
  organizationId?: string;
  plan: string;
  pendingPlan?: string | null;
  subscriptionId?: number | null;
  paymentPlanId?: number | null;
  txRef?: string | null;
  billingEmail?: string | null;
  encryptedPaymentToken?: string | null;
  status: string;
  seats: number;
  referenceId: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt?: Date | null;
  canceledAt?: Date | null;
  endedAt?: Date | null;
  billingInterval?: string | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  groupId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FlutterwaveSubscription = Subscription;

export interface FlutterwaveRefund {
  id: string;
  transactionId: number;
  refundId?: number | null;
  txRef: string;
  referenceId: string;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  metadata?: string | null;
  reconciledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlutterwaveWebhookEventRecord {
  id: string;
  eventId: string;
  eventType: string;
  transactionId?: number | null;
  txRef?: string | null;
  payload: string;
  status: string;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FlutterwaveClientLike = FlutterwaveSdkClient;

export type AnyFlutterwaveOptions = FlutterwaveOptions<FlutterwaveClientLike>;
export interface FlutterwaveSyncResult {
  status: "success";
  count: number;
}
export interface ChargeRecurringSubscriptionInput {
  subscriptionId: string;
  amount?: number;
  redirectUrl?: string;
}
export interface ChargeRecurringSubscriptionResult {
  status: "success" | "pending" | "failed";
  data: FlutterwaveTransactionResponse | FlutterwaveInitializeResult;
}
