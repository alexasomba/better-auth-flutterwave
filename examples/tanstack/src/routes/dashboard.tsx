import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";
import DashboardContent from "@/components/dashboard/DashboardContent";
import { createSeoHead } from "@/lib/seo";

const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session;
});

export const Route = createFileRoute("/dashboard")({
  loader: async () => {
    const session = await getSession();

    if (session?.user === null || session?.user === undefined) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/" });
    }

    return {
      session,
    };
  },
  component: DashboardPage,
  head: () =>
    createSeoHead({
      title: "Billing Dashboard",
      description:
        "Authenticated billing dashboard for the Better Auth Flutterwave TanStack Start example.",
      path: "/dashboard",
      noIndex: true,
    }),
});

function DashboardPage() {
  const { session } = Route.useLoaderData();
  return <DashboardContent session={session} />;
}
