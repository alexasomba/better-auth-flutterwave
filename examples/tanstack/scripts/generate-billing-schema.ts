import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createExampleAuthOptions } from "../src/lib/auth-config";

const database = new DatabaseSync(":memory:");
try {
  const { authOptions } = createExampleAuthOptions(database, {
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "local-schema-generation-secret-do-not-use-in-production",
    FLUTTERWAVE_PUBLIC_KEY: "schema-only-public-key",
    FLUTTERWAVE_SECRET_KEY: "schema-only-secret-key",
    FLUTTERWAVE_SECRET_HASH: "schema-only-hash",
  });
  const migration = await getMigrations(authOptions);
  const sql = `-- Generated from the installed Better Auth and Flutterwave plugin schemas.\n${await migration.compileMigrations()}\n`;
  const target = new URL("../migrations/0001_billing.sql", import.meta.url);
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== sql)
      throw new Error("Billing migration differs from current schemas");
  } else {
    await writeFile(target, sql);
  }
} finally {
  database.close();
}
