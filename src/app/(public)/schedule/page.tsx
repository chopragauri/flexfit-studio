"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { ErrorAlert } from "@/components/ui/Alert";
import { EmptyState, LoadingState } from "@/components/ui/PageState";

export default function SchedulePage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  // Pinned at mount. Recomputing this on every render would change the query
  // key each time, so the query would refetch forever and never settle.
  const [from] = useState(() => new Date().toISOString());
  const { data: classes, isLoading } = trpc.classes.list.useQuery({ from });

  const book = trpc.bookings.book.useMutation({
    onSuccess: async () => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
    },
  });

  if (isLoading) return <LoadingState label="Loading schedule..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Class schedule</h1>
        <p className="muted mt-1 text-sm">
          {classes?.length ?? 0} upcoming classes
        </p>
      </div>

      <ErrorAlert error={book.error} />

      <div className="space-y-2">
        {classes?.map((c) => (
          <div
            key={c.id}
            className="panel flex items-center gap-4 p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{c.name}</h2>
                {c.full && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ background: "#3a2a1a", color: "#fbbf24" }}
                  >
                    Full
                  </span>
                )}
              </div>
              <p className="muted mt-0.5 text-sm">
                {formatDateTime(c.startsAt)} &middot; {c.room} &middot;{" "}
                {c.trainerName ?? "Unassigned"} &middot; {c.durationMin} min
              </p>
            </div>

            <div className="text-right text-sm muted">
              <div>
                {c.spotsLeft} / {c.capacity} left
              </div>
              <div>
                {c.creditCost} credit{c.creditCost === 1 ? "" : "s"}
              </div>
            </div>

            <button
              className="btn btn-primary"
              disabled={!user || book.isPending}
              onClick={() => book.mutate({ classId: c.id })}
            >
              {c.full ? "Join waitlist" : "Book"}
            </button>
          </div>
        ))}
      </div>

      {!user && (
        <EmptyState>Sign in to book a class.</EmptyState>
      )}
    </div>
  );
}
