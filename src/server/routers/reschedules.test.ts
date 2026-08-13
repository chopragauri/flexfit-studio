import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, memberships, reschedules } from "@/db/schema";
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
  await db.delete(reschedules);
  await db.delete(bookings);
});

/**
 * The mutation throws and the query returns a reason, but they apply the same
 * rules in the same order. Every rejection below asserts both forms, so a
 * change to one that misses the other fails here.
 */
describe("reschedules.reschedule", () => {
  it("moves the booking, carries the credits over and records the move", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const from = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(24),
      creditCost: 3,
    });
    const to = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(48),
      creditCost: 3,
    });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    const result = await caller(db, user).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.newStatus).toBe("booked");
    expect(result.newBooking.classId).toBe(to.id);
    expect(result.newBooking.creditsUsed).toBe(3);

    const original = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id))
      .get();
    expect(original!.status).toBe("cancelled");
    expect(original!.cancelledAt).not.toBeNull();

    // Credits are carried, not refunded and re-charged: 10 - 3 and no more.
    const balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(7);

    const trail = await db.select().from(reschedules).all();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      userId: user.id,
      fromBookingId: booking.id,
      toBookingId: result.newBooking.id,
      fromClassId: from.id,
      toClassId: to.id,
    });
  });

  it("waitlists into a full target class", async () => {
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(48),
      capacity: 1,
    });
    const mover = await makeMemberWithMembership(db);
    const blocker = await makeMemberWithMembership(db);

    const booking = await caller(db, mover.user).bookings.book({
      classId: from.id,
    });
    await caller(db, blocker.user).bookings.book({ classId: to.id });

    const result = await caller(db, mover.user).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.newStatus).toBe("waitlisted");
  });

  it("rejects an unknown booking", async () => {
    const { user } = await makeMemberWithMembership(db);
    const to = await makeClass(db);

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: 999999,
        toClassId: to.id,
      }),
    ).rejects.toThrow("Booking not found.");

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: 999999,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: false, reason: "Booking not found." });
  });

  it("rejects a booking owned by someone else", async () => {
    const { user } = await makeMemberWithMembership(db);
    const stranger = await makeUser(db);
    const from = await makeClass(db, { name: "Spin 45" });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    await expect(
      caller(db, stranger).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow("You cannot reschedule this booking.");

    await expect(
      caller(db, stranger).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: "You cannot reschedule this booking.",
    });
  });

  it("rejects a booking that is no longer active", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45" });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });
    await caller(db, user).bookings.cancel({ bookingId: booking.id });

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow("This booking is no longer active.");

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: "This booking is no longer active.",
    });
  });

  it("rejects a move inside the 4 hour window", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(3) });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    const message =
      "You can only reschedule up to 4 hours before the class starts.";

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow(message);

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: false, reason: message });
  });

  it("allows a move just outside the 4 hour window", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(5) });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: true, targetIsFull: false });
  });

  it("rejects an unknown target class", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45" });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: 999999,
      }),
    ).rejects.toThrow("Target class not found.");

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: 999999,
      }),
    ).resolves.toEqual({ valid: false, reason: "Target class not found." });
  });

  it("rejects a target class with a different name", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45" });
    const to = await makeClass(db, { name: "Sunrise Yoga", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    const message = "You can only reschedule to a class with the same name.";

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow(message);

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: false, reason: message });
  });

  it("rejects rescheduling onto the same class", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45" });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    const message = "You are already booked for this class.";

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: from.id,
      }),
    ).rejects.toThrow(message);

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: from.id,
      }),
    ).resolves.toEqual({ valid: false, reason: message });
  });

  it("rejects a target class that has already started", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(-2) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow("This class has already started.");

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: "This class has already started.",
    });
  });

  it("rejects a cancelled target class", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(72),
      cancelled: true,
    });
    const booking = await caller(db, user).bookings.book({ classId: from.id });

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow("This class has been cancelled.");

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: "This class has been cancelled.",
    });
  });

  it("rejects a target class the member already holds a booking for", async () => {
    const { user } = await makeMemberWithMembership(db, {
      creditsRemaining: 999,
    });
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });
    await caller(db, user).bookings.book({ classId: to.id });

    const message = "You already have an active booking for this class.";

    await expect(
      caller(db, user).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).rejects.toThrow(message);

    await expect(
      caller(db, user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: false, reason: message });
  });

  it("reports targetIsFull without blocking the move", async () => {
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(72),
      capacity: 1,
    });
    const mover = await makeMemberWithMembership(db);
    const blocker = await makeMemberWithMembership(db);
    const booking = await caller(db, mover.user).bookings.book({
      classId: from.id,
    });
    await caller(db, blocker.user).bookings.book({ classId: to.id });

    await expect(
      caller(db, mover.user).reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).resolves.toEqual({ valid: true, targetIsFull: true });
  });

  it("QUIRK: a reschedule into a full class carries credits onto the waitlist, and promotion charges again", async () => {
    const from = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(24),
      creditCost: 2,
    });
    const to = await makeClass(db, {
      name: "Spin 45",
      startsAt: hoursFromNow(72),
      capacity: 1,
      creditCost: 2,
    });
    const mover = await makeMemberWithMembership(db, { creditsRemaining: 10 });
    const blocker = await makeMemberWithMembership(db);

    const booking = await caller(db, mover.user).bookings.book({
      classId: from.id,
    });
    const held = await caller(db, blocker.user).bookings.book({
      classId: to.id,
    });

    const moved = await caller(db, mover.user).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    // A normal waitlist entry carries creditsUsed 0; this one carries 2.
    expect(moved.newStatus).toBe("waitlisted");
    expect(moved.newBooking.creditsUsed).toBe(2);

    let balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, mover.membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(8);

    // Freeing the spot promotes the mover and debits a second time.
    await caller(db, blocker.user).bookings.cancel({ bookingId: held.id });

    balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, mover.membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(6);
  });
});

describe("reschedules.history", () => {
  it("returns the member's own moves with both class descriptions", async () => {
    const { user } = await makeMemberWithMembership(db);
    const from = await makeClass(db, {
      name: "Spin 45",
      room: "Spin Room",
      startsAt: hoursFromNow(24),
    });
    const to = await makeClass(db, {
      name: "Spin 45",
      room: "Studio B",
      startsAt: hoursFromNow(72),
    });
    const booking = await caller(db, user).bookings.book({ classId: from.id });
    await caller(db, user).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    const history = await caller(db, user).reschedules.history();

    expect(history).toHaveLength(1);
    expect(history[0].fromClassName).toBe("Spin 45");
    expect(history[0].fromClassRoom).toBe("Spin Room");
    expect(history[0].toClassRoom).toBe("Studio B");
  });

  it("does not leak another member's history", async () => {
    const { user } = await makeMemberWithMembership(db);
    const other = await makeUser(db);
    const from = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(24) });
    const to = await makeClass(db, { name: "Spin 45", startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: from.id });
    await caller(db, user).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    await expect(caller(db, other).reschedules.history()).resolves.toEqual([]);
  });
});
