import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { reschedules, bookings, classes } from "@/db/schema";
import { evaluateReschedule } from "../services/reschedule-service";
import { router, protectedProcedure } from "../trpc";

const rescheduleInput = z.object({
  fromBookingId: z.number(),
  toClassId: z.number(),
});

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(rescheduleInput)
    .mutation(async ({ ctx, input }) => {
      const check = await evaluateReschedule(ctx.db, ctx.user.id, input);
      if (!check.ok) {
        throw new TRPCError(check.rejection);
      }

      const { booking, originalClass, targetClass, targetIsFull } = check;

      return ctx.db.transaction(async (tx) => {
        // Credits already spent carry over to the new booking rather than being
        // refunded and re-charged, so the member is never billed twice for a move.
        const newBooking = await tx
          .insert(bookings)
          .values({
            classId: targetClass.id,
            userId: ctx.user.id,
            membershipId: booking.membershipId,
            status: targetIsFull ? "waitlisted" : "booked",
            creditsUsed: booking.creditsUsed,
          })
          .returning()
          .get();

        await tx
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: new Date().toISOString() })
          .where(eq(bookings.id, booking.id));

        await tx.insert(reschedules).values({
          userId: ctx.user.id,
          fromBookingId: booking.id,
          toBookingId: newBooking.id,
          fromClassId: originalClass.id,
          toClassId: targetClass.id,
        });

        return {
          ok: true,
          newBooking,
          newStatus: targetIsFull ? "waitlisted" : "booked",
        };
      });
    }),

  validateReschedule: protectedProcedure
    .input(rescheduleInput)
    .query(async ({ ctx, input }) => {
      const check = await evaluateReschedule(ctx.db, ctx.user.id, input);
      return check.ok
        ? { valid: true, targetIsFull: check.targetIsFull }
        : { valid: false, reason: check.rejection.message };
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),
});
