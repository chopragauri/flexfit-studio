"use client";

import { trpc } from "@/lib/trpc";
import { formatDate, formatDateTime } from "@/lib/format";
import { AccessDenied, EmptyState, LoadingState } from "@/components/ui/PageState";
import { StatTile } from "@/components/ui/StatTile";

export default function AdminAttendancePage() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: checkinsPerDay, isLoading: checkinsLoading } =
    trpc.attendance.checkinsPerDay.useQuery();
  const { data: topTrainers, isLoading: trainersLoading } =
    trpc.attendance.topTrainers.useQuery();
  const { data: noShowList, isLoading: noShowLoading } =
    trpc.attendance.noShowList.useQuery();

  const isLoading = checkinsLoading || trainersLoading || noShowLoading;

  if (user?.role !== "admin") return <AccessDenied audience="Admins" />;
  if (isLoading) return <LoadingState label="Loading attendance data..." />;

  const totalCheckins = (checkinsPerDay || []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="muted mt-1 text-sm">Last 14 days of check-ins and class attendance</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total Check-ins (14d)" value={totalCheckins} />
        <StatTile
          label="Top Trainer"
          value={topTrainers?.[0]?.trainerName ?? "N/A"}
        />
        <StatTile label="No-shows (14d)" value={noShowList?.length ?? 0} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Check-ins by Day (Last 14 Days)</h2>
        {checkinsPerDay && checkinsPerDay.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {checkinsPerDay.map((row) => (
              <div key={row.date} className="flex items-center justify-between p-3 text-sm">
                <span className="muted">{formatDate(row.date)}</span>
                <span className="font-medium">{row.count} check-ins</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No check-in data available.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Top Trainers by Attended Classes</h2>
        {topTrainers && topTrainers.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {topTrainers.map((trainer) => (
              <div key={trainer.trainerId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{trainer.trainerName}</div>
                    <div className="muted text-xs">{trainer.classCount} classes taught</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{trainer.attendedCount}</div>
                    <div className="muted text-xs">attendees</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No trainer data available.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">No-shows (Last 14 Days)</h2>
        {noShowList && noShowList.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {noShowList.map((item) => (
              <div key={item.bookingId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{item.memberName}</div>
                    <div className="muted text-xs">{item.memberEmail}</div>
                    <div className="muted text-xs mt-1">{item.className}</div>
                    <div className="muted text-xs">{formatDateTime(item.classDate)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No no-shows in the last 14 days.</EmptyState>
        )}
      </section>
    </div>
  );
}
