"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { AccessDenied, EmptyState, LoadingState } from "@/components/ui/PageState";
import type { RouterOutputs } from "@/lib/api-types";

type TrainerClass = RouterOutputs["trainers"]["upcomingClasses"][number];

function ClassCard({ cls }: { cls: TrainerClass }) {
  return (
    <div className="p-3 text-sm">
      <div className="font-medium">{cls.name}</div>
      <div className="muted mt-1 text-xs">
        {formatDateTime(cls.startsAt)} &middot; {cls.room} &middot;{" "}
        {cls.durationMin} min
      </div>
      <div className="muted mt-2 text-xs">
        📊 {cls.bookedCount} booked · ✓ {cls.checkinCount} checked in
      </div>
      {cls.cancelled && (
        <div
          className="badge mt-1 inline-block"
          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
        >
          Cancelled
        </div>
      )}
    </div>
  );
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function TrainerSchedulePage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: classes, isLoading: classesLoading } =
    trpc.trainers.upcomingClasses.useQuery(undefined, {
      enabled: user?.role === "trainer",
    });
  const { data: availability, isLoading: availLoading } =
    trpc.trainers.availability.useQuery(undefined, {
      enabled: user?.role === "trainer",
    });

  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const setAvailability = trpc.trainers.setAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
      setEditingDay(null);
      setStartTime("");
      setEndTime("");
    },
  });

  const removeAvailability = trpc.trainers.removeAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
    },
  });

  if (user?.role !== "trainer") return <AccessDenied audience="Trainers" />;

  const isLoading = classesLoading || availLoading;

  const handleEditDay = (day: number) => {
    const existing = availability?.find((a) => a.dayOfWeek === day);
    setEditingDay(day);
    setStartTime(existing?.startTime || "");
    setEndTime(existing?.endTime || "");
  };

  const handleSave = () => {
    if (editingDay === null || !startTime || !endTime) return;
    setAvailability.mutate({
      dayOfWeek: editingDay,
      startTime,
      endTime,
    });
  };

  const handleRemove = (day: number) => {
    removeAvailability.mutate({ dayOfWeek: day });
  };

  if (isLoading) return <LoadingState />;

  const availabilityMap = new Map(
    availability?.map((a) => [a.dayOfWeek, a]) || [],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trainer Schedule</h1>
        <p className="muted mt-1 text-sm">Manage your availability and upcoming classes</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Upcoming Classes</h2>
        {classes && classes.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {classes.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </div>
        ) : (
          <EmptyState>No upcoming classes.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Weekly Availability</h2>
        <div className="space-y-2">
          {DAYS.map((day, idx) => {
            const avail = availabilityMap.get(idx);
            const isEditing = editingDay === idx;

            return (
              <div key={idx} className="panel p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{day}</div>
                    {avail && !isEditing && (
                      <div className="muted mt-1 text-sm">
                        {avail.startTime} - {avail.endTime}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="ml-4 flex gap-2">
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                        }}
                      />
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--fg)",
                        }}
                      />
                      <button
                        onClick={handleSave}
                        disabled={setAvailability.isPending || !startTime || !endTime}
                        className="btn btn-primary btn-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDay(null)}
                        className="btn btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="ml-4 flex gap-2">
                      <button
                        onClick={() => handleEditDay(idx)}
                        className="btn btn-sm"
                      >
                        {avail ? "Edit" : "Add"}
                      </button>
                      {avail && (
                        <button
                          onClick={() => handleRemove(idx)}
                          disabled={removeAvailability.isPending}
                          className="btn btn-sm"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "#ef4444",
                            borderColor: "var(--border)",
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
