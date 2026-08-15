"use client";

import { trpc } from "@/lib/trpc";
import { formatMoney, formatDate } from "@/lib/format";
import { EmptyState, LoadingState } from "@/components/ui/PageState";
import { StatTile } from "@/components/ui/StatTile";

export default function AdminReportsPage() {
  const { data: revenueByMonth, isLoading: monthLoading } =
    trpc.reports.revenueByMonth.useQuery();
  const { data: revenueByMethod, isLoading: methodLoading } =
    trpc.reports.revenueByMethod.useQuery();
  const { data: expiringMembers, isLoading: expiringLoading } =
    trpc.reports.expiringMemberships.useQuery();
  const { data: refundData, isLoading: refundLoading } =
    trpc.reports.refundCount.useQuery();

  const isLoading = monthLoading || methodLoading || expiringLoading || refundLoading;

  if (isLoading) return <LoadingState label="Loading reports..." />;

  const totalRevenue = (revenueByMonth || []).reduce(
    (sum, row) => sum + row.totalCents,
    0,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="muted mt-1 text-sm">Payment analytics and member insights</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total Revenue" value={formatMoney(totalRevenue)} />
        <StatTile label="Refunds Issued" value={refundData?.count ?? 0} />
        <StatTile
          label="Payment Methods"
          value={revenueByMethod?.length ?? 0}
        />
        <StatTile label="Expiring Soon" value={expiringMembers?.length ?? 0} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Revenue by Month</h2>
        {revenueByMonth && revenueByMonth.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {revenueByMonth.map((row) => (
              <div key={row.month} className="flex items-center justify-between p-3 text-sm">
                <span className="muted">{row.month}</span>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No revenue data available.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Revenue by Payment Method</h2>
        {revenueByMethod && revenueByMethod.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {revenueByMethod.map((row) => (
              <div key={row.method} className="flex items-center justify-between p-3 text-sm">
                <div className="flex-1">
                  <div className="capitalize">{row.method}</div>
                  <div className="muted text-xs">{row.count} transactions</div>
                </div>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No payment method data available.</EmptyState>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Memberships Expiring in 14 Days</h2>
        {expiringMembers && expiringMembers.length > 0 ? (
          <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
            {expiringMembers.map((member) => (
              <div key={member.memberId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{member.memberName}</div>
                    <div className="muted text-xs">{member.memberEmail}</div>
                  </div>
                  <div className="text-right">
                    <div className="muted text-xs">{member.planName}</div>
                    <div className="text-xs">{formatDate(member.expiresAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No memberships expiring in the next 14 days.</EmptyState>
        )}
      </section>
    </div>
  );
}
