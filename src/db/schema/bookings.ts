import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { classes } from "./classes";
import { memberships } from "./memberships";
import { users } from "./users";

/** Shared by both booking tables; the two must stay in step. */
export const BOOKING_STATUSES = [
  "booked",
  "cancelled",
  "attended",
  "no_show",
  "waitlisted",
] as const;

export const bookings = sqliteTable(
  "bookings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: integer("membership_id").references(() => memberships.id),
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
    // Counting confirmed seats and walking the waitlist both filter on these.
    index("bookings_class_status_idx").on(table.classId, table.status),
    index("bookings_user_idx").on(table.userId),
  ],
);

export const checkins = sqliteTable(
  "checkins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    bookingId: integer("booking_id").references(() => bookings.id),
    checkedInAt: text("checked_in_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    source: text("source", { enum: ["front_desk", "kiosk", "app"] })
      .notNull()
      .default("front_desk"),
  },
  (table) => [index("checkins_booking_idx").on(table.bookingId)],
);

export const reschedules = sqliteTable(
  "reschedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    fromBookingId: integer("from_booking_id")
      .notNull()
      .references(() => bookings.id),
    toBookingId: integer("to_booking_id")
      .notNull()
      .references(() => bookings.id),
    fromClassId: integer("from_class_id")
      .notNull()
      .references(() => classes.id),
    toClassId: integer("to_class_id")
      .notNull()
      .references(() => classes.id),
    rescheduledAt: text("rescheduled_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("reschedules_user_idx").on(table.userId)],
);

export type Booking = typeof bookings.$inferSelect;
export type Checkin = typeof checkins.$inferSelect;
export type Reschedule = typeof reschedules.$inferSelect;
