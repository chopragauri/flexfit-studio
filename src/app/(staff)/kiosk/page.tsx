"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import type { RouterOutputs } from "@/lib/api-types";
import { AccessDenied, EmptyState, LoadingState } from "@/components/ui/PageState";

type FoundMember = RouterOutputs["members"]["lookupByEmailOrPhone"];

const MIN_QUERY_LENGTH = 3;
const LOOKAHEAD_HOURS = 2;
const CONFIRMATION_MS = 3000;

export default function KioskPage() {
  const { data: user } = trpc.auth.me.useQuery();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoundMember | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const lookup = trpc.members.lookupByEmailOrPhone.useQuery(
    { query },
    { enabled: query.length >= MIN_QUERY_LENGTH, retry: false },
  );

  const upcoming = trpc.bookings.upcomingForMember.useQuery(
    { userId: selected?.id ?? 0, hoursAhead: LOOKAHEAD_HOURS },
    { enabled: selected !== null },
  );

  const details = trpc.members.byId.useQuery(
    { id: selected?.id ?? 0 },
    { enabled: selected !== null },
  );

  const checkIn = trpc.bookings.markAttended.useMutation({
    onSuccess: (_result, variables) => {
      const booked = upcoming.data?.find(
        (row) => row.bookingId === variables.bookingId,
      );
      if (!booked || !selected) return;

      setConfirmation(`${selected.name} checked in to ${booked.className}`);
      upcoming.refetch();
      setTimeout(() => {
        setConfirmation(null);
        setQuery("");
        setSelected(null);
      }, CONFIRMATION_MS);
    },
  });

  if (user?.role !== "admin" && user?.role !== "trainer") {
    return <AccessDenied audience="Staff" />;
  }

  // The most recent membership is the first row; byId orders by start date.
  const latestMembership = details.data?.memberships?.[0];
  const membershipExpired = latestMembership
    ? new Date(latestMembership.endDate) < new Date()
    : false;
  const outOfCredits = latestMembership?.creditsRemaining === 0;
  const blocked = membershipExpired || outOfCredits;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check-in Kiosk</h1>
        <p className="muted mt-1 text-sm">
          Look up a member and check them in to upcoming classes
        </p>
      </div>

      {confirmation && (
        <div
          className="rounded border p-4"
          style={{
            borderColor: "#16a34a",
            background: "#064e3b",
            color: "#bbf7d0",
          }}
        >
          <div className="font-medium">✓ Check-in successful</div>
          <div className="muted mt-1 text-sm">{confirmation}</div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Find Member</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Email or phone number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--fg)",
            }}
          />
        </div>

        {lookup.isLoading && <p className="muted text-sm">Searching...</p>}
        {lookup.error && (
          <p className="text-sm" style={{ color: "#ef4444" }}>
            Member not found
          </p>
        )}

        {lookup.data && !selected && (
          <div className="panel flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{lookup.data.name}</div>
              <div className="muted mt-1 text-xs">{lookup.data.email}</div>
              {lookup.data.phone && (
                <div className="muted text-xs">{lookup.data.phone}</div>
              )}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setSelected(lookup.data)}
            >
              Select
            </button>
          </div>
        )}
      </section>

      {selected && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Member: {selected.name}</h2>
            <button
              className="btn btn-sm"
              onClick={() => {
                setSelected(null);
                setQuery("");
              }}
            >
              Change member
            </button>
          </div>

          <MembershipWarning show={membershipExpired}>
            ⚠ Membership has expired
          </MembershipWarning>
          <MembershipWarning show={outOfCredits}>
            ⚠ No credits remaining
          </MembershipWarning>

          <ClassesToCheckIn
            classes={upcoming.data}
            isLoading={upcoming.isLoading}
            disabled={checkIn.isPending || blocked}
            onCheckIn={(bookingId) =>
              checkIn.mutate({ bookingId, source: "kiosk" })
            }
          />
        </section>
      )}
    </div>
  );
}

function ClassesToCheckIn({
  classes,
  isLoading,
  disabled,
  onCheckIn,
}: {
  classes: RouterOutputs["bookings"]["upcomingForMember"] | undefined;
  isLoading: boolean;
  disabled: boolean;
  onCheckIn: (bookingId: number) => void;
}) {
  if (isLoading) return <LoadingState label="Loading classes..." />;
  if (!classes?.length) {
    return (
      <EmptyState>No classes in the next {LOOKAHEAD_HOURS} hours</EmptyState>
    );
  }

  return (
    <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
      {classes.map((cls) => (
        <div key={cls.bookingId} className="flex items-center justify-between p-4">
          <div className="flex-1">
            <div className="font-medium">{cls.className}</div>
            <div className="muted mt-1 text-sm">
              {formatDateTime(cls.startsAt)} &middot; {cls.room} &middot;{" "}
              {cls.durationMin} min
            </div>
            {cls.trainerName && (
              <div className="muted mt-1 text-xs">
                Trainer: {cls.trainerName}
              </div>
            )}
          </div>
          <button
            className="btn btn-primary btn-sm ml-4"
            disabled={disabled}
            onClick={() => onCheckIn(cls.bookingId)}
          >
            Check in
          </button>
        </div>
      ))}
    </div>
  );
}

/** The red banner the kiosk shows above the class list. */
function MembershipWarning({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div
      className="rounded border p-3 text-sm"
      style={{
        borderColor: "#dc2626",
        background: "#7f1d1d",
        color: "#fca5a5",
      }}
    >
      {children}
    </div>
  );
}
