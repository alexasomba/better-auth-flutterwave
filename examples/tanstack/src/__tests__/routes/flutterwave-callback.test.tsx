import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import { CallbackPage } from "@/routes/billing/flutterwave/callback";

const { navigate, useSearch, verify, serverFn } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearch: vi.fn(() => ({ txRef: "flw_ref_123", transactionId: 42 })),
  verify: vi.fn(),
  serverFn: { __serverFn: "verifyFlutterwaveCallback" },
}));

vi.mock("@/lib/flutterwave-admin", () => ({ verifyFlutterwaveCallbackServerFn: serverFn }));
vi.mock("@tanstack/react-start", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@tanstack/react-start")),
  useServerFn: () => verify,
}));
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@tanstack/react-router")),
  createFileRoute: () => () => ({ useSearch }),
  useRouter: () => ({ navigate }),
}));

describe("Flutterwave callback route", () => {
  afterEach(() => vi.clearAllMocks());

  it("server-verifies Flutterwave callback identifiers", async () => {
    verify.mockResolvedValue({ data: { status: "successful" } });
    render(<CallbackPage />);
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith({
        data: { txRef: "flw_ref_123", transactionId: 42 },
      }),
    );
    expect(screen.getByText("Payment verified")).toBeInTheDocument();
  });

  it("shows verification failures without navigating", async () => {
    verify.mockRejectedValue(new Error("Transaction mismatch"));
    render(<CallbackPage />);
    await waitFor(() => expect(screen.getByText("Verification failed")).toBeInTheDocument());
    expect(screen.getByText("Transaction mismatch")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
