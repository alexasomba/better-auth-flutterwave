import { describe, expect, it, vi } from "vitest";
import { createCloudflareFlutterwaveClient } from "../lib/flutterwave-cloudflare-client";

describe("Cloudflare Flutterwave client", () => {
  it("uses fetch instead of the Node-only SDK for transaction verification", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "success", data: { id: 42 } }));
    const client = createCloudflareFlutterwaveClient(
      "test-secret",
      fetchMock as typeof globalThis.fetch,
    );

    await expect(client.Transaction.verify({ id: 42 })).resolves.toEqual({
      status: "success",
      data: { id: 42 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.flutterwave.com/v3/transactions/42/verify"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-secret" }),
      }),
    );
  });

  it("forwards reference verification as a query parameter", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "success", data: {} }));
    const client = createCloudflareFlutterwaveClient(
      "test-secret",
      fetchMock as typeof globalThis.fetch,
    );

    await client.Transaction.verify_by_tx({ tx_ref: "tx-demo" });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=tx-demo",
    );
  });
});
