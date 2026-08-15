"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell() {
  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery(
    undefined,
    { refetchInterval: POLL_INTERVAL_MS },
  );

  return (
    <Link href="/notifications" className="relative" aria-label="Notifications">
      <span className="text-sm">🔔</span>
      {/*
        Preserved exactly: when the count is 0 this expression evaluates to 0
        and React renders a literal "0" beside the bell. See
        docs/refactoring-decisions.md, preserved behaviour #9.
      */}
      {unreadCount && unreadCount > 0 && (
        <span
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
