import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { bookings, classes, checkins, users } from "@/db/schema";
import {
  book,
  cancel,
  markAttended,
  personalBookingFlow,
} from "../services/booking-service";
import { membershipCredits } from "../services/credit-sources";
import { router, protectedProcedure, staffProcedure } from "../trpc";

const flow = personalBookingFlow(membershipCredits);

const checkinSource = z.enum(["front_desk", "kiosk", "app"]);

export const bookingsRouter = router({
  mine: protectedProcedure
    .input(z.object({ includePast: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: bookings.id,
          status: bookings.status,
          creditsUsed: bookings.creditsUsed,
          bookedAt: bookings.bookedAt,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          cancelled: classes.cancelled,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.userId, ctx.user.id))
        .orderBy(asc(classes.startsAt));

      const now = new Date();
      return rows.filter((r) =>
        input.includePast ? true : new Date(r.startsAt) >= now,
      );
    }),

  book: protectedProcedure
    .input(z.object({ classId: z.number() }))
    .mutation(({ ctx, input }) =>
      book(ctx.db, flow, ctx.user.id, input.classId),
    ),

  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(({ ctx, input }) =>
      cancel(ctx.db, flow, ctx.user, input.bookingId),
    ),

  markAttended: staffProcedure
    .input(
      z.object({
        bookingId: z.number(),
        source: checkinSource.default("front_desk"),
      }),
    )
    .mutation(({ ctx, input }) =>
      markAttended(ctx.db, flow, input.bookingId, input.source),
    ),

  rosterFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: bookings.bookedAt,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, input.classId))
        .orderBy(asc(bookings.bookedAt));
    }),

  upcomingForMember: staffProcedure
    .input(z.object({ userId: z.number(), hoursAhead: z.number().default(2) }))
    .query(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const futureTime = new Date(
        Date.now() + input.hoursAhead * 60 * 60 * 1000,
      ).toISOString();

      return ctx.db
        .select({
          bookingId: bookings.id,
          bookingStatus: bookings.status,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          capacity: classes.capacity,
          trainerId: classes.trainerId,
          trainerName: users.name,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(
          and(
            eq(bookings.userId, input.userId),
            eq(bookings.status, "booked"),
            sql`${classes.startsAt} >= ${now}`,
            sql`${classes.startsAt} <= ${futureTime}`,
            eq(classes.cancelled, false),
          ),
        )
        .orderBy(classes.startsAt);
    }),

  checkinCountFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(checkins)
        .innerJoin(bookings, eq(checkins.bookingId, bookings.id))
        .where(eq(bookings.classId, input.classId));

      return { count: Number(result?.count ?? 0) };
    }),

  waitlisted: protectedProcedure.query(async ({ ctx }) => {
    // Queue position is "how many joined this class's waitlist before me",
    // resolved for every row in one correlated subquery rather than one query
    // per booking.
    const rows = await ctx.db
      .select({
        bookingId: bookings.id,
        classId: classes.id,
        className: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        capacity: classes.capacity,
        bookedAt: bookings.bookedAt,
        ahead: sql<number>`(
          select count(*) from ${bookings} as queue
          where queue.class_id = ${bookings.classId}
            and queue.status = 'waitlisted'
            and queue.booked_at < ${bookings.bookedAt}
        )`,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          eq(bookings.userId, ctx.user.id),
          eq(bookings.status, "waitlisted"),
        ),
      )
      .orderBy(asc(classes.startsAt));

    return rows.map(({ ahead, ...row }) => ({
      ...row,
      position: Number(ahead) + 1,
    }));
  }),
});
