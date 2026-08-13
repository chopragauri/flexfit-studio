/**
 * The booking sequence, shared by personal and corporate bookings.
 *
 * The two flows write to different tables and draw on different credit
 * accounts, but the sequence — validate the class, reject duplicates, check
 * affordability, take the last seat or join the queue, charge — is identical,
 * as is every error message. A BookingFlow supplies the parts that genuinely
 * differ; everything else lives here once.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  bookings,
  checkins,
  classes,
  corporateBookings,
  type GymClass,
  type User,
} from "@/db/schema";
import { classIsOpen, isRefundable } from "@/domain/booking-policy";
import type { Database, DbExecutor } from "@/db";
import type { CreditSource } from "./credit-sources";

/** The two booking tables share every column this module reads. */
type BookingTable = typeof bookings | typeof corporateBookings;

/**
 * `status`, `creditsUsed` and `cancelledAt` are declared identically on both
 * booking tables, but TypeScript cannot prove that through a generic table
 * parameter. The shared status writes below narrow through this one point
 * rather than scattering casts.
 */
function statusColumns(table: BookingTable): typeof bookings {
  return table as typeof bookings;
}

type NewBooking = {
  classId: number;
  userId: number;
  accountId: number;
  status: "booked" | "waitlisted";
  creditsUsed: number;
};

export interface BookingFlow<TTable extends BookingTable> {
  readonly table: TTable;
  readonly creditSource: CreditSource;
  /** Writes the row, including whichever account column this flow owns. */
  insert(db: DbExecutor, values: NewBooking): Promise<TTable["$inferSelect"]>;
  /** Reads that account back off a stored row. */
  accountIdOf(booking: TTable["$inferSelect"]): number | null;
  /** How this flow records a check-in. Corporate deliberately records less. */
  writeCheckin(
    db: DbExecutor,
    booking: TTable["$inferSelect"],
    source: CheckinSource,
  ): Promise<void>;
}

export type CheckinSource = "front_desk" | "kiosk" | "app";

export function personalBookingFlow(
  creditSource: CreditSource,
): BookingFlow<typeof bookings> {
  return {
    table: bookings,
    creditSource,

    insert: (db, values) =>
      db
        .insert(bookings)
        .values({
          classId: values.classId,
          userId: values.userId,
          membershipId: values.accountId,
          status: values.status,
          creditsUsed: values.creditsUsed,
        })
        .returning()
        .get(),

    accountIdOf: (booking) => booking.membershipId,

    writeCheckin: async (db, booking, source) => {
      await db.insert(checkins).values({
        userId: booking.userId,
        bookingId: booking.id,
        source,
      });
    },
  };
}

export function corporateBookingFlow(
  creditSource: CreditSource,
): BookingFlow<typeof corporateBookings> {
  return {
    table: corporateBookings,
    creditSource,

    insert: (db, values) =>
      db
        .insert(corporateBookings)
        .values({
          classId: values.classId,
          userId: values.userId,
          companyId: values.accountId,
          status: values.status,
          creditsUsed: values.creditsUsed,
        })
        .returning()
        .get(),

    accountIdOf: (booking) => booking.companyId,

    // Corporate check-ins record neither the booking link nor the requested
    // source; see docs/refactoring-decisions.md, preserved behaviour #8.
    writeCheckin: async (db, booking) => {
      await db.insert(checkins).values({
        userId: booking.userId,
        bookingId: null,
      });
    },
  };
}

async function requireOpenClass(
  db: DbExecutor,
  classId: number,
): Promise<GymClass> {
  const cls = await db
    .select()
    .from(classes)
    .where(eq(classes.id, classId))
    .get();

  if (!cls) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
  }

  const open = classIsOpen(cls);
  if (!open.open) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        open.reason === "cancelled"
          ? "This class has been cancelled."
          : "This class has already started.",
    });
  }

  return cls;
}

/**
 * Seats taken on this side of the class. Personal and corporate seats are
 * counted against capacity separately, which is why a class can hold twice its
 * capacity — see docs/refactoring-decisions.md, preserved behaviour #1.
 */
async function countConfirmed(
  db: DbExecutor,
  table: BookingTable,
  classId: number,
): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(and(eq(table.classId, classId), eq(table.status, "booked")));
  return Number(count);
}

export async function book<TTable extends BookingTable>(
  db: Database,
  flow: BookingFlow<TTable>,
  userId: number,
  classId: number,
): Promise<TTable["$inferSelect"]> {
  const cls = await requireOpenClass(db, classId);
  const { table, creditSource } = flow;

  const existing = await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.classId, cls.id),
        eq(table.userId, userId),
        inArray(table.status, ["booked", "waitlisted"]),
      ),
    )
    .get();

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "You are already on the list for this class.",
    });
  }

  const account = await creditSource.resolve(db, userId);
  if (!account) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: creditSource.missingAccountMessage,
    });
  }

  if (!creditSource.canAfford(account, cls.creditCost)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: creditSource.insufficientCreditsMessage,
    });
  }

  const isFull = (await countConfirmed(db, table, cls.id)) >= cls.capacity;

  return db.transaction(async (tx) => {
    const created = await flow.insert(tx, {
      classId: cls.id,
      userId,
      accountId: account.id,
      status: isFull ? "waitlisted" : "booked",
      // A queued seat costs nothing until it is promoted.
      creditsUsed: isFull ? 0 : cls.creditCost,
    });

    if (!isFull) {
      await creditSource.debitForBooking(tx, account, cls.creditCost);
    }

    return created;
  });
}

export async function cancel<TTable extends BookingTable>(
  db: Database,
  flow: BookingFlow<TTable>,
  user: User,
  bookingId: number,
): Promise<{ ok: true; refunded: boolean }> {
  const { table, creditSource } = flow;

  const booking = (await db
    .select()
    .from(table)
    .where(eq(table.id, bookingId))
    .get()) as TTable["$inferSelect"] | undefined;

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }

  const cls = await db
    .select()
    .from(classes)
    .where(eq(classes.id, booking.classId))
    .get();

  if (!cls) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }

  const isOwner = booking.userId === user.id;
  const isStaff = user.role === "admin" || user.role === "trainer";
  if (!isOwner && !isStaff) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot cancel this booking.",
    });
  }

  if (booking.status !== "booked" && booking.status !== "waitlisted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This booking is no longer active.",
    });
  }

  const refundable = isRefundable(
    cls.startsAt,
    booking.creditsUsed,
    creditSource.freeCancellationHours,
  );

  return db.transaction(async (tx) => {
    await tx
      .update(statusColumns(table))
      .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
      .where(eq(table.id, booking.id));

    if (refundable) {
      await creditSource.refund(
        tx,
        flow.accountIdOf(booking),
        booking.creditsUsed,
      );
    }

    // Only a confirmed seat frees space; leaving the queue promotes nobody.
    if (booking.status === "booked") {
      await promoteNextInLine(tx, flow, cls);
    }

    return { ok: true as const, refunded: refundable };
  });
}

async function promoteNextInLine<TTable extends BookingTable>(
  db: DbExecutor,
  flow: BookingFlow<TTable>,
  cls: GymClass,
): Promise<void> {
  const { table, creditSource } = flow;

  const next = (await db
    .select()
    .from(table)
    .where(and(eq(table.classId, cls.id), eq(table.status, "waitlisted")))
    .orderBy(asc(table.bookedAt))
    .get()) as TTable["$inferSelect"] | undefined;

  if (!next) return;

  await db
    .update(statusColumns(table))
    .set({ status: "booked", creditsUsed: cls.creditCost })
    .where(eq(table.id, next.id));

  await creditSource.debitForPromotion(
    db,
    flow.accountIdOf(next),
    cls.creditCost,
  );
}

export async function markAttended<TTable extends BookingTable>(
  db: Database,
  flow: BookingFlow<TTable>,
  bookingId: number,
  source: CheckinSource,
): Promise<{ ok: true }> {
  const { table } = flow;

  const booking = (await db
    .select()
    .from(table)
    .where(eq(table.id, bookingId))
    .get()) as TTable["$inferSelect"] | undefined;

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }
  if (booking.status !== "booked") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only confirmed bookings can be checked in.",
    });
  }

  return db.transaction(async (tx) => {
    await tx
      .update(statusColumns(table))
      .set({ status: "attended" })
      .where(eq(table.id, booking.id));

    await flow.writeCheckin(tx, booking, source);

    return { ok: true as const };
  });
}
