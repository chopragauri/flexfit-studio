import { and, eq, inArray, sql } from "drizzle-orm";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/unstable-core-do-not-import";
import { bookings, classes, type Booking, type GymClass } from "@/db/schema";
import { canReschedule, FREE_RESCHEDULE_HOURS } from "@/domain/booking-policy";
import { hoursUntil } from "@/lib/datetime";
import type { DbExecutor } from "@/db";

export type RescheduleRejection = {
  code: TRPC_ERROR_CODE_KEY;
  message: string;
};

export type RescheduleCheck =
  | { ok: false; rejection: RescheduleRejection }
  | {
      ok: true;
      booking: Booking;
      originalClass: GymClass;
      targetClass: GymClass;
      targetIsFull: boolean;
    };

function reject(
  code: TRPC_ERROR_CODE_KEY,
  message: string,
): { ok: false; rejection: RescheduleRejection } {
  return { ok: false, rejection: { code, message } };
}

/**
 * The single source of truth for whether a member may move a booking.
 *
 * Both `reschedules.reschedule` and `reschedules.validateReschedule` run this;
 * the mutation turns a rejection into a TRPCError and the query turns it into a
 * reason string. The order of the checks is part of the contract, because it
 * decides which message a member sees when two conditions fail at once.
 */
export async function evaluateReschedule(
  db: DbExecutor,
  userId: number,
  input: { fromBookingId: number; toClassId: number },
): Promise<RescheduleCheck> {
  const originalRow = await db
    .select({ booking: bookings, cls: classes })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, input.fromBookingId))
    .get();

  if (!originalRow) {
    return reject("NOT_FOUND", "Booking not found.");
  }

  const { booking, cls: originalClass } = originalRow;

  if (booking.userId !== userId) {
    return reject("FORBIDDEN", "You cannot reschedule this booking.");
  }

  if (booking.status !== "booked" && booking.status !== "waitlisted") {
    return reject("BAD_REQUEST", "This booking is no longer active.");
  }

  if (!canReschedule(originalClass.startsAt)) {
    return reject(
      "BAD_REQUEST",
      `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    );
  }

  const targetClass = await db
    .select()
    .from(classes)
    .where(eq(classes.id, input.toClassId))
    .get();

  if (!targetClass) {
    return reject("NOT_FOUND", "Target class not found.");
  }

  if (targetClass.name !== originalClass.name) {
    return reject(
      "BAD_REQUEST",
      "You can only reschedule to a class with the same name.",
    );
  }

  if (targetClass.id === originalClass.id) {
    return reject("BAD_REQUEST", "You are already booked for this class.");
  }

  if (hoursUntil(targetClass.startsAt) <= 0) {
    return reject("BAD_REQUEST", "This class has already started.");
  }

  if (targetClass.cancelled) {
    return reject("BAD_REQUEST", "This class has been cancelled.");
  }

  const existing = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, targetClass.id),
        eq(bookings.userId, userId),
        inArray(bookings.status, ["booked", "waitlisted"]),
      ),
    )
    .get();

  if (existing) {
    return reject(
      "CONFLICT",
      "You already have an active booking for this class.",
    );
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")),
    );

  return {
    ok: true,
    booking,
    originalClass,
    targetClass,
    targetIsFull: Number(count) >= targetClass.capacity,
  };
}
