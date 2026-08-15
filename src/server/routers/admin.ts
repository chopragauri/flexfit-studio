/** The admin landing page: headline counters and how full classes are running. */
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  users,
  memberships,
  classes,
  bookings,
  payments,
  checkins,
} from "@/db/schema";
import { today } from "@/lib/datetime";
import { router, adminProcedure } from "../trpc";

export const adminRouter = router({
  stats: adminProcedure.query(async ({ ctx }) => {
    const now = new Date().toISOString();

    const [{ totalMembers }] = await ctx.db
      .select({ totalMembers: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "member"));

    const [{ activeMemberships }] = await ctx.db
      .select({ activeMemberships: sql<number>`count(*)` })
      .from(memberships)
      .where(
        and(
          eq(memberships.status, "active"),
          gte(memberships.endDate, today()),
        ),
      );

    const [{ upcomingClasses }] = await ctx.db
      .select({ upcomingClasses: sql<number>`count(*)` })
      .from(classes)
      .where(and(gte(classes.startsAt, now), eq(classes.cancelled, false)));

    const [{ revenueCents }] = await ctx.db
      .select({
        revenueCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"));

    const [{ totalCheckins }] = await ctx.db
      .select({ totalCheckins: sql<number>`count(*)` })
      .from(checkins);

    const [{ pendingPayments }] = await ctx.db
      .select({ pendingPayments: sql<number>`count(*)` })
      .from(payments)
      .where(eq(payments.status, "pending"));

    return {
      totalMembers: Number(totalMembers),
      activeMemberships: Number(activeMemberships),
      upcomingClasses: Number(upcomingClasses),
      revenueCents: Number(revenueCents),
      totalCheckins: Number(totalCheckins),
      pendingPayments: Number(pendingPayments),
    };
  }),

  classUtilisation: adminProcedure
    .input(z.object({ limit: z.number().default(10) }).default({}))
    .query(async ({ ctx, input }) => {
      // No ORDER BY: which classes appear is whatever SQLite returns first.
      // Preserved deliberately — see docs/refactoring-decisions.md, #11.
      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          startsAt: classes.startsAt,
          capacity: classes.capacity,
          // `classes.id` is written out rather than interpolated: in a
          // single-table select Drizzle renders columns unqualified, so a bare
          // `id` here would bind to `bookings` and compare it against
          // `class_id`. classes.list avoids this only because its leftJoin
          // makes Drizzle qualify everything.
          booked: sql<number>`(
            select count(*) from ${bookings}
            where ${bookings.classId} = classes.id
              and ${bookings.status} in ('booked','attended')
          )`.as("booked"),
        })
        .from(classes)
        .where(eq(classes.cancelled, false))
        .limit(input.limit);

      return rows.map((row) => ({
        ...row,
        booked: Number(row.booked),
        utilisation: row.capacity ? Number(row.booked) / row.capacity : 0,
      }));
    }),
});
