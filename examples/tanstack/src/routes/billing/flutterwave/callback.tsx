import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { verifyFlutterwaveCallbackServerFn } from "@/lib/flutterwave-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSeoHead } from "@/lib/seo";

export const Route = createFileRoute("/billing/flutterwave/callback")({
  head: () =>
    createSeoHead({
      title: "Flutterwave Checkout Callback",
      description: "Server-verified Flutterwave checkout callback.",
      path: "/billing/flutterwave/callback",
      noIndex: true,
    }),
  validateSearch: (search: Record<string, unknown>) => ({
    txRef: typeof search.tx_ref === "string" ? search.tx_ref : undefined,
    transactionId:
      typeof search.transaction_id === "string" ? Number(search.transaction_id) : undefined,
  }),
  component: CallbackPage,
});

export function CallbackPage() {
  const router = useRouter();
  const verify = useServerFn(verifyFlutterwaveCallbackServerFn);
  const input = Route.useSearch();
  const started = useRef(false);
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("Confirming transaction details with Flutterwave…");

  useEffect(() => {
    if (started.current || (input.txRef === undefined && input.transactionId === undefined)) return;
    started.current = true;
    void verify({ data: input })
      .then((result) => {
        if (result.data.status !== "successful") throw new Error("Payment was not successful");
        setStatus("success");
        setMessage("Payment verified. Redirecting to your dashboard…");
        setTimeout(() => void router.navigate({ to: "/dashboard" }), 1500);
      })
      .catch((error: unknown) => {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Payment verification failed");
      });
  }, [input, router, verify]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {status === "verifying"
              ? "Verifying payment"
              : status === "success"
                ? "Payment verified"
                : "Verification failed"}
          </CardTitle>
        </CardHeader>
        <CardContent>{message}</CardContent>
      </Card>
    </div>
  );
}
