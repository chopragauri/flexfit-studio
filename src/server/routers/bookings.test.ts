import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, memberships } from "@/db/schema";
import {
  caller,
  createTestDb,
  hoursFromNow,
  daysFromNow,
  makeClass,
  makeMemberWithMembership,
  makeUser,
  type TestDb,
} from "@/test/harness";

const { db, destroy } = createTestDb();
afterAll(destroy);

async function reset(database: TestDb) {
  await database.delete(bookings);
}

beforeEach(() => reset(db));

describe("bookings.book", () => {
  it("confirms a booking and debits the credit cost", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const cls = await makeClass(db, { creditCost: 3 });

    const created = await caller(db, user).bookings.book({ classId: cls.id });

    expect(created.status).toBe("booked");
    expect(created.creditsUsed).toBe(3);
    expect(created.membershipId).toBe(membership.id);

    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(7);
  });

  it("rejects a member with no membership", async () => {
    const user = await makeUser(db);
    const cls = await makeClass(db);

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("An active membership is required to book classes.");
  });

  it("rejects a membership that has already ended", async () => {
    const { user } = await makeMemberWithMembership(db, {
      startDate: daysFromNow(-60),
      endDate: daysFromNow(-1),
    });
    const cls = await makeClass(db);

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("An active membership is required to book classes.");
  });

  it("rejects when the membership cannot cover the credit cost", async () => {
    const { user } = await makeMemberWithMembership(db, { creditsRemaining: 1 });
    const cls = await makeClass(db, { creditCost: 2 });

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("Not enough class credits remaining.");
  });

  it("rejects a cancelled class", async () => {
    const { user } = await makeMemberWithMembership(db);
    const cls = await makeClass(db, { cancelled: true });

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("This class has been cancelled.");
  });

  it("rejects a class that has already started", async () => {
    const { user } = await makeMemberWithMembership(db);
    const cls = await makeClass(db, { startsAt: hoursFromNow(-1) });

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("This class has already started.");
  });

  it("rejects an unknown class", async () => {
    const { user } = await makeMemberWithMembership(db);

    await expect(
      caller(db, user).bookings.book({ classId: 999999 }),
    ).rejects.toThrow("Class not found.");
  });

  it("rejects a second booking for the same class", async () => {
    const { user } = await makeMemberWithMembership(db);
    const cls = await makeClass(db);
    await caller(db, user).bookings.book({ classId: cls.id });

    await expect(
      caller(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toThrow("You are already on the list for this class.");
  });

  it("waitlists at zero credit cost once the class is full", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 2 });
    const first = await makeMemberWithMembership(db, { creditsRemaining: 10 });
    const second = await makeMemberWithMembership(db, { creditsRemaining: 10 });

    await caller(db, first.user).bookings.book({ classId: cls.id });
    const waitlisted = await caller(db, second.user).bookings.book({
      classId: cls.id,
    });

    expect(waitlisted.status).toBe("waitlisted");
    expect(waitlisted.creditsUsed).toBe(0);

    const untouched = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, second.membership.id))
      .get();
    expect(untouched!.creditsRemaining).toBe(10);
  });

  it("treats a balance of 999 or more as unlimited and never decrements it", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 999,
    });
    const cls = await makeClass(db, { creditCost: 5 });

    const created = await caller(db, user).bookings.book({ classId: cls.id });

    // The booking still records what it would have cost...
    expect(created.creditsUsed).toBe(5);
    // ...but the balance is left alone.
    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(999);
  });

  it("still decrements a balance of 998, which is below the unlimited threshold", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 998,
    });
    const cls = await makeClass(db, { creditCost: 1 });

    await caller(db, user).bookings.book({ classId: cls.id });

    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(997);
  });

  it("picks the membership with the latest end date when several are active", async () => {
    const user = await makeUser(db);
    const { makeMembership } = await import("@/test/harness");
    await makeMembership(db, user.id, {
      endDate: daysFromNow(5),
      creditsRemaining: 1,
    });
    const later = await makeMembership(db, user.id, {
      endDate: daysFromNow(60),
      creditsRemaining: 8,
    });
    const cls = await makeClass(db, { creditCost: 2 });

    const created = await caller(db, user).bookings.book({ classId: cls.id });

    expect(created.membershipId).toBe(later.id);
  });
});

describe("bookings.cancel", () => {
  it("refunds the credit when cancelling more than 12 hours ahead", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const cls = await makeClass(db, { startsAt: hoursFromNow(13), creditCost: 2 });
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    const result = await caller(db, user).bookings.cancel({
      bookingId: booking.id,
    });

    expect(result).toEqual({ ok: true, refunded: true });
    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(10);
  });

  it("forfeits the credit when cancelling inside 12 hours", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const cls = await makeClass(db, { startsAt: hoursFromNow(11), creditCost: 2 });
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    const result = await caller(db, user).bookings.cancel({
      bookingId: booking.id,
    });

    expect(result).toEqual({ ok: true, refunded: false });
    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(8);
  });

  it("does not refund an unlimited membership", async () => {
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 999,
    });
    const cls = await makeClass(db, { startsAt: hoursFromNow(48) });
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    const result = await caller(db, user).bookings.cancel({
      bookingId: booking.id,
    });

    // The response still reports a refund, but the balance is untouched.
    expect(result.refunded).toBe(true);
    const after = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(999);
  });

  it("lets staff cancel someone else's booking", async () => {
    const { user } = await makeMemberWithMembership(db);
    const admin = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db);
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    await expect(
      caller(db, admin).bookings.cancel({ bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("stops another member from cancelling a booking they do not own", async () => {
    const { user } = await makeMemberWithMembership(db);
    const stranger = await makeUser(db);
    const cls = await makeClass(db);
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    await expect(
      caller(db, stranger).bookings.cancel({ bookingId: booking.id }),
    ).rejects.toThrow("You cannot cancel this booking.");
  });

  it("rejects a booking that is no longer active", async () => {
    const { user } = await makeMemberWithMembership(db);
    const cls = await makeClass(db);
    const booking = await caller(db, user).bookings.book({ classId: cls.id });
    await caller(db, user).bookings.cancel({ bookingId: booking.id });

    await expect(
      caller(db, user).bookings.cancel({ bookingId: booking.id }),
    ).rejects.toThrow("This booking is no longer active.");
  });

  it("rejects an unknown booking", async () => {
    const { user } = await makeMemberWithMembership(db);

    await expect(
      caller(db, user).bookings.cancel({ bookingId: 999999 }),
    ).rejects.toThrow("Booking not found.");
  });
});

describe("waitlist promotion", () => {
  it("promotes the longest-waiting member and charges them", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 2 });
    const holder = await makeMemberWithMembership(db);
    const firstInLine = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const secondInLine = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });

    const held = await caller(db, holder.user).bookings.book({
      classId: cls.id,
    });
    const firstWait = await caller(db, firstInLine.user).bookings.book({
      classId: cls.id,
    });
    const secondWait = await caller(db, secondInLine.user).bookings.book({
      classId: cls.id,
    });

    await caller(db, holder.user).bookings.cancel({ bookingId: held.id });

    const promoted = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, firstWait.id))
      .get();
    expect(promoted!.status).toBe("booked");
    expect(promoted!.creditsUsed).toBe(2);

    const stillWaiting = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, secondWait.id))
      .get();
    expect(stillWaiting!.status).toBe("waitlisted");

    const charged = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, firstInLine.membership.id))
      .get();
    expect(charged!.creditsRemaining).toBe(8);
  });

  it("promotes nobody when a waitlisted booking is cancelled", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const holder = await makeMemberWithMembership(db);
    const waiting = await makeMemberWithMembership(db);
    const behind = await makeMemberWithMembership(db);

    await caller(db, holder.user).bookings.book({ classId: cls.id });
    const waitingBooking = await caller(db, waiting.user).bookings.book({
      classId: cls.id,
    });
    const behindBooking = await caller(db, behind.user).bookings.book({
      classId: cls.id,
    });

    await caller(db, waiting.user).bookings.cancel({
      bookingId: waitingBooking.id,
    });

    const untouched = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, behindBooking.id))
      .get();
    expect(untouched!.status).toBe("waitlisted");
  });

  it("QUIRK: promotes a member who cannot afford it and floors their balance at zero", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 5 });
    const holder = await makeMemberWithMembership(db);
    const broke = await makeMemberWithMembership(db, { creditsRemaining: 5 });

    const held = await caller(db, holder.user).bookings.book({
      classId: cls.id,
    });
    // Affordable at join time, so the member lands on the waitlist...
    const waited = await caller(db, broke.user).bookings.book({
      classId: cls.id,
    });
    // ...then spends the credits elsewhere before the spot frees up.
    await db
      .update(memberships)
      .set({ creditsRemaining: 1 })
      .where(eq(memberships.id, broke.membership.id));

    await caller(db, holder.user).bookings.cancel({ bookingId: held.id });

    const promoted = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, waited.id))
      .get();
    expect(promoted!.status).toBe("booked");

    const balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, broke.membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(0);
  });
});

describe("bookings.waitlisted", () => {
  it("reports queue position in join order", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const holder = await makeMemberWithMembership(db);
    const first = await makeMemberWithMembership(db);
    const second = await makeMemberWithMembership(db);

    await caller(db, holder.user).bookings.book({ classId: cls.id });
    await caller(db, first.user).bookings.book({ classId: cls.id });
    // bookedAt has second resolution, so force a distinct ordering value.
    await new Promise((r) => setTimeout(r, 1100));
    await caller(db, second.user).bookings.book({ classId: cls.id });

    const firstQueue = await caller(db, first.user).bookings.waitlisted();
    const secondQueue = await caller(db, second.user).bookings.waitlisted();

    expect(firstQueue[0].position).toBe(1);
    expect(secondQueue[0].position).toBe(2);
  });
});

describe("bookings.mine", () => {
  it("hides past classes unless asked for them", async () => {
    const { user } = await makeMemberWithMembership(db, {
      creditsRemaining: 999,
    });
    const upcoming = await makeClass(db, { startsAt: hoursFromNow(24) });
    const past = await makeClass(db, { startsAt: hoursFromNow(24) });

    await caller(db, user).bookings.book({ classId: upcoming.id });
    await caller(db, user).bookings.book({ classId: past.id });
    // Move the second class into the past after booking it.
    const { classes } = await import("@/db/schema");
    await db
      .update(classes)
      .set({ startsAt: hoursFromNow(-24) })
      .where(eq(classes.id, past.id));

    const future = await caller(db, user).bookings.mine({ includePast: false });
    const all = await caller(db, user).bookings.mine({ includePast: true });

    expect(future.map((b) => b.classId)).toEqual([upcoming.id]);
    expect(all).toHaveLength(2);
  });
});
