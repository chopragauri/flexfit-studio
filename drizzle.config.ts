import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "turso",
  // Mirrors src/db/index.ts so `drizzle-kit push` and the app always agree on
  // which file they are talking to. The test harness sets DB_FILE.
  dbCredentials: {
    url: process.env.DB_FILE ?? "file:flexfit.db",
  },
} satisfies Config;
