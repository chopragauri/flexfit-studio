/**
 * Documented behaviour that looks like a bug but is deliberately preserved.
 *
 * Each case here corresponds to an entry in documents/01-baseline-analysis.md
 * section C and docs/refactoring-decisions.md. If the refactor ever "fixes" one
 * of these by accident, this file fails and the change becomes a decision
 * rather than an accident.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  bookings,
  checkins,
  corporateBookings,
  memberships,
  notifications,
  payments,
} from "@/db/schema";
import {
  caller,
  createTestDb,
  hoursFromNow,
  linkCompanyMember,
  makeClass,
  makeCompany,
  makeMemberWithMembership,
  makePlan,
  makeUser,
} from "@/test/harness";

const { db, destroy } = createTestDb();
afterAll(destroy);

beforeEach(async () => {
  await db.delete(checkins);
  await db.delete(corporateBookings);
  await db.delete(bookings);
  await db.delete(notifications);
  await db.delete(payments);
});

describe("quirk 1: personal and corporate seats are counted separately", () => {
  it("a corporate booking does not reduce the advertised spotsLeft", async () => {
    const cls = await makeClass(db, { capacity: 2 });
    const company = await makeCompany(db);
    const employee = await makeUser(db);
    await linkCompanyMember(db, company.id, employee.id);

    const before = await caller(db, null).classes.list({});
    expect(before.find((c) => c.id === cls.id)!.spotsLeft).toBe(2);

    await caller(db, employee).corporateBookings.book({ classId: cls.id });

    const after = await caller(db, null).classes.list({});
    expect(after.find((c) => c.id === cls.id)!.spotsLeft).toBe(2);
    expect(after.find((c) => c.id === cls.id)!.full).toBe(false);
  });

  it("a class fills to capacity on each side independently", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const company = await makeCompany(db);

    const member = await makeMemberWithMembership(db);
    await caller(db, member.user).bookings.book({ classId: cls.id });

    const employee = await makeUser(db);
    await linkCompanyMember(db, company.id, employee.id);
    const corporate = await caller(db, employee).corporateBookings.book({
      classId: cls.id,
    });

    // The personal side is full, yet the corporate side confirms a second seat.
    expect(corporate.status).toBe("booked");
  });
});

describe("quirk 2: one member can hold both a personal and a corporate seat", () => {
  it("charges the membership and the company pool for the same class", async () => {
    const cls = await makeClass(db, { creditCost: 2 });
    const { user, membership } = await makeMemberWithMembership(db, {
      creditsRemaining: 10,
    });
    const company = await makeCompany(db, { creditPoolBalance: 20 });
    await linkCompanyMember(db, company.id, user.id);

    await caller(db, user).bookings.book({ classId: cls.id });
    await caller(db, user).corporateBookings.book({ classId: cls.id });

    const balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(8);

    const { companies } = await import("@/db/schema");
    const pool = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(pool!.creditPoolBalance).toBe(18);
  });
});

describe("quirk 5: cancelling a class leaves corporate bookings and refunds nobody", () => {
  it("cancels personal bookings only, refunds no credits, sends no notification", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db, { creditCost: 2 });
    const member = await makeMemberWithMembership(db, { creditsRemaining: 10 });
    const company = await makeCompany(db, { creditPoolBalance: 20 });
    const employee = await makeUser(db);
    await linkCompanyMember(db, company.id, employee.id);

    const personal = await caller(db, member.user).bookings.book({
      classId: cls.id,
    });
    const corporate = await caller(db, employee).corporateBookings.book({
      classId: cls.id,
    });

    await caller(db, admin).classes.cancel({ id: cls.id });

    const personalAfter = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, personal.id))
      .get();
    expect(personalAfter!.status).toBe("cancelled");

    const corporateAfter = await db
      .select()
      .from(corporateBookings)
      .where(eq(corporateBookings.id, corporate.id))
      .get();
    expect(corporateAfter!.status).toBe("booked");

    // No credits come back to anyone.
    const balance = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, member.membership.id))
      .get();
    expect(balance!.creditsRemaining).toBe(8);

    await expect(db.select().from(notifications).all()).resolves.toEqual([]);
  });
});

describe("quirk 6: refunding a payment leaves future bookings standing", () => {
  it("cancels the membership but not its credits or its bookings", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const plan = await makePlan(db, { classCredits: 10, priceCents: 50000 });
    const { user } = await makeMemberWithMembership(db, {
      planId: plan.id,
      creditsRemaining: 10,
    });
    const cls = await makeClass(db, { startsAt: hoursFromNow(72) });
    const booking = await caller(db, user).bookings.book({ classId: cls.id });

    const payment = await db
      .insert(payments)
      .values({
        userId: user.id,
        membershipId: booking.membershipId,
        amountCents: plan.priceCents,
        method: "card",
        status: "paid",
      })
      .returning()
      .get();

    await caller(db, admin).payments.refund({ id: payment.id });

    const ms = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, booking.membershipId!))
      .get();
    expect(ms!.status).toBe("cancelled");
    expect(ms!.creditsRemaining).toBe(9);

    const stillBooked = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id))
      .get();
    expect(stillBooked!.status).toBe("booked");
  });
});

describe("quirk 7: subscribing never expires the previous membership", () => {
  it("leaves a member holding several active memberships at once", async () => {
    const user = await makeUser(db);
    const shortPlan = await makePlan(db, { durationDays: 5, classCredits: 4 });
    const longPlan = await makePlan(db, { durationDays: 90, classCredits: 20 });

    await caller(db, user).plans.subscribe({ planId: shortPlan.id });
    await caller(db, user).plans.subscribe({ planId: longPlan.id });

    const held = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .all();
    expect(held).toHaveLength(2);
    expect(held.every((m) => m.status === "active")).toBe(true);

    // Booking spends the one with the later end date.
    const cls = await makeClass(db, { creditCost: 1 });
    const booking = await caller(db, user).bookings.book({ classId: cls.id });
    const longMembership = held.find((m) => m.planId === longPlan.id)!;
    expect(booking.membershipId).toBe(longMembership.id);
  });
});

describe("FIXED: admin.classUtilisation counts the real roster", () => {
  it("agrees with the schedule's own booked count", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db, { capacity: 10 });

    for (let i = 0; i < 3; i += 1) {
      const member = await makeMemberWithMembership(db);
      await caller(db, member.user).bookings.book({ classId: cls.id });
    }

    const [row] = (await caller(db, admin).admin.classUtilisation({})).filter(
      (r) => r.id === cls.id,
    );
    const fromSchedule = (await caller(db, null).classes.list({})).find(
      (c) => c.id === cls.id,
    );

    // Both count the same seats, so they must agree.
    expect(fromSchedule!.booked).toBe(3);
    expect(row.booked).toBe(3);
    expect(row.utilisation).toBeCloseTo(0.3);
  });

  it("counts attended seats too, and reports zero for an empty class", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const staff = await makeUser(db, { role: "admin" });
    const busy = await makeClass(db, { capacity: 4 });
    const empty = await makeClass(db, { capacity: 4 });

    const member = await makeMemberWithMembership(db);
    const booking = await caller(db, member.user).bookings.book({
      classId: busy.id,
    });
    await caller(db, staff).bookings.markAttended({ bookingId: booking.id });

    const rows = await caller(db, admin).admin.classUtilisation({});
    expect(rows.find((r) => r.id === busy.id)!.booked).toBe(1);
    expect(rows.find((r) => r.id === empty.id)!.booked).toBe(0);
  });
});

/** Users accumulate across cases in this file, so counts are asserted relatively. */
async function memberCount() {
  const { users } = await import("@/db/schema");
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.role, "member"))
    .all();
  return rows.length;
}

describe("quirk 8: only announcements are ever generated at runtime", () => {
  it("waitlist promotion sends no notification", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const holder = await makeMemberWithMembership(db);
    const waiting = await makeMemberWithMembership(db);

    const held = await caller(db, holder.user).bookings.book({
      classId: cls.id,
    });
    await caller(db, waiting.user).bookings.book({ classId: cls.id });
    await caller(db, holder.user).bookings.cancel({ bookingId: held.id });

    await expect(db.select().from(notifications).all()).resolves.toEqual([]);
  });

  it("broadcast reaches members only, and always as an announcement", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const before = await memberCount();
    await makeUser(db, { role: "member" });
    await makeUser(db, { role: "member" });
    await makeUser(db, { role: "trainer" });

    const result = await caller(db, admin).notifications.broadcast({
      title: "Studio closed",
      message: "Maintenance on Sunday.",
    });

    expect(result.count).toBe(before + 2);
    const rows = await db.select().from(notifications).all();
    expect(rows.every((n) => n.type === "announcement")).toBe(true);
  });

  it("QUIRK: broadcast also reaches deactivated members", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const before = await memberCount();
    await makeUser(db, { role: "member", active: false });

    const result = await caller(db, admin).notifications.broadcast({
      title: "Hello",
      message: "Everyone.",
    });

    expect(result.count).toBe(before + 1);
  });
});
