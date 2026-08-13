import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { checkins, companies, corporateBookings } from "@/db/schema";
import {
  caller,
  createTestDb,
  hoursFromNow,
  linkCompanyMember,
  makeClass,
  makeCompany,
  makeUser,
} from "@/test/harness";

const { db, destroy } = createTestDb();
afterAll(destroy);

beforeEach(async () => {
  await db.delete(checkins);
  await db.delete(corporateBookings);
});

async function corporateMember(poolBalance = 50, active = true) {
  const company = await makeCompany(db, {
    creditPoolBalance: poolBalance,
    active,
  });
  const user = await makeUser(db);
  await linkCompanyMember(db, company.id, user.id);
  return { company, user };
}

describe("corporateBookings.book", () => {
  it("books against the company pool and debits it", async () => {
    const { company, user } = await corporateMember(50);
    const cls = await makeClass(db, { creditCost: 4 });

    const created = await caller(db, user).corporateBookings.book({
      classId: cls.id,
    });

    expect(created.status).toBe("booked");
    expect(created.creditsUsed).toBe(4);
    expect(created.companyId).toBe(company.id);

    const after = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(after!.creditPoolBalance).toBe(46);
  });

  it("rejects a member with no company link", async () => {
    const user = await makeUser(db);
    const cls = await makeClass(db);

    await expect(
      caller(db, user).corporateBookings.book({ classId: cls.id }),
    ).rejects.toThrow("You are not linked to an active company.");
  });

  it("rejects a member whose company is inactive", async () => {
    const { user } = await corporateMember(50, false);
    const cls = await makeClass(db);

    await expect(
      caller(db, user).corporateBookings.book({ classId: cls.id }),
    ).rejects.toThrow("You are not linked to an active company.");
  });

  it("rejects when the pool cannot cover the class", async () => {
    const { user } = await corporateMember(1);
    const cls = await makeClass(db, { creditCost: 2 });

    await expect(
      caller(db, user).corporateBookings.book({ classId: cls.id }),
    ).rejects.toThrow("Your company does not have enough credits.");
  });

  it("has no unlimited concept: a pool of 999 is still debited", async () => {
    const { company, user } = await corporateMember(999);
    const cls = await makeClass(db, { creditCost: 2 });

    await caller(db, user).corporateBookings.book({ classId: cls.id });

    const after = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(after!.creditPoolBalance).toBe(997);
  });

  it("waitlists at zero cost when the corporate seats are full", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 2 });
    const first = await corporateMember(50);
    const second = await corporateMember(50);

    await caller(db, first.user).corporateBookings.book({ classId: cls.id });
    const waitlisted = await caller(db, second.user).corporateBookings.book({
      classId: cls.id,
    });

    expect(waitlisted.status).toBe("waitlisted");
    expect(waitlisted.creditsUsed).toBe(0);

    const untouched = await db
      .select()
      .from(companies)
      .where(eq(companies.id, second.company.id))
      .get();
    expect(untouched!.creditPoolBalance).toBe(50);
  });

  it("rejects duplicates, cancelled classes and started classes", async () => {
    const { user } = await corporateMember();
    const cls = await makeClass(db);
    await caller(db, user).corporateBookings.book({ classId: cls.id });
    await expect(
      caller(db, user).corporateBookings.book({ classId: cls.id }),
    ).rejects.toThrow("You are already on the list for this class.");

    const cancelled = await makeClass(db, { cancelled: true });
    await expect(
      caller(db, user).corporateBookings.book({ classId: cancelled.id }),
    ).rejects.toThrow("This class has been cancelled.");

    const started = await makeClass(db, { startsAt: hoursFromNow(-1) });
    await expect(
      caller(db, user).corporateBookings.book({ classId: started.id }),
    ).rejects.toThrow("This class has already started.");
  });
});

describe("corporateBookings.cancel", () => {
  it("refunds the pool outside the 24 hour window", async () => {
    const { company, user } = await corporateMember(50);
    const cls = await makeClass(db, { startsAt: hoursFromNow(25), creditCost: 3 });
    const booking = await caller(db, user).corporateBookings.book({
      classId: cls.id,
    });

    const result = await caller(db, user).corporateBookings.cancel({
      bookingId: booking.id,
    });

    expect(result).toEqual({ ok: true, refunded: true });
    const after = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(after!.creditPoolBalance).toBe(50);
  });

  it("uses a 24 hour window, not the 12 hour personal one", async () => {
    const { company, user } = await corporateMember(50);
    // 13 hours ahead would be refundable for a personal booking.
    const cls = await makeClass(db, { startsAt: hoursFromNow(13), creditCost: 3 });
    const booking = await caller(db, user).corporateBookings.book({
      classId: cls.id,
    });

    const result = await caller(db, user).corporateBookings.cancel({
      bookingId: booking.id,
    });

    expect(result).toEqual({ ok: true, refunded: false });
    const after = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .get();
    expect(after!.creditPoolBalance).toBe(47);
  });

  it("promotes the longest-waiting corporate member and debits their pool", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 2 });
    const holder = await corporateMember(50);
    const waiting = await corporateMember(50);

    const held = await caller(db, holder.user).corporateBookings.book({
      classId: cls.id,
    });
    const queued = await caller(db, waiting.user).corporateBookings.book({
      classId: cls.id,
    });

    await caller(db, holder.user).corporateBookings.cancel({
      bookingId: held.id,
    });

    const promoted = await db
      .select()
      .from(corporateBookings)
      .where(eq(corporateBookings.id, queued.id))
      .get();
    expect(promoted!.status).toBe("booked");
    expect(promoted!.creditsUsed).toBe(2);

    const pool = await db
      .select()
      .from(companies)
      .where(eq(companies.id, waiting.company.id))
      .get();
    expect(pool!.creditPoolBalance).toBe(48);
  });

  it("stops a stranger cancelling, and lets staff do it", async () => {
    const { user } = await corporateMember();
    const stranger = await makeUser(db);
    const admin = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db);
    const booking = await caller(db, user).corporateBookings.book({
      classId: cls.id,
    });

    await expect(
      caller(db, stranger).corporateBookings.cancel({ bookingId: booking.id }),
    ).rejects.toThrow("You cannot cancel this booking.");

    await expect(
      caller(db, admin).corporateBookings.cancel({ bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("corporateBookings.markAttended", () => {
  it("QUIRK: ignores the requested source and writes no booking link", async () => {
    const { user } = await corporateMember();
    const staff = await makeUser(db, { role: "trainer" });
    const cls = await makeClass(db);
    const booking = await caller(db, user).corporateBookings.book({
      classId: cls.id,
    });

    await caller(db, staff).corporateBookings.markAttended({
      bookingId: booking.id,
      source: "kiosk",
    });

    const rows = await db.select().from(checkins).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("front_desk");
    expect(rows[0].bookingId).toBeNull();
  });

  it("only accepts confirmed bookings, and only from staff", async () => {
    const { user } = await corporateMember();
    const staff = await makeUser(db, { role: "admin" });
    const cls = await makeClass(db, { capacity: 1 });
    const other = await corporateMember();
    await caller(db, user).corporateBookings.book({ classId: cls.id });
    const waitlisted = await caller(db, other.user).corporateBookings.book({
      classId: cls.id,
    });

    await expect(
      caller(db, staff).corporateBookings.markAttended({
        bookingId: waitlisted.id,
      }),
    ).rejects.toThrow("Only confirmed bookings can be checked in.");

    await expect(
      caller(db, user).corporateBookings.markAttended({
        bookingId: waitlisted.id,
      }),
    ).rejects.toThrow("Staff only.");
  });
});
