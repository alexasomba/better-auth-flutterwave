import type { GenericEndpointContext } from "better-auth";

import type {
  AnyFlutterwaveOptions,
  FlutterwaveClientLike,
  FlutterwavePlan,
  FlutterwaveProduct,
  Subscription,
} from "./types.ts";
import { createBillingStore } from "./billing-store.ts";

export function getPlanSeatAmount(plan: FlutterwavePlan): number | undefined {
  if (plan.seatAmount !== undefined) {
    if (
      typeof plan.seatAmount === "number" &&
      Number.isFinite(plan.seatAmount) &&
      plan.seatAmount >= 0
    ) {
      return plan.seatAmount;
    }
    throw new Error(`Invalid seatAmount for plan '${plan.name}'. Expected a finite number.`);
  }

  if (plan.seatPriceId === undefined || plan.seatPriceId === null || plan.seatPriceId === "") {
    return undefined;
  }

  const parsed = typeof plan.seatPriceId === "string" ? Number(plan.seatPriceId) : plan.seatPriceId;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  throw new Error(
    `Invalid seatPriceId for plan '${plan.name}'. Expected a numeric amount in the smallest currency unit.`,
  );
}

export function calculatePlanAmount(plan: FlutterwavePlan, quantity: number): number {
  return (plan.amount ?? 0) + Math.max(0, quantity - 1) * (getPlanSeatAmount(plan) ?? 0);
}

export function normalizeSubscriptionGroup(group: string | undefined | null): string | null {
  const normalized = group?.trim().toLowerCase();
  return normalized === undefined || normalized === "" ? null : normalized;
}

export function isLocallyManagedSubscription(
  subscription: Pick<Subscription, "subscriptionId" | "paymentPlanId">,
): boolean {
  return subscription.subscriptionId === undefined || subscription.subscriptionId === null;
}

export function assertLocallyManagedSubscription(
  subscription: Pick<Subscription, "subscriptionId" | "paymentPlanId">,
  action: string,
): void {
  if (!isLocallyManagedSubscription(subscription)) {
    throw new Error(
      `Flutterwave-managed subscriptions do not support ${action}. Use local billing for seat-based or prorated subscription changes.`,
    );
  }
}

export async function getPlans(
  subscriptionOptions: AnyFlutterwaveOptions["subscription"],
): Promise<FlutterwavePlan[]> {
  if (subscriptionOptions?.enabled === true) {
    return typeof subscriptionOptions.plans === "function"
      ? subscriptionOptions.plans()
      : subscriptionOptions.plans;
  }
  return [];
}

export const getPlan: (
  options: AnyFlutterwaveOptions,
  planId: string,
) => Promise<FlutterwavePlan | null> = async (options, planId) => {
  if (options.subscription?.enabled === true) {
    const plans = await getPlans(options.subscription);
    return plans.find((plan) => plan.name === planId) ?? null;
  }
  return null;
};

export async function getPlanByName(
  options: AnyFlutterwaveOptions,
  name: string,
): Promise<FlutterwavePlan | null> {
  if (typeof name !== "string" || name.trim() === "") {
    return null;
  }
  if (options.subscription?.enabled === true) {
    const plans = await getPlans(options.subscription);
    const normalizedName = name.toLowerCase();
    return (
      plans.find(
        (plan) => typeof plan.name === "string" && plan.name.toLowerCase() === normalizedName,
      ) ?? null
    );
  }
  return null;
}

export async function getPlanByPriceId(
  options: AnyFlutterwaveOptions,
  priceId: string,
): Promise<FlutterwavePlan | null> {
  if (options.subscription?.enabled === true) {
    const plans = await getPlans(options.subscription);
    return plans.find((plan) => plan.name === priceId) ?? null;
  }
  return null;
}

export async function getProducts(
  productOptions: AnyFlutterwaveOptions["products"],
): Promise<FlutterwaveProduct[]> {
  if (productOptions?.products) {
    return typeof productOptions.products === "function"
      ? await productOptions.products()
      : productOptions.products;
  }
  return [];
}

export async function getProductByName(
  options: AnyFlutterwaveOptions,
  name: string,
): Promise<FlutterwaveProduct | null> {
  return await getProducts(options.products).then((products) =>
    products !== undefined && products !== null
      ? (products.find((product) => product.name.toLowerCase() === name.toLowerCase()) ?? null)
      : null,
  );
}

export function getNextPeriodEnd(startDate: Date, interval: string): Date | null {
  const date = new Date(startDate);
  const day = date.getUTCDate();
  const addMonths = (months: number) => {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  };
  switch (interval) {
    case "hourly":
      date.setUTCHours(date.getUTCHours() + 1);
      break;
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "monthly":
      addMonths(1);
      break;
    case "quarterly":
      addMonths(3);
      break;
    case "biannually":
    case "bi-annually":
      addMonths(6);
      break;
    case "annually":
    case "yearly":
      addMonths(12);
      break;
    default: {
      const recurring = /^every (\d+) (hours?|days?|weeks?|months?|years?)$/.exec(interval);
      if (!recurring) return null;
      const count = Number(recurring[1]);
      if (!Number.isSafeInteger(count) || count < 1) return null;
      const unit = recurring[2];
      if (unit?.startsWith("hour")) date.setUTCHours(date.getUTCHours() + count);
      else if (unit?.startsWith("day")) date.setUTCDate(date.getUTCDate() + count);
      else if (unit?.startsWith("week")) date.setUTCDate(date.getUTCDate() + count * 7);
      else addMonths(count * (unit?.startsWith("year") ? 12 : 1));
      if (!Number.isFinite(date.getTime())) return null;
    }
  }
  return date;
}

/**
 * Validates if the amount meets Flutterwave's minimum transaction requirements.
 * Amounts should be in the smallest currency unit (e.g., kobo, cents).
 */
export function validateMinAmount(amount: number, currency: string): boolean {
  const minAmounts: Record<string, number> = {
    NGN: 5000, // 50.00
    GHS: 10, // 0.10
    ZAR: 100, // 1.00
    KES: 300, // 3.00
    USD: 200, // 2.00
    XOF: 100, // 1.00
  };
  const min = minAmounts[currency.toUpperCase()];
  return min !== undefined ? amount >= min : true;
}

export async function syncProductQuantityFromFlutterwave(
  ctx: GenericEndpointContext,
  productName: string,
  _flutterwaveClient: FlutterwaveClientLike,
): Promise<void> {
  // Flutterwave does not provide a product catalogue. Inventory is authoritative locally.
  await decrementProductQuantity(ctx, productName);
}

export async function decrementProductQuantity(
  ctx: GenericEndpointContext,
  productName: string,
): Promise<void> {
  const store = createBillingStore(ctx);
  let product = await store.findProductByName(productName);

  product ??= await store.findProductBySlug(productName.toLowerCase().replace(/\s+/g, "-"));

  if (product !== undefined && product !== null) {
    if (
      product.unlimited !== true &&
      typeof product.quantity === "number" &&
      product.quantity > 0 &&
      product.id !== undefined
    ) {
      await store.updateProduct(product.id, {
        quantity: product.quantity - 1,
        updatedAt: new Date(),
      });
    }
  }
}

export async function syncSubscriptionSeats(
  ctx: GenericEndpointContext,
  organizationId: string,
  options: AnyFlutterwaveOptions,
): Promise<void> {
  if (options.subscription?.enabled !== true) return;

  const store = createBillingStore(ctx);
  const subscriptions = (await store.findSubscriptionsByReference(organizationId)).filter(
    (subscription) => subscription.status === "active" || subscription.status === "trialing",
  );
  const seatSubscriptions: Subscription[] = [];
  for (const candidate of subscriptions) {
    const candidatePlan = await getPlanByName(options, candidate.plan);
    if (candidatePlan !== null && getPlanSeatAmount(candidatePlan) !== undefined) {
      seatSubscriptions.push(candidate);
    }
  }
  const members = await store.listMembers(organizationId);
  const quantity = members.length;
  for (const subscription of seatSubscriptions) {
    try {
      assertLocallyManagedSubscription(subscription, "automatic seat sync");

      // Locally managed subscriptions renew via saved authorizations, so seat count lives in our DB.
      await store.updateSubscription(subscription.id, {
        seats: quantity,
        updatedAt: new Date(),
      });
    } catch (e: unknown) {
      ctx.context.logger.error("Failed to sync subscription seats", e);
    }
  }
}
