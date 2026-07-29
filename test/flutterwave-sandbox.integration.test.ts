import { describe, expect, it } from "vitest";
import { createFlutterwaveAdapter } from "../src/flutterwave-sdk";

const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
const hasSandboxCredentials = publicKey !== undefined && secretKey !== undefined;

describe.skipIf(!hasSandboxCredentials)("Flutterwave sandbox adapter", () => {
  it("loads the real CommonJS SDK and reads merchant resources", async () => {
    const flutterwave = createFlutterwaveAdapter({
      publicKey: publicKey!,
      secretKey: secretKey!,
    });

    const [plans, subscriptions] = await Promise.all([
      flutterwave.listPaymentPlans(),
      flutterwave.listSubscriptions({ page: 1 }),
    ]);

    expect(plans).toBeInstanceOf(Array);
    expect(subscriptions).toBeInstanceOf(Array);
  });
});
