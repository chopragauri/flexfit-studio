"use client";

import type { RouterOutputs } from "@/lib/api-types";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/PageState";

type Company = RouterOutputs["adminCompanies"]["getById"];

export function CorporateBookingList({
  bookings,
}: {
  bookings: Company["recentBookings"];
}) {
  if (bookings.length === 0) {
    return (
      <div className="panel p-4 text-center">
        <EmptyState>No bookings yet</EmptyState>
      </div>
    );
  }

  return (
    <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
      {bookings.map((booking) => (
        <div key={booking.id} className="space-y-1 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{booking.className}</span>
            <span
              className={
                booking.status === "attended" ? "text-green-600" : undefined
              }
            >
              {booking.status}
            </span>
          </div>
          <div className="muted">
            {booking.memberName} &middot; {formatDateTime(booking.startsAt)}
          </div>
          <div className="muted">Credits used: {booking.creditsUsed}</div>
        </div>
      ))}
    </div>
  );
}
