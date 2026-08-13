import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { BOOKING_STATUSES } from "./bookings";
import { classes } from "./classes";
import { users } from "./users";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull(),
  creditPoolBalance: integer("credit_pool_balance").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const companyMembers = sqliteTable(
  "company_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("company_members_user_idx").on(table.userId),
    index("company_members_company_idx").on(table.companyId),
  ],
);

/**
 * Corporate seats live in their own table rather than as a flag on `bookings`.
 * The consequence — a class fills to capacity on each side independently — is
 * documented in docs/refactoring-decisions.md, preserved behaviour #1.
 */
export const corporateBookings = sqliteTable(
  "corporate_bookings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    status: text("status", { enum: BOOKING_STATUSES })
      .notNull()
      .default("booked"),
    creditsUsed: integer("credits_used").notNull().default(0),
    bookedAt: text("booked_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    cancelledAt: text("cancelled_at"),
  },
  (table) => [
    index("corporate_bookings_class_status_idx").on(table.classId, table.status),
    index("corporate_bookings_company_idx").on(table.companyId),
  ],
);

export type Company = typeof companies.$inferSelect;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CorporateBooking = typeof corporateBookings.$inferSelect;
