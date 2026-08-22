import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FlutterwavePlan,
  FlutterwaveProduct,
  FlutterwaveTransaction,
  Subscription,
} from "better-auth-flutterwave";

import {
  ActionMessageBanner,
  type OperationMessage,
} from "@/components/dashboard/payment/ActionMessageBanner";
import {
  BillingTargetSelector,
  type BillingOrganization,
} from "@/components/dashboard/payment/BillingTargetSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { flutterwaveActions, subscriptionActions } from "@/lib/flutterwave-client";

type Organization = BillingOrganization;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

function formatAmount(amount: number | undefined, currency: string | undefined) {
  if (amount === undefined || currency === undefined) return "Amount unavailable";
  return `${currency} ${amount.toLocaleString()}`;
}

function isActiveSubscription(subscription: Subscription) {
  return ["active", "trialing", "past_due", "unpaid"].includes(subscription.status);
}

export default function PaymentManager({ activeTab }: { activeTab: "subscriptions" | "one-time" }) {
  const [plans, setPlans] = useState<FlutterwavePlan[]>([]);
  const [products, setProducts] = useState<FlutterwaveProduct[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [transactions, setTransactions] = useState<FlutterwaveTransaction[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedBillingTarget, setSelectedBillingTarget] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<OperationMessage | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, subscriptionsResult, transactionsResult, organizationsResult] =
        await Promise.all([
          flutterwaveActions.config(),
          subscriptionActions.list(),
          flutterwaveActions.transaction.list(),
          authClient.organization.list(),
        ]);

      setPlans(configResult.data?.plans ?? []);
      setProducts(configResult.data?.products ?? []);
      setSubscriptions(subscriptionsResult.data?.subscriptions ?? []);
      setTransactions(transactionsResult.data?.transactions ?? []);
      setOrganizations((organizationsResult.data ?? []) as Organization[]);
    } catch (error: unknown) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "Failed to load Flutterwave billing data."),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeSubscriptions = useMemo(
    () => subscriptions.filter(isActiveSubscription),
    [subscriptions],
  );

  async function startCheckout(input: { plan?: string; product?: string }) {
    const key = input.plan ?? input.product ?? "checkout";
    setBusyKey(key);
    setMessage(null);
    try {
      const checkoutInput = {
        ...input,
        quantity,
        referenceId: selectedBillingTarget === "" ? undefined : selectedBillingTarget,
        redirectUrl: `${window.location.origin}/billing/flutterwave/callback`,
      } as Parameters<typeof flutterwaveActions.transaction.initialize>[0];
      const result = await flutterwaveActions.transaction.initialize(checkoutInput, {
        throw: true,
      });
      window.location.assign(result.url);
    } catch (error: unknown) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "Could not start Flutterwave checkout."),
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function updateSubscription(subscription: Subscription, action: "cancel" | "restore") {
    const subscriptionId = subscription.subscriptionId;
    if (subscriptionId === undefined || subscriptionId === null) return;
    setBusyKey(`${action}-${subscription.id}`);
    setMessage(null);
    try {
      if (action === "cancel") {
        await subscriptionActions.cancel({ subscriptionId, atPeriodEnd: true }, { throw: true });
        setMessage({
          tone: "success",
          text: `${subscription.plan} will cancel at the end of its period.`,
        });
      } else {
        await subscriptionActions.restore({ subscriptionId }, { throw: true });
        setMessage({ tone: "success", text: `${subscription.plan} subscription restored.` });
      }
      await loadData();
    } catch (error: unknown) {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, `Could not ${action} subscription.`),
      });
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading Flutterwave billing…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {message !== null && <ActionMessageBanner message={message} />}

      {activeTab === "subscriptions" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Flutterwave subscription plans</CardTitle>
              <CardDescription>
                Native plans use Flutterwave payment plan IDs; local plans use Better Auth lifecycle
                management.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <BillingTargetSelector
                organizations={organizations}
                selectedBillingTarget={selectedBillingTarget}
                quantity={quantity}
                onBillingTargetChange={setSelectedBillingTarget}
                onQuantityChange={setQuantity}
              />
              {plans.length === 0 && (
                <p className="text-sm text-muted-foreground">No plans are configured.</p>
              )}
              {plans.map((plan) => (
                <div
                  key={plan.name}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatAmount(plan.amount, plan.currency)} /{" "}
                      {plan.interval ?? "billing period"}
                    </p>
                    {plan.features?.length ? (
                      <p className="text-xs text-muted-foreground">{plan.features.join(" · ")}</p>
                    ) : null}
                  </div>
                  <Button
                    onClick={() => void startCheckout({ plan: plan.name })}
                    disabled={busyKey !== null}
                  >
                    {busyKey === plan.name ? "Opening checkout…" : "Subscribe"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current subscriptions</CardTitle>
              <CardDescription>
                {activeSubscriptions.length} active or trialing subscription(s)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {subscriptions.length === 0 && (
                <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
              )}
              {subscriptions.map((subscription) => (
                <div
                  key={subscription.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{subscription.plan}</p>
                    <p className="text-sm text-muted-foreground">{subscription.referenceId}</p>
                    {subscription.cancelAtPeriodEnd ? (
                      <p className="text-xs text-amber-600">Cancels at period end</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{subscription.status}</Badge>
                    {subscription.subscriptionId !== undefined &&
                      subscription.subscriptionId !== null &&
                      (subscription.cancelAtPeriodEnd ? (
                        <Button
                          variant="outline"
                          onClick={() => void updateSubscription(subscription, "restore")}
                          disabled={busyKey !== null}
                        >
                          {busyKey === `restore-${subscription.id}` ? "Restoring…" : "Restore"}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void updateSubscription(subscription, "cancel")}
                          disabled={busyKey !== null}
                        >
                          {busyKey === `cancel-${subscription.id}`
                            ? "Canceling…"
                            : "Cancel at period end"}
                        </Button>
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>One-time products</CardTitle>
            <CardDescription>
              Products are local catalog entries backed by Flutterwave checkout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BillingTargetSelector
              organizations={organizations}
              selectedBillingTarget={selectedBillingTarget}
              quantity={quantity}
              onBillingTargetChange={setSelectedBillingTarget}
              onQuantityChange={setQuantity}
            />
            {products.length === 0 && (
              <p className="text-sm text-muted-foreground">No products are configured.</p>
            )}
            {products.map((product) => (
              <div
                key={product.slug ?? product.name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div>
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatAmount(product.price, product.currency)}
                  </p>
                </div>
                <Button
                  onClick={() => void startCheckout({ product: product.slug ?? product.name })}
                  disabled={busyKey !== null}
                >
                  {busyKey === (product.slug ?? product.name) ? "Opening checkout…" : "Buy"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
          <CardDescription>
            Only server-persisted Flutterwave transaction records are shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {transactions.length === 0 && (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
          {transactions.slice(0, 5).map((transaction) => (
            <div
              key={transaction.txRef}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <span>{transaction.txRef}</span>
              <span>{formatAmount(transaction.amount, transaction.currency)}</span>
              <Badge variant="outline">{transaction.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
