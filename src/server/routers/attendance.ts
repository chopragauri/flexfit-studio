/** Who turned up, who did not, and which trainers they turned up for. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { bookings, checkins, classes, users } from "@/db/schema";
import { router, adminProcedure } from "../trpc";

const WINDOW_DAYS = 14;

/** `YYYY-MM-DD`, `WINDOW_DAYS` ago — the start of every report on this page. */
function windowStart(): string {
  const start = new Date();
  start.setDate(start.getDate() - WINDOW_DAYS);
  return start.toISOString().slice(0, 10);
}

export const attendanceRouter = router({
  checkinsPerDay: adminProcedure.query(async ({ ctx }) => {
    const day = sql<string>`date(${checkins.checkedInAt})`;

    const rows = await ctx.db
      .select({ date: day, count: sql<number>`count(*)` })
      .from(checkins)
      .where(sql`${day} >= ${windowStart()}`)
      .groupBy(day)
      .orderBy(sql`${day} DESC`);

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }),

  topTrainers: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        trainerId: classes.trainerId,
        trainerName: users.name,
        classCount: sql<number>`count(distinct ${bookings.classId})`,
        attendedCount: sql<number>`count(${bookings.id})`,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(users, eq(classes.trainerId, users.id))
      .where(
        and(
          eq(bookings.status, "attended"),
          sql`date(${classes.startsAt}) >= ${windowStart()}`,
        ),
      )
      .groupBy(classes.trainerId, users.name)
      .orderBy(sql`count(${bookings.id}) DESC`)
      .limit(10);

    return rows.map((row) => ({
      trainerId: row.trainerId,
      trainerName: row.trainerName,
      classCount: Number(row.classCount),
      attendedCount: Number(row.attendedCount),
    }));
  }),

  noShowList: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        bookingId: bookings.id,
        memberId: users.id,
        memberName: users.name,
        memberEmail: users.email,
        className: classes.name,
        classDate: classes.startsAt,
        trainerId: classes.trainerId,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(users, eq(bookings.userId, users.id))
      .where(
        and(
          eq(bookings.status, "no_show"),
          sql`date(${classes.startsAt}) >= ${windowStart()}`,
        ),
      )
      .orderBy(sql`${classes.startsAt} DESC`);

    // The join above is already using `users` for the member, so trainer names
    // are resolved in a second pass rather than a second join onto the same table.
    const trainerIds = [
      ...new Set(rows.map((row) => row.trainerId).filter((id) => id !== null)),
    ];

    const trainerNames = new Map<number, string>();
    if (trainerIds.length > 0) {
      const trainers = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, trainerIds));
      trainers.forEach((trainer) => trainerNames.set(trainer.id, trainer.name));
    }

    return rows.map((row) => ({
      ...row,
      trainerName:
        row.trainerId !== null ? trainerNames.get(row.trainerId) : undefined,
    }));
  }),
});
