import type { D1Database } from "@cloudflare/workers-types";
import type { ExampleAuthConfiguration } from "./lib/auth-config";

declare global {
  namespace Cloudflare {
    interface Env extends ExampleAuthConfiguration {
      BILLING_DB?: D1Database;
    }
  }
}
