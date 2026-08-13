/**
 * Where a seat is paid from.
 *
 * The studio has two: a member's own membership, and the credit pool their
 * employer bought. They behave differently on purpose — different cancellation
 * windows, and only memberships have an "unlimited" tier — so each one owns its
 * own arithmetic here rather than the booking flow branching on a flag.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { companies, companyMembers, memberships } from "@/db/schema";
import {
  CORPORATE_FREE_CANCELLATION_HOURS,
  FREE_CANCELLATION_HOURS,
  isUnlimited,
} from "@/domain/booking-policy";
import { today } from "@/lib/datetime";
import type { DbExecutor } from "@/db";

/** The account a booking will be charged to, reduced to what the flow needs. */
export type CreditAccount = {
  id: number;
  available: number;
};

export interface CreditSource {
  /** Shown when the member has no account of this kind at all. */
  readonly missingAccountMessage: string;
  /** Shown when the account exists but cannot cover the class. */
  readonly insufficientCreditsMessage: string;
  /** How many hours before a class a cancellation still returns the credits. */
  readonly freeCancellationHours: number;

  resolve(db: DbExecutor, userId: number): Promise<CreditAccount | null>;
  canAfford(account: CreditAccount, creditCost: number): boolean;

  /** Charged when a booking is confirmed. Waitlisted seats are never charged. */
  debitForBooking(
    db: DbExecutor,
    account: CreditAccount,
    creditCost: number,
  ): Promise<void>;

  /** Returns credits after a qualifying cancellation. */
  refund(db: DbExecutor, accountId: number | null, credits: number): Promise<void>;

  /** Charges the member who has just been promoted off the waitlist. */
  debitForPromotion(
    db: DbExecutor,
    accountId: number | null,
    creditCost: number,
  ): Promise<void>;
}

export const membershipCredits: CreditSource = {
  missingAccountMessage: "An active membership is required to book classes.",
  insufficientCreditsMessage: "Not enough class credits remaining.",
  freeCancellationHours: FREE_CANCELLATION_HOURS,

  async resolve(db, userId) {
    // A member can hold several active memberships at once; the one running
    // longest is the one that gets spent.
    const membership = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          gte(memberships.endDate, today()),
        ),
      )
      .orderBy(desc(memberships.endDate))
      .get();

    return membership
      ? { id: membership.id, available: membership.creditsRemaining }
      : null;
  },

  canAfford(account, creditCost) {
    return isUnlimited(account.available) || account.available >= creditCost;
  },

  async debitForBooking(db, account, creditCost) {
    if (isUnlimited(account.available)) return;
    await db
      .update(memberships)
      .set({ creditsRemaining: account.available - creditCost })
      .where(eq(memberships.id, account.id));
  },

  async refund(db, accountId, credits) {
    if (accountId === null) return;
    const membership = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, accountId))
      .get();

    if (!membership || isUnlimited(membership.creditsRemaining)) return;

    await db
      .update(memberships)
      .set({ creditsRemaining: membership.creditsRemaining + credits })
      .where(eq(memberships.id, membership.id));
  },

  async debitForPromotion(db, accountId, creditCost) {
    if (accountId === null) return;
    const membership = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, accountId))
      .get();

    if (!membership || isUnlimited(membership.creditsRemaining)) return;

    // A member promoted off the waitlist is charged even if they can no longer
    // afford it; the balance floors at zero rather than going negative.
    await db
      .update(memberships)
      .set({
        creditsRemaining: Math.max(0, membership.creditsRemaining - creditCost),
      })
      .where(eq(memberships.id, membership.id));
  },
};

export const companyPoolCredits: CreditSource = {
  missingAccountMessage: "You are not linked to an active company.",
  insufficientCreditsMessage: "Your company does not have enough credits.",
  freeCancellationHours: CORPORATE_FREE_CANCELLATION_HOURS,

  async resolve(db, userId) {
    const row = await db
      .select({ company: companies })
      .from(companyMembers)
      .innerJoin(companies, eq(companyMembers.companyId, companies.id))
      .where(
        and(eq(companyMembers.userId, userId), eq(companies.active, true)),
      )
      .get();

    return row
      ? { id: row.company.id, available: row.company.creditPoolBalance }
      : null;
  },

  canAfford(account, creditCost) {
    // Pools have no unlimited tier: every seat is debited.
    return account.available >= creditCost;
  },

  async debitForBooking(db, account, creditCost) {
    await db
      .update(companies)
      .set({ creditPoolBalance: account.available - creditCost })
      .where(eq(companies.id, account.id));
  },

  async refund(db, accountId, credits) {
    if (accountId === null) return;
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, accountId))
      .get();

    if (!company) return;

    await db
      .update(companies)
      .set({ creditPoolBalance: company.creditPoolBalance + credits })
      .where(eq(companies.id, company.id));
  },

  async debitForPromotion(db, accountId, creditCost) {
    if (accountId === null) return;
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, accountId))
      .get();

    // Unlike a membership, a pool that cannot cover the seat is left alone and
    // the promoted employee gets the class for free.
    if (!company || company.creditPoolBalance < creditCost) return;

    await db
      .update(companies)
      .set({
        creditPoolBalance: Math.max(0, company.creditPoolBalance - creditCost),
      })
      .where(eq(companies.id, company.id));
  },
};
