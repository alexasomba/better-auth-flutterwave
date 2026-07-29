import type { BetterFetch, BetterFetchOption, BetterFetchResponse } from "@better-fetch/fetch";
import type { BetterAuthClientPlugin } from "better-auth/client";
import type {
  FlutterwaveInitializeResult,
  FlutterwavePlan,
  FlutterwaveProduct,
  FlutterwaveTransaction,
  FlutterwaveTransactionResponse,
  Subscription,
} from "./types";
import type { flutterwave as flutterwaveServer } from "./index";
import { PACKAGE_VERSION } from "./version";

export { parseFlutterwaveMetadata } from "./metadata";
export type { FlutterwaveMetadata } from "./metadata";

export type FetchResult<T, O extends BetterFetchOption | undefined> = O extends { throw: true }
  ? T
  : BetterFetchResponse<T>;

export interface FlutterwaveProviderActions {
  transaction: {
    initialize: <O extends BetterFetchOption | undefined = undefined>(
      data: {
        amount?: number;
        currency?: string;
        redirectUrl: string;
        txRef?: string;
        referenceId?: string;
        plan?: string;
        product?: string;
        paymentOptions?: string;
        subaccounts?: {
          id: string;
          transactionSplitRatio?: number;
          transactionChargeType?: "flat" | "percentage" | "flat_subaccount";
          transactionCharge?: number;
        }[];
      },
      options?: O,
    ) => Promise<FetchResult<FlutterwaveInitializeResult, O>>;
    verify: <O extends BetterFetchOption | undefined = undefined>(
      data: { transactionId?: string | number; txRef?: string; referenceId?: string },
      options?: O,
    ) => Promise<
      FetchResult<{ status: string; txRef: string; data: FlutterwaveTransactionResponse }, O>
    >;
    list: <O extends BetterFetchOption | undefined = undefined>(
      data?: { query?: { referenceId?: string } },
      options?: O,
    ) => Promise<FetchResult<{ transactions: FlutterwaveTransaction[] }, O>>;
  };
  subscription: {
    create: FlutterwaveProviderActions["transaction"]["initialize"];
    upgrade: FlutterwaveProviderActions["transaction"]["initialize"];
    cancel: <O extends BetterFetchOption | undefined = undefined>(
      data: { subscriptionId: string | number; atPeriodEnd?: boolean },
      options?: O,
    ) => Promise<FetchResult<{ status: string }, O>>;
    restore: <O extends BetterFetchOption | undefined = undefined>(
      data: { subscriptionId: string | number },
      options?: O,
    ) => Promise<FetchResult<{ status: string }, O>>;
    list: <O extends BetterFetchOption | undefined = undefined>(
      data?: { query?: { referenceId?: string } },
      options?: O,
    ) => Promise<FetchResult<{ subscriptions: Subscription[] }, O>>;
  };
  config: () => Promise<
    BetterFetchResponse<{ plans: FlutterwavePlan[]; products: FlutterwaveProduct[] }>
  >;
  listPlans: () => Promise<BetterFetchResponse<{ plans: FlutterwavePlan[] }>>;
  listProducts: () => Promise<BetterFetchResponse<{ products: FlutterwaveProduct[] }>>;
}

export interface FlutterwaveClientActions {
  flutterwave: FlutterwaveProviderActions;
  subscription: FlutterwaveProviderActions["subscription"];
}

declare module "better-auth/client" {
  interface BetterAuthClient {
    flutterwave: FlutterwaveProviderActions;
    subscription: FlutterwaveProviderActions["subscription"];
  }
}

type FlutterwaveClientPluginInstance = Omit<
  BetterAuthClientPlugin,
  "id" | "$InferServerPlugin" | "getActions"
> & {
  id: "flutterwave-client";
  $InferServerPlugin: ReturnType<typeof flutterwaveServer>;
  getActions: ($fetch: BetterFetch) => FlutterwaveClientActions;
};

export const flutterwaveClient = (_options?: {
  subscription?: boolean;
}): FlutterwaveClientPluginInstance => ({
  id: "flutterwave-client",
  version: PACKAGE_VERSION,
  $InferServerPlugin: {} as ReturnType<typeof flutterwaveServer>,
  pathMethods: {
    "/flutterwave/transaction/initialize": "POST",
    "/flutterwave/transaction/verify": "POST",
    "/flutterwave/subscription/create": "POST",
    "/flutterwave/subscription/upgrade": "POST",
    "/flutterwave/subscription/cancel": "POST",
    "/flutterwave/subscription/restore": "POST",
  },
  getActions: ($fetch) => {
    const transaction: FlutterwaveProviderActions["transaction"] = {
      initialize: (data, options) =>
        $fetch("/flutterwave/transaction/initialize", { ...options, method: "POST", body: data }),
      verify: (data, options) =>
        $fetch("/flutterwave/transaction/verify", { ...options, method: "POST", body: data }),
      list: (data, options) =>
        $fetch("/flutterwave/transaction/list", {
          query: data?.query,
          ...options,
          method: "GET",
        }),
    };
    const subscription: FlutterwaveProviderActions["subscription"] = {
      create: (data, options) =>
        $fetch("/flutterwave/subscription/create", { ...options, method: "POST", body: data }),
      upgrade: (data, options) =>
        $fetch("/flutterwave/subscription/upgrade", { ...options, method: "POST", body: data }),
      cancel: (data, options) =>
        $fetch("/flutterwave/subscription/cancel", { ...options, method: "POST", body: data }),
      restore: (data, options) =>
        $fetch("/flutterwave/subscription/restore", { ...options, method: "POST", body: data }),
      list: (data, options) =>
        $fetch("/flutterwave/subscription/list", {
          query: data?.query,
          ...options,
          method: "GET",
        }),
    };
    const provider: FlutterwaveProviderActions = {
      transaction,
      subscription,
      config: () => $fetch("/flutterwave/config", { method: "GET" }),
      listPlans: () => $fetch("/flutterwave/plan/list", { method: "GET" }),
      listProducts: () => $fetch("/flutterwave/product/list", { method: "GET" }),
    };
    return { flutterwave: provider, subscription };
  },
});
