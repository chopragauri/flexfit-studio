import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

/**
 * Only `announcement` is produced at runtime; the other three exist in the
 * schema and the seed. See docs/refactoring-decisions.md, preserved behaviour #8.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type", {
      enum: [
        "waitlist_promotion",
        "class_cancelled",
        "membership_expiring",
        "announcement",
      ],
    }).notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("notifications_user_read_idx").on(table.userId, table.read)],
);

export type Notification = typeof notifications.$inferSelect;
