import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { memberships } from "./memberships";
import { users } from "./users";

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: integer("membership_id").references(() => memberships.id),
    amountCents: integer("amount_cents").notNull(),
    method: text("method", {
      enum: ["card", "cash", "upi", "transfer"],
    }).notNull(),
    status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
      .notNull()
      .default("pending"),
    reference: text("reference"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Every revenue report groups paid rows; the member view filters by user.
    index("payments_status_idx").on(table.status),
    index("payments_user_idx").on(table.userId),
  ],
);

export type Payment = typeof payments.$inferSelect;
