/**
 * The studio's booking rules, as pure functions. Nothing here touches the
 * database or tRPC, which is what makes it cheap to test exhaustively.
 *
 * The three windows below are deliberately different from each other. They were
 * different before this refactor and changing them would change what members
 * are charged, so they are configuration rather than constants to unify.
 */
import { hoursUntil } from "@/lib/datetime";

/** Members cancel free up to this many hours before a class starts. */
export const FREE_CANCELLATION_HOURS = 12;

/** Corporate bookings get a wider window than personal ones. */
export const CORPORATE_FREE_CANCELLATION_HOURS = 24;

/** Rescheduling is more generous still than cancelling. */
export const FREE_RESCHEDULE_HOURS = 4;

/**
 * A membership holding this many credits or more is treated as unlimited: the
 * balance is never decremented and never refunded.
 */
export const UNLIMITED_CREDITS = 999;

export function isUnlimited(creditsRemaining: number): boolean {
  return creditsRemaining >= UNLIMITED_CREDITS;
}

export function canAfford(creditsRemaining: number, creditCost: number): boolean {
  return isUnlimited(creditsRemaining) || creditsRemaining >= creditCost;
}

/** A class can be joined only while it is upcoming and not cancelled. */
export function classIsOpen(
  cls: { startsAt: string; cancelled: boolean },
  now = new Date(),
): { open: true } | { open: false; reason: "cancelled" | "started" } {
  if (cls.cancelled) return { open: false, reason: "cancelled" };
  if (hoursUntil(cls.startsAt, now) <= 0) return { open: false, reason: "started" };
  return { open: true };
}

/**
 * Credits come back only when the member paid something for the seat and is
 * cancelling outside the free window.
 */
export function isRefundable(
  startsAt: string,
  creditsUsed: number,
  windowHours: number,
  now = new Date(),
): boolean {
  return hoursUntil(startsAt, now) >= windowHours && creditsUsed > 0;
}

export function canReschedule(startsAt: string, now = new Date()): boolean {
  return hoursUntil(startsAt, now) >= FREE_RESCHEDULE_HOURS;
}
