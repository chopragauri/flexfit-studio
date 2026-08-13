import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { memberships, payments } from "@/db/schema";
import {
  caller,
  createTestDb,
  makePlan,
  makeUser,
  type TestDb,
} from "@/test/harness";

const { db, destroy } = createTestDb();
afterAll(destroy);

beforeEach(async () => {
  await db.delete(payments);
  await db.delete(memberships);
});

async function paidPayment(database: TestDb, userId: number, membershipId?: number) {
  return database
    .insert(payments)
    .values({
      userId,
      membershipId: membershipId ?? null,
      amountCents: 250000,
      method: "card",
      status: "paid",
    })
    .returning()
    .get();
}

describe("plans.subscribe", () => {
  it("creates the membership and an immediately paid payment", async () => {
    const user = await makeUser(db);
    const plan = await makePlan(db, {
      durationDays: 30,
      classCredits: 12,
      priceCents: 450000,
    });

    const membership = await caller(db, user).plans.subscribe({
      planId: plan.id,
      method: "upi",
    });

    expect(membership.creditsRemaining).toBe(12);
    expect(membership.status).toBe("active");

    const payment = await db
      .select()
      .from(payments)
      .where(eq(payments.membershipId, membership.id))
      .get();
    expect(payment!.status).toBe("paid");
    expect(payment!.amountCents).toBe(450000);
    expect(payment!.method).toBe("upi");
    expect(payment!.reference).toMatch(/^PAY-\d+$/);
  });

  it("defaults the payment method to card", async () => {
    const user = await makeUser(db);
    const plan = await makePlan(db);

    const membership = await caller(db, user).plans.subscribe({
      planId: plan.id,
    });

    const payment = await db
      .select()
      .from(payments)
      .where(eq(payments.membershipId, membership.id))
      .get();
    expect(payment!.method).toBe("card");
  });

  it("rejects an unknown or retired plan", async () => {
    const user = await makeUser(db);
    const retired = await makePlan(db, { active: false });

    await expect(
      caller(db, user).plans.subscribe({ planId: 999999 }),
    ).rejects.toThrow("Plan not found.");
    await expect(
      caller(db, user).plans.subscribe({ planId: retired.id }),
    ).rejects.toThrow("This plan is no longer available.");
  });

  it("hides inactive plans from the public list unless asked", async () => {
    await makePlan(db, { name: "Live", active: true });
    await makePlan(db, { name: "Retired", active: false });

    const visible = await caller(db, null).plans.list({});
    const all = await caller(db, null).plans.list({ includeInactive: true });

    expect(visible.some((p) => p.name === "Retired")).toBe(false);
    expect(all.some((p) => p.name === "Retired")).toBe(true);
  });
});

describe("payments.refund", () => {
  it("refunds a paid payment and cancels the linked membership", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const user = await makeUser(db);
    const plan = await makePlan(db);
    const membership = await caller(db, user).plans.subscribe({
      planId: plan.id,
    });
    const payment = await db
      .select()
      .from(payments)
      .where(eq(payments.membershipId, membership.id))
      .get();

    const refunded = await caller(db, admin).payments.refund({
      id: payment!.id,
    });

    expect(refunded.status).toBe("refunded");
    const ms = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .get();
    expect(ms!.status).toBe("cancelled");
  });

  it("refuses to refund anything that is not paid", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const user = await makeUser(db);
    const pending = await db
      .insert(payments)
      .values({
        userId: user.id,
        amountCents: 1000,
        method: "cash",
        status: "pending",
      })
      .returning()
      .get();

    await expect(
      caller(db, admin).payments.refund({ id: pending.id }),
    ).rejects.toThrow("Only paid payments can be refunded.");
    await expect(
      caller(db, admin).payments.refund({ id: 999999 }),
    ).rejects.toThrow("Payment not found.");
  });

  it("refuses to re-refund", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const user = await makeUser(db);
    const payment = await paidPayment(db, user.id);
    await caller(db, admin).payments.refund({ id: payment.id });

    await expect(
      caller(db, admin).payments.refund({ id: payment.id }),
    ).rejects.toThrow("Only paid payments can be refunded.");
  });
});

describe("payments.markPaid", () => {
  it("promotes a pending payment", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const user = await makeUser(db);
    const pending = await db
      .insert(payments)
      .values({
        userId: user.id,
        amountCents: 1000,
        method: "cash",
        status: "pending",
      })
      .returning()
      .get();

    const updated = await caller(db, admin).payments.markPaid({
      id: pending.id,
    });
    expect(updated.status).toBe("paid");
  });

  it("refuses to resurrect a refunded payment", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const user = await makeUser(db);
    const payment = await paidPayment(db, user.id);
    await caller(db, admin).payments.refund({ id: payment.id });

    await expect(
      caller(db, admin).payments.markPaid({ id: payment.id }),
    ).rejects.toThrow("Refunded payments cannot be marked paid.");
  });
});

describe("payments.mine", () => {
  it("shows only the caller's own payments", async () => {
    const user = await makeUser(db);
    const other = await makeUser(db);
    await paidPayment(db, user.id);
    await paidPayment(db, other.id);

    const mine = await caller(db, user).payments.mine();
    expect(mine).toHaveLength(1);
  });
});
