import { copyFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { appRouter } from "@/server/routers/_app";
import type { Context } from "@/server/trpc";
import { hashPassword } from "@/lib/password";
import { TEMPLATE_DB, TEST_DB_DIR } from "./global-setup";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** A private copy of the schema template, so test files cannot see each other. */
export function createTestDb() {
  const path = `${TEST_DB_DIR}/${randomUUID()}.db`;
  copyFileSync(TEMPLATE_DB, path);
  const db = drizzle(createClient({ url: `file:${path}` }), { schema });
  return {
    db,
    destroy: () => rmSync(path, { force: true }),
  };
}

export function caller(db: TestDb, user: schema.User | null) {
  return appRouter.createCaller({ db, user, token: "test-token" } as Context);
}

export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

let emailCounter = 0;

export async function makeUser(
  db: TestDb,
  overrides: Partial<schema.User> = {},
): Promise<schema.User> {
  emailCounter += 1;
  return db
    .insert(schema.users)
    .values({
      email: overrides.email ?? `user${emailCounter}@test.local`,
      passwordHash: hashPassword("secret123"),
      name: overrides.name ?? `User ${emailCounter}`,
      phone: overrides.phone ?? `+91 90000 ${String(10000 + emailCounter)}`,
      role: overrides.role ?? "member",
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function makePlan(
  db: TestDb,
  overrides: Partial<schema.MembershipPlan> = {},
) {
  return db
    .insert(schema.membershipPlans)
    .values({
      name: overrides.name ?? "Test Plan",
      description: overrides.description ?? "A plan for tests.",
      priceCents: overrides.priceCents ?? 100000,
      durationDays: overrides.durationDays ?? 30,
      classCredits: overrides.classCredits ?? 10,
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function makeMembership(
  db: TestDb,
  userId: number,
  overrides: Partial<schema.Membership> = {},
) {
  const planId =
    overrides.planId ?? (await makePlan(db, { classCredits: 10 })).id;
  return db
    .insert(schema.memberships)
    .values({
      userId,
      planId,
      startDate: overrides.startDate ?? daysFromNow(-10),
      endDate: overrides.endDate ?? daysFromNow(20),
      creditsRemaining: overrides.creditsRemaining ?? 10,
      status: overrides.status ?? "active",
    })
    .returning()
    .get();
}

export async function makeClass(
  db: TestDb,
  overrides: Partial<schema.GymClass> = {},
) {
  return db
    .insert(schema.classes)
    .values({
      name: overrides.name ?? "Sunrise Yoga",
      description: overrides.description ?? null,
      trainerId: overrides.trainerId ?? null,
      room: overrides.room ?? "Studio A",
      capacity: overrides.capacity ?? 2,
      startsAt: overrides.startsAt ?? hoursFromNow(48),
      durationMin: overrides.durationMin ?? 60,
      creditCost: overrides.creditCost ?? 1,
      cancelled: overrides.cancelled ?? false,
    })
    .returning()
    .get();
}

export async function makeCompany(
  db: TestDb,
  overrides: Partial<schema.Company> = {},
) {
  return db
    .insert(schema.companies)
    .values({
      name: overrides.name ?? "TestCorp",
      contactEmail: overrides.contactEmail ?? "hr@testcorp.local",
      creditPoolBalance: overrides.creditPoolBalance ?? 50,
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function linkCompanyMember(
  db: TestDb,
  companyId: number,
  userId: number,
) {
  return db
    .insert(schema.companyMembers)
    .values({ companyId, userId })
    .returning()
    .get();
}

/** Seeds a member who holds an active membership, the common starting point. */
export async function makeMemberWithMembership(
  db: TestDb,
  membership: Partial<schema.Membership> = {},
) {
  const user = await makeUser(db);
  const ms = await makeMembership(db, user.id, membership);
  return { user, membership: ms };
}
