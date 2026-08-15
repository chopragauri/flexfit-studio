"use client";

import type { RouterOutputs } from "@/lib/api-types";
import { EmptyState } from "@/components/ui/PageState";

type Company = RouterOutputs["adminCompanies"]["getById"];

export function LinkedMemberList({
  members,
  isPending,
  onUnlink,
}: {
  members: Company["members"];
  isPending: boolean;
  onUnlink: (companyMemberId: number) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="panel p-4 text-center">
        <EmptyState>No members linked yet</EmptyState>
      </div>
    );
  }

  return (
    <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
      {members.map((member) => (
        <div key={member.id} className="flex items-center gap-4 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium">{member.name}</div>
            <div className="muted text-xs">{member.email}</div>
          </div>
          <button
            className="btn-outline btn-sm btn-danger"
            disabled={isPending}
            onClick={() => onUnlink(member.companyMemberId)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
