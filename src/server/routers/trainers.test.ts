import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, checkins, trainerAvailability } from "@/db/schema";
import {
  caller,
  createTestDb,
  hoursFromNow,
  makeClass,
  makeMemberWithMembership,
  makeUser,
} from "@/test/harness";

const { db, destroy } = createTestDb();
afterAll(destroy);

beforeEach(async () => {
  await db.delete(checkins);
  await db.delete(bookings);
  await db.delete(trainerAvailability);
});

describe("trainers.upcomingClasses", () => {
  it("returns roster and check-in counts alongside each class", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const staff = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db, {
      trainerId: trainer.id,
      capacity: 5,
      startsAt: hoursFromNow(48),
    });

    const first = await makeMemberWithMembership(db);
    const second = await makeMemberWithMembership(db);
    const booking = await caller(db, first.user).bookings.book({
      classId: cls.id,
    });
    await caller(db, second.user).bookings.book({ classId: cls.id });
    await caller(db, staff).bookings.markAttended({ bookingId: booking.id });

    const [row] = await caller(db, trainer).trainers.upcomingClasses();

    // One booked, one attended: both count towards the roster.
    expect(row.bookedCount).toBe(2);
    expect(row.checkinCount).toBe(1);
  });

  it("counts nothing for a class with no bookings", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await makeClass(db, { trainerId: trainer.id, startsAt: hoursFromNow(24) });

    const [row] = await caller(db, trainer).trainers.upcomingClasses();

    expect(row.bookedCount).toBe(0);
    expect(row.checkinCount).toBe(0);
  });

  it("excludes cancelled and past classes", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await makeClass(db, {
      trainerId: trainer.id,
      startsAt: hoursFromNow(24),
      cancelled: true,
    });
    await makeClass(db, { trainerId: trainer.id, startsAt: hoursFromNow(-24) });
    const live = await makeClass(db, {
      trainerId: trainer.id,
      startsAt: hoursFromNow(24),
    });

    const rows = await caller(db, trainer).trainers.upcomingClasses();

    expect(rows.map((row) => row.id)).toEqual([live.id]);
  });

  it("shows a trainer only their own classes", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const other = await makeUser(db, { role: "trainer" });
    await makeClass(db, { trainerId: other.id, startsAt: hoursFromNow(24) });

    await expect(
      caller(db, trainer).trainers.upcomingClasses(),
    ).resolves.toEqual([]);
  });
});

describe("trainers.setAvailability", () => {
  it("replaces the window for a day rather than adding a second one", async () => {
    const trainer = await makeUser(db, { role: "trainer" });

    await caller(db, trainer).trainers.setAvailability({
      dayOfWeek: 2,
      startTime: "06:00",
      endTime: "12:00",
    });
    await caller(db, trainer).trainers.setAvailability({
      dayOfWeek: 2,
      startTime: "08:00",
      endTime: "16:00",
    });

    const rows = await caller(db, trainer).trainers.availability();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startTime: "08:00", endTime: "16:00" });
  });

  it("removes a day, and removing an unset day is not an error", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await caller(db, trainer).trainers.setAvailability({
      dayOfWeek: 3,
      startTime: "09:00",
      endTime: "17:00",
    });

    await expect(
      caller(db, trainer).trainers.removeAvailability({ dayOfWeek: 3 }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller(db, trainer).trainers.removeAvailability({ dayOfWeek: 3 }),
    ).resolves.toEqual({ success: true });
    await expect(caller(db, trainer).trainers.availability()).resolves.toEqual(
      [],
    );
  });
});

describe("trainers.checkAvailability", () => {
  it("reports the reason a slot does not work", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const admin = await makeUser(db, { role: "admin" });
    const slot = new Date("2026-08-19T10:00:00.000Z").toISOString();

    await expect(
      caller(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: slot,
        durationMin: 60,
      }),
    ).resolves.toEqual({
      available: false,
      reason: "No availability set for this day",
    });

    // 2026-08-19 is a Wednesday (day 3).
    await caller(db, trainer).trainers.setAvailability({
      dayOfWeek: 3,
      startTime: "09:00",
      endTime: "12:00",
    });

    await expect(
      caller(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: slot,
        durationMin: 60,
      }),
    ).resolves.toEqual({ available: true });

    await expect(
      caller(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: slot,
        durationMin: 240,
      }),
    ).resolves.toEqual({
      available: false,
      reason: "Outside availability hours",
    });
  });

  it("detects a clash with a class the trainer already has", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const admin = await makeUser(db, { role: "admin" });
    const slot = new Date("2026-08-19T10:00:00.000Z").toISOString();

    await caller(db, trainer).trainers.setAvailability({
      dayOfWeek: 3,
      startTime: "09:00",
      endTime: "18:00",
    });
    await makeClass(db, {
      trainerId: trainer.id,
      startsAt: new Date("2026-08-19T10:30:00.000Z").toISOString(),
      durationMin: 60,
    });

    await expect(
      caller(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: slot,
        durationMin: 60,
      }),
    ).resolves.toEqual({
      available: false,
      reason: "Trainer already has a class at this time",
    });
  });
});
