/* oxlint-disable typescript/no-unnecessary-type-assertion */
import type { GenericEndpointContext } from "better-auth";

import type {
  FlutterwavePlan,
  FlutterwaveProduct,
  FlutterwaveRefund,
  FlutterwaveSubscription,
  FlutterwaveTransaction,
  FlutterwaveWebhookEventRecord,
  Member,
  Organization,
  User,
} from "./types";

type Adapter = GenericEndpointContext["context"]["adapter"];
type WhereValue = string | number | boolean | null;
type WhereClause = { field: string; value: WhereValue }[];

export interface BillingStore {
  findSubscriptionById(id: string): Promise<FlutterwaveSubscription | null>;
  findSubscriptionByProviderId(subscriptionId: number): Promise<FlutterwaveSubscription | null>;
  findSubscriptionsByReference(referenceId: string): Promise<FlutterwaveSubscription[]>;
  findCurrentSubscription(
    referenceId: string,
    groupId?: string | null,
  ): Promise<FlutterwaveSubscription | null>;
  retireCompetingSubscriptions(
    referenceId: string,
    groupId: string | null,
    exceptId: string,
  ): Promise<void>;
  findSubscriptionsByTxRef(txRef: string): Promise<FlutterwaveSubscription[]>;
  createSubscription(
    data: Partial<FlutterwaveSubscription> & Record<string, unknown>,
  ): Promise<FlutterwaveSubscription>;
  updateSubscription(
    id: string,
    update: Partial<FlutterwaveSubscription> & Record<string, unknown>,
  ): Promise<FlutterwaveSubscription | null>;
  updateSubscriptionByProviderId(
    subscriptionId: number,
    update: Partial<FlutterwaveSubscription> & Record<string, unknown>,
  ): Promise<FlutterwaveSubscription | null>;
  createTransaction(
    data: Partial<FlutterwaveTransaction> & Record<string, unknown>,
  ): Promise<FlutterwaveTransaction>;
  findTransactionByTxRef(txRef: string): Promise<FlutterwaveTransaction | null>;
  findTransactionById(transactionId: number): Promise<FlutterwaveTransaction | null>;
  updateTransactionByTxRef(
    txRef: string,
    update: Partial<FlutterwaveTransaction> & Record<string, unknown>,
  ): Promise<FlutterwaveTransaction | null>;
  listTransactions(referenceId: string): Promise<FlutterwaveTransaction[]>;
  listProducts(): Promise<FlutterwaveProduct[]>;
  findProductByName(name: string): Promise<FlutterwaveProduct | null>;
  findProductBySlug(slug: string): Promise<FlutterwaveProduct | null>;
  updateProduct(
    id: string,
    update: Partial<FlutterwaveProduct> & Record<string, unknown>,
  ): Promise<void>;
  upsertProductBySlug(
    slug: string,
    data: Partial<FlutterwaveProduct> & Record<string, unknown>,
  ): Promise<void>;
  listPlans(): Promise<FlutterwavePlan[]>;
  findPlanByName(name: string): Promise<FlutterwavePlan | null>;
  findPlanByPaymentPlanId(paymentPlanId: number): Promise<FlutterwavePlan | null>;
  upsertPlanByPaymentPlanId(
    paymentPlanId: number,
    data: Partial<FlutterwavePlan> & Record<string, unknown>,
  ): Promise<void>;
  createWebhookEvent(
    data: Partial<FlutterwaveWebhookEventRecord> & Record<string, unknown>,
  ): Promise<FlutterwaveWebhookEventRecord>;
  findWebhookEvent(eventId: string): Promise<FlutterwaveWebhookEventRecord | null>;
  updateWebhookEvent(
    eventId: string,
    update: Partial<FlutterwaveWebhookEventRecord> & Record<string, unknown>,
  ): Promise<FlutterwaveWebhookEventRecord | null>;
  createRefund(
    data: Partial<FlutterwaveRefund> & Record<string, unknown>,
  ): Promise<FlutterwaveRefund>;
  findRefundByProviderId(refundId: number): Promise<FlutterwaveRefund | null>;
  listPendingRefunds(): Promise<FlutterwaveRefund[]>;
  updateRefund(
    id: string,
    update: Partial<FlutterwaveRefund> & Record<string, unknown>,
  ): Promise<FlutterwaveRefund | null>;
  findUser(id: string): Promise<User | null>;
  findOrganization(id: string): Promise<Organization | null>;
  findOrganizationOwner(organizationId: string): Promise<Member | null>;
  listMembers(organizationId: string): Promise<Member[]>;
  listTeams(organizationId: string): Promise<unknown[]>;
}

function sortSubscriptionsForCurrent(
  subscriptions: FlutterwaveSubscription[],
): FlutterwaveSubscription[] {
  const statusRank = new Map([
    ["active", 0],
    ["trialing", 1],
    ["incomplete", 2],
    ["past_due", 3],
    ["canceled", 4],
  ]);
  return [...subscriptions].sort((a, b) => {
    const statusDifference = (statusRank.get(a.status) ?? 99) - (statusRank.get(b.status) ?? 99);
    return statusDifference !== 0
      ? statusDifference
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function createBillingStore(ctx: GenericEndpointContext): BillingStore {
  return createBillingStoreFromAdapter(ctx.context.adapter);
}

export function createBillingStoreFromAdapter(adapter: Adapter): BillingStore {
  const findOne = async <T>(model: string, where: WhereClause): Promise<T | null> =>
    (await adapter.findOne<T>({ model, where })) ?? null;
  const findMany = async <T>(model: string, where?: WhereClause): Promise<T[]> =>
    (await adapter.findMany<T>({ model, ...(where ? { where } : {}) })) ?? [];

  return {
    findSubscriptionById: (id) => findOne("flutterwaveSubscription", [{ field: "id", value: id }]),
    findSubscriptionByProviderId: (subscriptionId) =>
      findOne("flutterwaveSubscription", [{ field: "subscriptionId", value: subscriptionId }]),
    findSubscriptionsByReference: (referenceId) =>
      findMany("flutterwaveSubscription", [{ field: "referenceId", value: referenceId }]),
    async findCurrentSubscription(referenceId, groupId) {
      const candidates = await this.findSubscriptionsByReference(referenceId);
      const scoped =
        groupId === undefined
          ? candidates
          : candidates.filter(({ groupId: candidateGroup }) =>
              groupId === null
                ? candidateGroup === undefined || candidateGroup === null || candidateGroup === ""
                : candidateGroup === groupId,
            );
      return sortSubscriptionsForCurrent(scoped)[0] ?? null;
    },
    async retireCompetingSubscriptions(referenceId, groupId, exceptId) {
      const candidates = await this.findSubscriptionsByReference(referenceId);
      const now = new Date();
      for (const candidate of candidates) {
        const sameGroup =
          groupId === null
            ? candidate.groupId === undefined ||
              candidate.groupId === null ||
              candidate.groupId === ""
            : candidate.groupId === groupId;
        if (
          candidate.id !== exceptId &&
          sameGroup &&
          (candidate.status === "active" || candidate.status === "trialing")
        ) {
          await this.updateSubscription(candidate.id, {
            status: "canceled",
            cancelAtPeriodEnd: false,
            canceledAt: now,
            endedAt: now,
            updatedAt: now,
          });
        }
      }
    },
    findSubscriptionsByTxRef: (txRef) =>
      findMany("flutterwaveSubscription", [{ field: "txRef", value: txRef }]),
    createSubscription: (data) =>
      adapter.create({
        model: "flutterwaveSubscription",
        data,
      }) as Promise<FlutterwaveSubscription>,
    updateSubscription: (id, update) =>
      adapter.update({
        model: "flutterwaveSubscription",
        update,
        where: [{ field: "id", value: id }],
      }),
    updateSubscriptionByProviderId: (subscriptionId, update) =>
      adapter.update({
        model: "flutterwaveSubscription",
        update,
        where: [{ field: "subscriptionId", value: subscriptionId }],
      }),
    createTransaction: (data) =>
      adapter.create({ model: "flutterwaveTransaction", data }) as Promise<FlutterwaveTransaction>,
    findTransactionByTxRef: (txRef) =>
      findOne("flutterwaveTransaction", [{ field: "txRef", value: txRef }]),
    findTransactionById: (transactionId) =>
      findOne("flutterwaveTransaction", [{ field: "transactionId", value: transactionId }]),
    updateTransactionByTxRef: (txRef, update) =>
      adapter.update({
        model: "flutterwaveTransaction",
        update,
        where: [{ field: "txRef", value: txRef }],
      }),
    async listTransactions(referenceId) {
      const values = await findMany<FlutterwaveTransaction>("flutterwaveTransaction", [
        { field: "referenceId", value: referenceId },
      ]);
      return values.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    async listProducts() {
      const values = await findMany<FlutterwaveProduct>("flutterwaveProduct");
      return values.sort((a, b) => a.name.localeCompare(b.name));
    },
    findProductByName: (name) => findOne("flutterwaveProduct", [{ field: "name", value: name }]),
    findProductBySlug: (slug) => findOne("flutterwaveProduct", [{ field: "slug", value: slug }]),
    async updateProduct(id, update) {
      await adapter.update({
        model: "flutterwaveProduct",
        update,
        where: [{ field: "id", value: id }],
      });
    },
    async upsertProductBySlug(slug, data) {
      const existing = await this.findProductBySlug(slug);
      if (existing?.id !== undefined) {
        const { createdAt: _createdAt, ...update } = data;
        await this.updateProduct(existing.id, update);
      } else {
        await adapter.create({ model: "flutterwaveProduct", data: { ...data, slug } });
      }
    },
    listPlans: () => findMany("flutterwavePlan"),
    findPlanByName: (name) => findOne("flutterwavePlan", [{ field: "name", value: name }]),
    findPlanByPaymentPlanId: (paymentPlanId) =>
      findOne("flutterwavePlan", [{ field: "paymentPlanId", value: paymentPlanId }]),
    async upsertPlanByPaymentPlanId(paymentPlanId, data) {
      const existing = await this.findPlanByPaymentPlanId(paymentPlanId);
      if (existing?.id !== undefined) {
        const { createdAt: _createdAt, ...update } = data;
        await adapter.update({
          model: "flutterwavePlan",
          update,
          where: [{ field: "id", value: existing.id }],
        });
      } else {
        await adapter.create({ model: "flutterwavePlan", data: { ...data, paymentPlanId } });
      }
    },
    createWebhookEvent: (data) =>
      adapter.create({
        model: "flutterwaveWebhookEvent",
        data,
      }) as Promise<FlutterwaveWebhookEventRecord>,
    findWebhookEvent: (eventId) =>
      findOne("flutterwaveWebhookEvent", [{ field: "eventId", value: eventId }]),
    updateWebhookEvent: (eventId, update) =>
      adapter.update({
        model: "flutterwaveWebhookEvent",
        update,
        where: [{ field: "eventId", value: eventId }],
      }),
    createRefund: (data) =>
      adapter.create({ model: "flutterwaveRefund", data }) as Promise<FlutterwaveRefund>,
    findRefundByProviderId: (refundId) =>
      findOne("flutterwaveRefund", [{ field: "refundId", value: refundId }]),
    listPendingRefunds: () =>
      findMany("flutterwaveRefund", [{ field: "status", value: "pending" }]),
    updateRefund: (id, update) =>
      adapter.update({ model: "flutterwaveRefund", update, where: [{ field: "id", value: id }] }),
    findUser: (id) => findOne("user", [{ field: "id", value: id }]),
    findOrganization: (id) => findOne("organization", [{ field: "id", value: id }]),
    findOrganizationOwner: (organizationId) =>
      findOne("member", [
        { field: "organizationId", value: organizationId },
        { field: "role", value: "owner" },
      ]),
    listMembers: (organizationId) =>
      findMany("member", [{ field: "organizationId", value: organizationId }]),
    listTeams: (organizationId) =>
      findMany("team", [{ field: "organizationId", value: organizationId }]),
  };
}
