"use client";

import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/lib/format";
import { isUnlimited } from "@/domain/booking-policy";
import { Alert, ErrorAlert } from "@/components/ui/Alert";
import { LoadingState } from "@/components/ui/PageState";

export default function PlansPage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const { data: plans, isLoading } = trpc.plans.list.useQuery({});

  const subscribe = trpc.plans.subscribe.useMutation({
    onSuccess: async () => {
      await utils.members.profile.invalidate();
      await utils.payments.mine.invalidate();
    },
  });

  if (isLoading) return <LoadingState label="Loading plans..." />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Membership plans</h1>

      <ErrorAlert error={subscribe.error} />

      {subscribe.isSuccess && <Alert tone="success">Membership activated.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans?.map((p) => (
          <div key={p.id} className="panel flex flex-col gap-3 p-5">
            <div>
              <h2 className="font-medium">{p.name}</h2>
              <p className="muted mt-1 text-sm">{p.description}</p>
            </div>

            <div className="text-2xl font-semibold">
              {formatMoney(p.priceCents)}
            </div>

            <p className="muted text-sm">
              {p.durationDays} days &middot;{" "}
              {isUnlimited(p.classCredits)
                ? "Unlimited classes"
                : `${p.classCredits} credits`}
            </p>

            <button
              className="btn btn-primary mt-auto"
              disabled={!user || subscribe.isPending}
              onClick={() => subscribe.mutate({ planId: p.id, method: "card" })}
            >
              {user ? "Subscribe" : "Sign in to subscribe"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
