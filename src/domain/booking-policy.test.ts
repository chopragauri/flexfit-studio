import { describe, expect, it } from "vitest";
import {
  CORPORATE_FREE_CANCELLATION_HOURS,
  FREE_CANCELLATION_HOURS,
  FREE_RESCHEDULE_HOURS,
  UNLIMITED_CREDITS,
  canAfford,
  canReschedule,
  classIsOpen,
  isRefundable,
  isUnlimited,
} from "./booking-policy";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function hoursAhead(hours: number): string {
  return new Date(NOW.getTime() + hours * 3600_000).toISOString();
}

describe("the policy windows are intentionally different", () => {
  it("keeps the three windows at their historical values", () => {
    expect(FREE_CANCELLATION_HOURS).toBe(12);
    expect(CORPORATE_FREE_CANCELLATION_HOURS).toBe(24);
    expect(FREE_RESCHEDULE_HOURS).toBe(4);
    expect(UNLIMITED_CREDITS).toBe(999);
  });
});

describe("isUnlimited", () => {
  it.each([
    [0, false],
    [1, false],
    [998, false],
    [999, true],
    [1000, true],
  ])("treats %i credits as unlimited=%s", (credits, expected) => {
    expect(isUnlimited(credits)).toBe(expected);
  });
});

describe("canAfford", () => {
  it.each([
    [10, 1, true],
    [2, 2, true],
    [1, 2, false],
    [0, 1, false],
    [0, 0, true],
    [999, 500, true],
    [998, 999, false],
  ])("%i credits against a cost of %i is %s", (credits, cost, expected) => {
    expect(canAfford(credits, cost)).toBe(expected);
  });
});

describe("classIsOpen", () => {
  it("is open for an upcoming, live class", () => {
    expect(
      classIsOpen({ startsAt: hoursAhead(1), cancelled: false }, NOW),
    ).toEqual({ open: true });
  });

  it("reports cancellation ahead of timing", () => {
    expect(
      classIsOpen({ startsAt: hoursAhead(-5), cancelled: true }, NOW),
    ).toEqual({ open: false, reason: "cancelled" });
  });

  it("closes exactly at the start time", () => {
    expect(
      classIsOpen({ startsAt: hoursAhead(0), cancelled: false }, NOW),
    ).toEqual({ open: false, reason: "started" });
  });
});

describe("isRefundable", () => {
  it("refunds on the boundary and beyond", () => {
    expect(isRefundable(hoursAhead(12), 1, FREE_CANCELLATION_HOURS, NOW)).toBe(true);
    expect(isRefundable(hoursAhead(13), 1, FREE_CANCELLATION_HOURS, NOW)).toBe(true);
  });

  it("does not refund inside the window", () => {
    expect(isRefundable(hoursAhead(11.9), 1, FREE_CANCELLATION_HOURS, NOW)).toBe(
      false,
    );
  });

  it("never refunds a seat that cost nothing", () => {
    expect(isRefundable(hoursAhead(72), 0, FREE_CANCELLATION_HOURS, NOW)).toBe(
      false,
    );
  });

  it("applies the wider corporate window", () => {
    expect(
      isRefundable(hoursAhead(13), 1, CORPORATE_FREE_CANCELLATION_HOURS, NOW),
    ).toBe(false);
    expect(
      isRefundable(hoursAhead(24), 1, CORPORATE_FREE_CANCELLATION_HOURS, NOW),
    ).toBe(true);
  });
});

describe("canReschedule", () => {
  it.each([
    [4, true],
    [4.1, true],
    [3.9, false],
    [-1, false],
  ])("%i hours before the class is %s", (hours, expected) => {
    expect(canReschedule(hoursAhead(hours), NOW)).toBe(expected);
  });
});
