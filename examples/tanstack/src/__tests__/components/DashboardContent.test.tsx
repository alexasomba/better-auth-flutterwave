import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import DashboardContent from "@/components/dashboard/DashboardContent";

// Mock sub-components/icons to avoid deep dependencies and icon rendering issues in tests
vi.mock("@phosphor-icons/react", () => ({
  Buildings: () => <div data-testid="icon-buildings" />,
  Clock: () => <div data-testid="icon-clock" />,
  GithubLogo: () => <div data-testid="icon-github" />,
  IdentificationCard: () => <div data-testid="icon-id-card" />,
  Package: () => <div data-testid="icon-package" />,
  Scroll: () => <div data-testid="icon-scroll" />,
  User: () => <div data-testid="icon-user" />,
  CheckCircle: () => <div data-testid="icon-check" />,
  Sparkle: () => <div data-testid="icon-sparkle" />,
  CreditCard: () => <div data-testid="icon-credit-card" />,
  ShieldCheck: () => <div data-testid="icon-shield" />,
  ArrowRight: () => <div data-testid="icon-arrow-right" />,
}));

vi.mock("@/components/dashboard/SignOutButton", () => ({
  default: () => <button type="button">Sign Out</button>,
}));
vi.mock("@/components/dashboard/PaymentManager", () => ({
  default: () => <div>Payment Manager</div>,
}));
vi.mock("@/components/dashboard/TransactionsTable", () => ({
  default: () => <div>Transactions Table</div>,
}));
vi.mock("@/components/dashboard/OrganizationManager", () => ({
  default: () => <div>Organization Manager</div>,
}));

describe("DashboardContent component", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      image: null,
    },
  } as const;

  it("should render user information correctly", () => {
    // Cast via unknown to test session which might have extra properties
    render(
      <DashboardContent
        session={mockSession as unknown as Parameters<typeof DashboardContent>[0]["session"]}
      />,
    );

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByText("user-123")).toBeInTheDocument();
  });

  it("does not invent a Flutterwave customer model", () => {
    const sessionNoCustomer = {
      user: {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        image: null,
      },
    };
    render(
      <DashboardContent
        session={sessionNoCustomer as unknown as Parameters<typeof DashboardContent>[0]["session"]}
      />,
    );

    expect(screen.queryByText(/Flutterwave Customer ID/)).not.toBeInTheDocument();
  });
});
