import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { classes, trainerAvailability } from "@/db/schema";
import { router, trainerProcedure, staffProcedure } from "../trpc";

const dayOfWeek = z.number().int().min(0).max(6);

export const trainersRouter = router({
  upcomingClasses: trainerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: classes.id,
        name: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        cancelled: classes.cancelled,
      })
      .from(classes)
      .where(
        and(
          eq(classes.trainerId, ctx.user.id),
          gte(classes.startsAt, new Date().toISOString()),
          eq(classes.cancelled, false),
        ),
      )
      .orderBy(classes.startsAt);
  }),

  availability: trainerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(trainerAvailability)
      .where(eq(trainerAvailability.trainerId, ctx.user.id))
      .orderBy(trainerAvailability.dayOfWeek);
  }),

  setAvailability: trainerProcedure
    .input(
      z.object({
        dayOfWeek,
        startTime: z.string(),
        endTime: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // One window per day per trainer: setting a day replaces it.
      const existing = await ctx.db
        .select()
        .from(trainerAvailability)
        .where(
          and(
            eq(trainerAvailability.trainerId, ctx.user.id),
            eq(trainerAvailability.dayOfWeek, input.dayOfWeek),
          ),
        )
        .get();

      if (existing) {
        return ctx.db
          .update(trainerAvailability)
          .set({ startTime: input.startTime, endTime: input.endTime })
          .where(eq(trainerAvailability.id, existing.id))
          .returning()
          .get();
      }

      return ctx.db
        .insert(trainerAvailability)
        .values({
          trainerId: ctx.user.id,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        })
        .returning()
        .get();
    }),

  removeAvailability: trainerProcedure
    .input(z.object({ dayOfWeek }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(trainerAvailability)
        .where(
          and(
            eq(trainerAvailability.trainerId, ctx.user.id),
            eq(trainerAvailability.dayOfWeek, input.dayOfWeek),
          ),
        );

      return { success: true };
    }),

  /** Asked about someone else's trainer, so this one is staff-wide. */
  checkAvailability: staffProcedure
    .input(
      z.object({
        trainerId: z.number(),
        startsAt: z.string(),
        durationMin: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const classStart = new Date(input.startsAt);
      const classEnd = new Date(
        classStart.getTime() + input.durationMin * 60000,
      );

      const availability = await ctx.db
        .select()
        .from(trainerAvailability)
        .where(
          and(
            eq(trainerAvailability.trainerId, input.trainerId),
            eq(trainerAvailability.dayOfWeek, classStart.getUTCDay()),
          ),
        )
        .get();

      if (!availability) {
        return { available: false, reason: "No availability set for this day" };
      }

      const startsWithin = utcClockTime(classStart) >= availability.startTime;
      const endsWithin = utcClockTime(classEnd) <= availability.endTime;
      if (!startsWithin || !endsWithin) {
        return { available: false, reason: "Outside availability hours" };
      }

      const trainerClasses = await ctx.db
        .select()
        .from(classes)
        .where(
          and(
            eq(classes.trainerId, input.trainerId),
            eq(classes.cancelled, false),
          ),
        );

      const clashes = trainerClasses.some((cls) => {
        const existingStart = new Date(cls.startsAt);
        const existingEnd = new Date(
          existingStart.getTime() + cls.durationMin * 60000,
        );
        return classStart < existingEnd && classEnd > existingStart;
      });

      if (clashes) {
        return {
          available: false,
          reason: "Trainer already has a class at this time",
        };
      }

      return { available: true };
    }),
});

/** `HH:MM` in UTC, matching how availability windows are stored. */
function utcClockTime(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
