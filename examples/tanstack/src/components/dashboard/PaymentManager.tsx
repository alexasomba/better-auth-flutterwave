import { useEffect, useState } from "react";
import type { FlutterwavePlan, FlutterwaveProduct, Subscription } from "better-auth-flutterwave";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PaymentManager({ activeTab }: { activeTab: "subscriptions" | "one-time" }) {
  const [plans, setPlans] = useState<FlutterwavePlan[]>([]);
  const [products, setProducts] = useState<FlutterwaveProduct[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([
      authClient.flutterwave.listPlans(),
      authClient.flutterwave.listProducts(),
      authClient.subscription.list(),
    ]).then(([planResult, productResult, subscriptionResult]) => {
      setPlans(planResult.data?.plans ?? []);
      setProducts(productResult.data?.products ?? []);
      setSubscriptions(subscriptionResult.data?.subscriptions ?? []);
    });
  }, []);

  const checkout = async (input: { plan?: string; product?: string }) => {
    setMessage("Creating Flutterwave checkout…");
    const result = await authClient.flutterwave.transaction.initialize(
      {
        ...input,
        redirectUrl: `${window.location.origin}/billing/flutterwave/callback`,
      },
      { throw: true },
    );
    window.location.assign(result.url);
  };

  if (activeTab === "one-time") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Local product catalog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {products.map((product) => (
            <div key={product.slug ?? product.name} className="flex items-center justify-between">
              <span>
                {product.name} — {product.currency} {product.price}
              </span>
              <Button onClick={() => void checkout({ product: product.slug ?? product.name })}>
                Buy
              </Button>
            </div>
          ))}
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Flutterwave payment plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.paymentPlanId ?? plan.name}
              className="flex items-center justify-between"
            >
              <span>
                {plan.name} — {plan.currency} {plan.amount} / {plan.interval}
              </span>
              <Button onClick={() => void checkout({ plan: plan.name })}>Subscribe</Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {subscriptions.map((subscription) => (
            <div key={subscription.id} className="flex items-center justify-between">
              <span>
                {subscription.plan} — {subscription.status}
              </span>
              {subscription.subscriptionId !== undefined &&
                subscription.subscriptionId !== null && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void authClient.subscription.cancel({
                        subscriptionId: subscription.subscriptionId!,
                        atPeriodEnd: true,
                      })
                    }
                  >
                    Cancel at period end
                  </Button>
                )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
