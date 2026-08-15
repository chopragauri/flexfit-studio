"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ErrorAlert } from "@/components/ui/Alert";
import { LoadingState } from "@/components/ui/PageState";
import { CorporateBookingList } from "@/features/companies/components/CorporateBookingList";
import { LinkedMemberList } from "@/features/companies/components/LinkedMemberList";
import { MemberSearch } from "@/features/companies/components/MemberSearch";
import { TopUpForm } from "@/features/companies/components/TopUpForm";

export default function CompanyDetailsPage() {
  const params = useParams();
  const id = Number.parseInt(String(params.id), 10);
  const isValidId = Number.isInteger(id);

  const [openPanel, setOpenPanel] = useState<"topUp" | "addMember" | null>(null);

  const {
    data: company,
    isLoading,
    error,
    refetch,
  } = trpc.adminCompanies.getById.useQuery(
    { id },
    { enabled: isValidId, retry: false },
  );

  const refresh = () => refetch();

  const topUp = trpc.adminCompanies.topUp.useMutation({
    onSuccess: () => {
      setOpenPanel(null);
      refresh();
    },
  });
  const setActive = trpc.adminCompanies.updateActive.useMutation({
    onSuccess: refresh,
  });
  const linkMember = trpc.adminCompanies.linkMember.useMutation({
    onSuccess: refresh,
  });
  const unlinkMember = trpc.adminCompanies.unlinkMember.useMutation({
    onSuccess: refresh,
  });

  if (!isValidId) return <p className="muted">Company not found</p>;
  if (isLoading) return <LoadingState />;
  if (error) return <p className="muted">{error.message}</p>;
  if (!company) return <p className="muted">Company not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {company.name}
          </h1>
          <p className="muted text-sm">{company.contactEmail}</p>
        </div>
        <button
          className={company.active ? "btn btn-danger btn-sm" : "btn btn-sm"}
          disabled={setActive.isPending}
          onClick={() => setActive.mutate({ id, active: !company.active })}
        >
          {company.active ? "Deactivate" : "Activate"}
        </button>
      </div>

      <ErrorAlert error={setActive.error} />
      <ErrorAlert error={linkMember.error} />
      <ErrorAlert error={unlinkMember.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTileWithAction
          label="Credit Pool Balance"
          value={company.creditPoolBalance}
          action="Top Up"
          onAction={() => setOpenPanel(openPanel === "topUp" ? null : "topUp")}
        />

        <StatTileWithAction
          label="Linked Members"
          value={company.members.length}
          action="Add Member"
          onAction={() =>
            setOpenPanel(openPanel === "addMember" ? null : "addMember")
          }
        />
      </div>

      {openPanel === "topUp" && (
        <TopUpForm
          isPending={topUp.isPending}
          error={topUp.error}
          onSubmit={(amount) => topUp.mutate({ id, amount })}
          onCancel={() => setOpenPanel(null)}
        />
      )}

      {openPanel === "addMember" && (
        <MemberSearch
          linkedMemberIds={company.members.map((member) => member.id)}
          isPending={linkMember.isPending}
          onLink={(userId) => linkMember.mutate({ companyId: id, userId })}
          onDone={() => setOpenPanel(null)}
        />
      )}

      <section className="space-y-3">
        <h2 className="font-medium">
          Linked Members ({company.members.length})
        </h2>
        <LinkedMemberList
          members={company.members}
          isPending={unlinkMember.isPending}
          onUnlink={(companyMemberId) =>
            unlinkMember.mutate({ companyMemberId })
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent Corporate Bookings</h2>
        <CorporateBookingList bookings={company.recentBookings} />
      </section>
    </div>
  );
}

function StatTileWithAction({
  label,
  value,
  action,
  onAction,
}: {
  label: string;
  value: React.ReactNode;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="panel p-4">
      <div className="muted mb-2 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <button className="btn btn-sm mt-3" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
