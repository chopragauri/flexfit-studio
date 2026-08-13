import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof createClient> | undefined;
};

const client =
  globalForDb.client ??
  createClient({ url: process.env.DB_FILE ?? "file:flexfit.db" });

if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });
export { schema };

/**
 * Services take the database as a parameter rather than importing the singleton,
 * so tests can hand them a throwaway file database.
 */
export type Database = typeof db;

/** The handle inside `db.transaction(...)`. */
export type Transaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * Anything that can run a statement. Service functions take this so the same
 * code works inside and outside a transaction.
 */
export type DbExecutor = Database | Transaction;
