import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

const config = defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    tsconfigPaths: true,
  },
  ssr: {
    noExternal: ["better-auth-flutterwave"],
  },
  plugins: [
    devtools(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      configPath:
        process.env.BILLING_PERSISTENT === "1" ? "wrangler.billing.jsonc" : "wrangler.jsonc",
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  lint: {
    jsPlugins: [
      { name: "@tanstack/query", specifier: "@tanstack/eslint-plugin-query" },
      { name: "@tanstack/router", specifier: "@tanstack/eslint-plugin-router" },
    ],
    rules: {
      "@tanstack/query/exhaustive-deps": "error",
      "@tanstack/query/no-rest-destructuring": "warn",
      "@tanstack/query/stable-query-client": "error",
      "@tanstack/query/no-unstable-deps": "error",
      "@tanstack/query/infinite-query-property-order": "error",
      "@tanstack/query/no-void-query-fn": "error",
      "@tanstack/query/mutation-property-order": "error",
      "@tanstack/router/create-route-property-order": "warn",
      "@tanstack/router/route-param-names": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    env: {
      builtin: true,
    },
  },
});

export default config;
