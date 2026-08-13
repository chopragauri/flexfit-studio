/** Money: what came in, how, and whose membership is about to lapse. */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { membershipPlans, memberships, payments, users } from "@/db/schema";
import { today } from "@/lib/datetime";
import { router, adminProcedure } from "../trpc";

const EXPIRY_HORIZON_DAYS = 14;

export const reportsRouter = router({
  revenueByMonth: adminProcedure.query(async ({ ctx }) => {
    const month = sql<string>`strftime('%Y-%m', ${payments.createdAt})`;

    const rows = await ctx.db
      .select({
        month,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .groupBy(month)
      .orderBy(sql`${month} DESC`);

    return rows.map((row) => ({
      month: row.month,
      totalCents: Number(row.totalCents),
    }));
  }),

  revenueByMethod: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        method: payments.method,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .groupBy(payments.method)
      .orderBy(sql`sum(${payments.amountCents}) DESC`);

    return rows.map((row) => ({
      method: row.method,
      totalCents: Number(row.totalCents),
      count: Number(row.count),
    }));
  }),

  refundCount: adminProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(eq(payments.status, "refunded"));

    return { count: Number(result.count) };
  }),

  expiringMemberships: adminProcedure.query(async ({ ctx }) => {
    const horizon = new Date(
      Date.now() + EXPIRY_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

    return ctx.db
      .select({
        memberId: users.id,
        memberName: users.name,
        memberEmail: users.email,
        planName: membershipPlans.name,
        expiresAt: memberships.endDate,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(
        and(
          eq(memberships.status, "active"),
          gte(memberships.endDate, today()),
          lte(memberships.endDate, horizon),
        ),
      )
      .orderBy(memberships.endDate);
  }),
});
