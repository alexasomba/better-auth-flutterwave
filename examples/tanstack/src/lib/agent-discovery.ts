const publicPages = [
  {
    path: "/",
    changefreq: "weekly",
    priority: "1.0",
  },
] as const;

export const linkHeader =
  '</.well-known/api-catalog>; rel="api-catalog", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", </api/health>; rel="status", <https://github.com/alexasomba/better-auth-flutterwave#readme>; rel="service-doc"';

export const homeMarkdown = `# Better Auth Flutterwave TanStack Start Example

This example demonstrates Better Auth anonymous sessions with Flutterwave billing flows.

## Crawlable Pages

- Home: anonymous sign-in entry point.

## Transaction Routes

- Flutterwave callback: payment verification return path, intentionally excluded from the sitemap.

## Agent Resources

- API catalog: /.well-known/api-catalog
- OpenAPI description: /openapi.json
- Health endpoint: /api/health
- Sitemap: /sitemap.xml
`;

export const flutterwaveSkillMarkdown = `# better-auth-flutterwave-demo

Use this site to inspect and exercise the Better Auth Flutterwave TanStack Start demo. The app uses
anonymous Better Auth sessions, organization billing, Flutterwave checkout, transaction verification,
local subscriptions, Flutterwave-managed subscriptions, local catalog data, and trusted operations.

## Resources

- API catalog: /.well-known/api-catalog
- OpenAPI description: /openapi.json
- Health endpoint: /api/health
- Sitemap: /sitemap.xml
- Auth route: /api/auth/$
- Callback route: /billing/flutterwave/callback

## Primary Flow

1. Visit / and click the anonymous login action.
2. After sign-in, use /dashboard as the main billing workbench.
3. Use the Organizations panel to create an organization and make it active.
4. In the subscriptions view, select personal billing or an organization billing target.
5. Start checkout for a Flutterwave-native plan, a local plan, or a one-time product.
6. Return through /billing/flutterwave/callback?transaction_id=...&tx_ref=... so the app verifies it.
7. Inspect subscriptions and transactions after verification.

## Billing Workflows

- Personal checkout: initialize a transaction without referenceId.
- Organization checkout: initialize with referenceId set to the organization id.
- Organization seat billing: pass quantity for local/custom plans when the selected billing target is
  an organization.
- Product purchase: use one-time products from the dashboard products view.
- Subscription create/upgrade: use plan names from the displayed catalog, not payment plan IDs.
- Subscription cancel/restore: use the active subscription controls.
- Local renewal: use the trusted server operation; if no reusable token exists, complete hosted
  checkout before the renewal is considered paid.

## Agent Notes

- Do not treat the callback redirect as proof of payment. The callback verifies the Flutterwave
  transaction with the Better Auth Flutterwave API.
- Server operations such as plan sync and local renewal run through TanStack server functions and
  require an authenticated session.
- Organization billing requires the signed-in user to be an owner or admin of the organization.
- If a checkout opens an external Flutterwave URL in tests, assert the generated URL/reference instead of
  attempting to complete a live card payment.
- Use the package TanStack Intent skills for implementation guidance:
  setup, tanstack-start, client-api-contract, organization-billing,
  subscriptions-and-transactions, local-subscription-lifecycle, webhooks-and-event-processing,
  schema-and-migrations, and testing-and-fixtures.
`;

export function getOrigin(request: Request) {
  return new URL(request.url).origin;
}

export function absoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

export function getSitemapXml(origin: string) {
  const urls = publicPages
    .map((page) => {
      return `  <url>
    <loc>${absoluteUrl(origin, page.path)}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function getOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Better Auth Flutterwave TanStack Example API",
      version: "1.0.0",
      description: "Discovery metadata for the Better Auth Flutterwave TanStack Start example.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "The example application is available.",
            },
          },
        },
      },
      "/api/auth/{path}": {
        get: {
          summary: "Better Auth endpoint",
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Better Auth response.",
            },
          },
        },
        post: {
          summary: "Better Auth endpoint",
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Better Auth response.",
            },
          },
        },
      },
    },
  };
}

export function getApiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: absoluteUrl(origin, "/api"),
        "service-desc": [
          {
            href: absoluteUrl(origin, "/openapi.json"),
            type: "application/vnd.oai.openapi+json",
          },
        ],
        "service-doc": [
          {
            href: "https://github.com/alexasomba/better-auth-flutterwave#readme",
            type: "text/html",
          },
        ],
        status: [
          {
            href: absoluteUrl(origin, "/api/health"),
            type: "application/json",
          },
        ],
      },
    ],
  };
}

export function getOidcConfiguration(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: absoluteUrl(origin, "/api/auth/sign-in"),
    token_endpoint: absoluteUrl(origin, "/api/auth/token"),
    jwks_uri: absoluteUrl(origin, "/api/auth/jwks"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: ["openid", "profile", "email"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

export function getOAuthProtectedResource(origin: string) {
  return {
    resource: absoluteUrl(origin, "/api"),
    authorization_servers: [origin],
    scopes_supported: ["openid", "profile", "email"],
  };
}

export function getMcpServerCard(origin: string) {
  return {
    serverInfo: {
      name: "better-auth-flutterwave-tanstack-example",
      version: "1.0.0",
    },
    transport: {
      type: "streamable-http",
      endpoint: absoluteUrl(origin, "/mcp"),
    },
    capabilities: {
      tools: {
        listChanged: false,
      },
      resources: {},
      prompts: {},
    },
  };
}

export async function getAgentSkillsIndex(origin: string) {
  const digest = await sha256(flutterwaveSkillMarkdown);

  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "better-auth-flutterwave-demo",
        type: "skill-md",
        description:
          "Inspect the Better Auth Flutterwave TanStack Start demo and its discovery resources.",
        url: absoluteUrl(origin, "/.well-known/agent-skills/better-auth-flutterwave-demo/SKILL.md"),
        digest: `sha256:${digest}`,
      },
    ],
  };
}

export function markdownTokenCount(markdown: string) {
  return markdown.trim().split(/\s+/u).filter(Boolean).length.toString();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
