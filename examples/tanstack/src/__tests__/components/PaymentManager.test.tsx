import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const { authClient, flutterwaveActions, subscriptionActions } = vi.hoisted(() => ({
  authClient: {
    organization: { list: vi.fn() },
  },
  flutterwaveActions: {
    config: vi.fn(),
    transaction: { initialize: vi.fn(), list: vi.fn() },
  },
  subscriptionActions: {
    list: vi.fn(),
    cancel: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock("@/lib/auth-client", () => ({ authClient }));
vi.mock("@/lib/flutterwave-client", () => ({ flutterwaveActions, subscriptionActions }));

import PaymentManager from "@/components/dashboard/PaymentManager";

describe("Flutterwave PaymentManager", () => {
  it("renders configured plans, products, organizations, subscriptions, and transactions", async () => {
    flutterwaveActions.config.mockResolvedValue({
      data: {
        plans: [{ name: "starter", amount: 5000, currency: "NGN", interval: "monthly" }],
        products: [{ name: "Credits", slug: "credits", price: 2500, currency: "NGN" }],
      },
    });
    subscriptionActions.list.mockResolvedValue({
      data: {
        subscriptions: [
          {
            id: "sub-1",
            plan: "starter",
            status: "active",
            subscriptionId: 123,
            referenceId: "user-1",
            cancelAtPeriodEnd: false,
          },
        ],
      },
    });
    flutterwaveActions.transaction.list.mockResolvedValue({
      data: {
        transactions: [
          {
            txRef: "flw_123",
            status: "successful",
            amount: 5000,
            currency: "NGN",
            transactionId: 42,
          },
        ],
      },
    });
    authClient.organization.list.mockResolvedValue({
      data: [{ id: "org-1", name: "Acme", slug: "acme" }],
    });

    render(<PaymentManager activeTab="subscriptions" />);

    expect((await screen.findAllByText("starter")).length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("flw_123")).toBeInTheDocument();
  });

  it("initializes checkout with the selected organization and quantity", async () => {
    flutterwaveActions.config.mockResolvedValue({
      data: {
        plans: [
          { name: "team", amount: 25000, currency: "NGN", interval: "monthly", seatAmount: 5000 },
        ],
        products: [],
      },
    });
    subscriptionActions.list.mockResolvedValue({ data: { subscriptions: [] } });
    flutterwaveActions.transaction.list.mockResolvedValue({ data: { transactions: [] } });
    authClient.organization.list.mockResolvedValue({
      data: [{ id: "org-1", name: "Acme", slug: "acme" }],
    });
    flutterwaveActions.transaction.initialize.mockResolvedValue({
      data: { kind: "checkout", url: "https://checkout.test/flw", txRef: "flw_1", redirect: true },
    });

    render(<PaymentManager activeTab="subscriptions" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /subscribe/i })).toBeEnabled());
    screen.getByRole("button", { name: /subscribe/i }).click();

    await waitFor(() =>
      expect(flutterwaveActions.transaction.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "team", referenceId: undefined, quantity: 1 }),
        { throw: true },
      ),
    );
  });

  it("cancels a local subscription using its local ID and paid period", async () => {
    flutterwaveActions.config.mockResolvedValue({ data: { plans: [], products: [] } });
    subscriptionActions.list.mockResolvedValue({
      data: {
        subscriptions: [
          {
            id: "local-sub",
            plan: "team",
            status: "active",
            referenceId: "user-1",
            periodEnd: "2026-11-01T12:00:00Z",
            cancelAtPeriodEnd: false,
          },
        ],
      },
    });
    flutterwaveActions.transaction.list.mockResolvedValue({ data: { transactions: [] } });
    authClient.organization.list.mockResolvedValue({ data: [] });
    subscriptionActions.cancel.mockResolvedValue({ status: "scheduled" });
    render(<PaymentManager activeTab="subscriptions" />);
    const cancel = await screen.findByRole("button", { name: "Cancel at period end" });
    cancel.click();
    await waitFor(() =>
      expect(subscriptionActions.cancel).toHaveBeenCalledWith(
        { subscriptionId: "local-sub", atPeriodEnd: true },
        { throw: true },
      ),
    );
  });
});
