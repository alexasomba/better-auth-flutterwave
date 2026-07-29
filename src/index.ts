import { defineErrorCodes, type AuthContext, type BetterAuthPlugin } from "better-auth";
import {
  cancelSubscription,
  createSubscription,
  flutterwaveWebhook,
  getConfig,
  initializeTransaction,
  listPlans,
  listProducts,
  listSubscriptions,
  listTransactions,
  restoreSubscription,
  upgradeSubscription,
  verifyTransaction,
  FLUTTERWAVE_ERROR_CODES,
} from "./routes";
import { getSchema } from "./schema";
import { PACKAGE_VERSION } from "./version";
import type { AnyFlutterwaveOptions, FlutterwaveClientLike, FlutterwaveOptions } from "./types";

export {
  createCheckoutMetadata,
  createProrationMetadata,
  createRenewalMetadata,
  getMetadataBoolean,
  getMetadataNumber,
  getMetadataString,
  hasFlutterwaveMetadata,
  parseFlutterwaveMetadata,
  stringifyFlutterwaveMetadata,
} from "./metadata";
export type { FlutterwaveMetadata } from "./metadata";
export { createFlutterwaveAdapter, FlutterwaveAdapterError } from "./flutterwave-sdk";
export type {
  FlutterwaveAdapter,
  FlutterwaveAdapterOptions,
  FlutterwaveSdkClient,
} from "./flutterwave-sdk";
export { decryptPaymentToken, encryptPaymentToken } from "./token-crypto";
export { checkSeatLimit, checkTeamLimit, getOrganizationEntitlements } from "./limits";
export {
  chargeSubscriptionRenewal,
  refundFlutterwaveTransaction,
  syncFlutterwavePlans,
} from "./operations";
export { reconcileFlutterwaveRefunds, reconcileFlutterwaveTransaction } from "./reconciliation";
export type * from "./types";

declare module "better-auth" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    flutterwave: { creator: typeof flutterwave };
  }
}

const INTERNAL_ERROR_CODES = defineErrorCodes(
  Object.fromEntries(
    Object.entries(FLUTTERWAVE_ERROR_CODES).map(([key, value]) => [
      key,
      typeof value === "string" ? value : value.message,
    ]),
  ),
);

// Keep this as a type alias so Better Auth can infer the concrete endpoint keys
// without adding a string index signature to every auth API.
// oxlint-disable-next-line typescript/consistent-type-definitions
type FlutterwavePluginEndpoints = {
  initializeFlutterwaveTransaction: ReturnType<typeof initializeTransaction>;
  verifyFlutterwaveTransaction: ReturnType<typeof verifyTransaction>;
  listFlutterwaveTransactions: ReturnType<typeof listTransactions>;
  listFlutterwaveSubscriptions: ReturnType<typeof listSubscriptions>;
  createFlutterwaveSubscription: ReturnType<typeof createSubscription>;
  upgradeFlutterwaveSubscription: ReturnType<typeof upgradeSubscription>;
  cancelFlutterwaveSubscription: ReturnType<typeof cancelSubscription>;
  restoreFlutterwaveSubscription: ReturnType<typeof restoreSubscription>;
  listFlutterwaveProducts: ReturnType<typeof listProducts>;
  listFlutterwavePlans: ReturnType<typeof listPlans>;
  getFlutterwaveConfig: ReturnType<typeof getConfig>;
  flutterwaveWebhook: ReturnType<typeof flutterwaveWebhook>;
};

type FlutterwavePluginInstance<O extends AnyFlutterwaveOptions> = Omit<
  BetterAuthPlugin,
  "id" | "version" | "endpoints" | "schema" | "options" | "$ERROR_CODES" | "init"
> & {
  id: "flutterwave";
  version: typeof PACKAGE_VERSION;
  endpoints: FlutterwavePluginEndpoints;
  schema: ReturnType<typeof getSchema>;
  options: NoInfer<O>;
  $ERROR_CODES: typeof INTERNAL_ERROR_CODES;
  init: (ctx: AuthContext) => { options: Record<string, never> };
};

export const flutterwave = <
  TFlutterwaveClient extends FlutterwaveClientLike = FlutterwaveClientLike,
  O extends FlutterwaveOptions<TFlutterwaveClient> = FlutterwaveOptions<TFlutterwaveClient>,
>(
  options: O,
): FlutterwavePluginInstance<O> => {
  const routeOptions = options as unknown as AnyFlutterwaveOptions;
  return {
    id: "flutterwave",
    version: PACKAGE_VERSION,
    endpoints: {
      initializeFlutterwaveTransaction: initializeTransaction(
        routeOptions,
        "/flutterwave/transaction/initialize",
      ),
      verifyFlutterwaveTransaction: verifyTransaction(
        routeOptions,
        "/flutterwave/transaction/verify",
      ),
      listFlutterwaveTransactions: listTransactions(routeOptions, "/flutterwave/transaction/list"),
      listFlutterwaveSubscriptions: listSubscriptions(
        routeOptions,
        "/flutterwave/subscription/list",
      ),
      createFlutterwaveSubscription: createSubscription(
        routeOptions,
        "/flutterwave/subscription/create",
      ),
      upgradeFlutterwaveSubscription: upgradeSubscription(
        routeOptions,
        "/flutterwave/subscription/upgrade",
      ),
      cancelFlutterwaveSubscription: cancelSubscription(
        routeOptions,
        "/flutterwave/subscription/cancel",
      ),
      restoreFlutterwaveSubscription: restoreSubscription(
        routeOptions,
        "/flutterwave/subscription/restore",
      ),
      listFlutterwaveProducts: listProducts(routeOptions, "/flutterwave/product/list"),
      listFlutterwavePlans: listPlans(routeOptions, "/flutterwave/plan/list"),
      getFlutterwaveConfig: getConfig(routeOptions, "/flutterwave/config"),
      flutterwaveWebhook: flutterwaveWebhook(routeOptions, "/flutterwave/webhook"),
    },
    schema: getSchema(routeOptions),
    init: (ctx) => {
      if (options.organization?.enabled === true && !ctx.hasPlugin("organization")) {
        ctx.logger.error(
          "Flutterwave organization billing requires the Better Auth organization plugin.",
        );
      }
      return { options: {} };
    },
    $ERROR_CODES: INTERNAL_ERROR_CODES,
    options,
  };
};
