/**
 * Every procedure level, asserted against every role. The four hand-written
 * trainer checks in trainers.ts are the ones most at risk from a middleware
 * refactor, so they are covered explicitly.
 */
import { afterAll, describe, expect, it } from "vitest";
import { caller, createTestDb, makeUser, type TestDb } from "@/test/harness";
import type { User } from "@/db/schema";

const { db, destroy } = createTestDb();
afterAll(destroy);

let cached: Record<string, User> | null = null;

async function roles(database: TestDb) {
  if (!cached) {
    cached = {
      member: await makeUser(database, { role: "member" }),
      trainer: await makeUser(database, { role: "trainer" }),
      admin: await makeUser(database, { role: "admin" }),
    };
  }
  return cached;
}

describe("protectedProcedure", () => {
  it("rejects a signed-out caller", async () => {
    await expect(caller(db, null).members.profile()).rejects.toThrow(
      "Sign in required.",
    );
  });

  it("accepts any signed-in role", async () => {
    const { member, trainer, admin } = await roles(db);
    for (const user of [member, trainer, admin]) {
      await expect(caller(db, user).members.profile()).resolves.toMatchObject({
        id: user.id,
      });
    }
  });
});

describe("staffProcedure", () => {
  it("rejects members but accepts trainers and admins", async () => {
    const { member, trainer, admin } = await roles(db);

    await expect(caller(db, member).members.search({ q: "" })).rejects.toThrow(
      "Staff only.",
    );
    await expect(
      caller(db, trainer).members.search({ q: "" }),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      caller(db, admin).members.search({ q: "" }),
    ).resolves.toBeInstanceOf(Array);
  });
});

describe("adminProcedure", () => {
  it("rejects members and trainers, accepts admins", async () => {
    const { member, trainer, admin } = await roles(db);

    await expect(caller(db, member).admin.stats()).rejects.toThrow(
      "Admins only.",
    );
    await expect(caller(db, trainer).admin.stats()).rejects.toThrow(
      "Admins only.",
    );
    await expect(caller(db, admin).admin.stats()).resolves.toMatchObject({
      totalMembers: expect.any(Number),
    });
  });

  it("guards the reporting and attendance surfaces", async () => {
    const { member, trainer, admin } = await roles(db);

    for (const user of [member, trainer]) {
      await expect(caller(db, user).reports.refundCount()).rejects.toThrow(
        "Admins only.",
      );
      await expect(caller(db, user).attendance.noShowList()).rejects.toThrow(
        "Admins only.",
      );
    }

    await expect(caller(db, admin).reports.refundCount()).resolves.toEqual({
      count: 0,
    });
    await expect(caller(db, admin).attendance.noShowList()).resolves.toEqual([]);
  });

  it("guards the company management surface", async () => {
    const { member, trainer, admin } = await roles(db);

    for (const user of [member, trainer]) {
      await expect(caller(db, user).adminCompanies.list()).rejects.toThrow(
        "Admins only.",
      );
    }
    await expect(caller(db, admin).adminCompanies.list()).resolves.toEqual([]);
  });
});

describe("trainer-only procedures", () => {
  it("rejects members and admins from the trainer's own views", async () => {
    const { member, trainer, admin } = await roles(db);
    const message = "Only trainers can access this.";

    await expect(caller(db, member).trainers.upcomingClasses()).rejects.toThrow(
      message,
    );
    await expect(caller(db, admin).trainers.upcomingClasses()).rejects.toThrow(
      message,
    );
    await expect(
      caller(db, trainer).trainers.upcomingClasses(),
    ).resolves.toEqual([]);

    await expect(caller(db, admin).trainers.availability()).rejects.toThrow(
      message,
    );
    await expect(caller(db, trainer).trainers.availability()).resolves.toEqual(
      [],
    );

    await expect(
      caller(db, admin).trainers.setAvailability({
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "12:00",
      }),
    ).rejects.toThrow(message);

    await expect(
      caller(db, admin).trainers.removeAvailability({ dayOfWeek: 1 }),
    ).rejects.toThrow(message);
  });

  it("checkAvailability is staff-only, not trainer-only", async () => {
    const { member, trainer, admin } = await roles(db);

    await expect(
      caller(db, member).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: new Date().toISOString(),
        durationMin: 60,
      }),
    ).rejects.toThrow("Staff only.");

    for (const user of [trainer, admin]) {
      await expect(
        caller(db, user).trainers.checkAvailability({
          trainerId: trainer.id,
          startsAt: new Date().toISOString(),
          durationMin: 60,
        }),
      ).resolves.toMatchObject({ available: false });
    }
  });
});

describe("publicProcedure", () => {
  it("serves the schedule and the plan list to signed-out visitors", async () => {
    await expect(caller(db, null).classes.list({})).resolves.toBeInstanceOf(
      Array,
    );
    await expect(caller(db, null).plans.list({})).resolves.toBeInstanceOf(
      Array,
    );
    await expect(caller(db, null).auth.me()).resolves.toBeNull();
  });
});
