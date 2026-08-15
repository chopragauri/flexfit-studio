"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyState } from "@/components/ui/PageState";

const MIN_QUERY_LENGTH = 3;

export function MemberSearch({
  linkedMemberIds,
  isPending,
  onLink,
  onDone,
}: {
  linkedMemberIds: number[];
  isPending: boolean;
  onLink: (userId: number) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data: results } = trpc.members.search.useQuery(
    { q: query },
    { enabled: query.length >= MIN_QUERY_LENGTH },
  );

  const linked = new Set(linkedMemberIds);
  const candidates = (results ?? []).filter((user) => !linked.has(user.id));

  return (
    <div className="panel space-y-3 p-4">
      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="member-search">
          Search Members
        </label>
        <input
          id="member-search"
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: "var(--border)" }}
          type="text"
          value={query}
          placeholder={`Search by name or email (${MIN_QUERY_LENGTH}+ chars)`}
          disabled={isPending}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {query.length >= MIN_QUERY_LENGTH && candidates.length === 0 && (
        <EmptyState>No unlinked members match that search.</EmptyState>
      )}

      {candidates.length > 0 && (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {candidates.map((user) => (
            <li
              key={user.id}
              className="flex items-center justify-between rounded border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex-1">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="muted text-xs">{user.email}</div>
              </div>
              <button
                className="btn btn-sm"
                disabled={isPending}
                onClick={() => onLink(user.id)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn-outline" type="button" disabled={isPending} onClick={onDone}>
        Done
      </button>
    </div>
  );
}
