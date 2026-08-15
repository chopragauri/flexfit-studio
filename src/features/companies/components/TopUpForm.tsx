"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ui/Alert";

export function TopUpForm({
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  isPending: boolean;
  error: { message: string } | null;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const parsed = Number.parseInt(amount, 10);
  const isValid = Number.isFinite(parsed) && parsed > 0;

  return (
    <form
      className="panel space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid) onSubmit(parsed);
      }}
    >
      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="top-up">
          Top Up Amount
        </label>
        <input
          id="top-up"
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: "var(--border)" }}
          type="number"
          min="1"
          value={amount}
          placeholder="Number of credits"
          disabled={isPending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      <ErrorAlert error={error} />

      <div className="flex gap-2">
        <button className="btn" type="submit" disabled={isPending || !isValid}>
          {isPending ? "Processing..." : "Top Up"}
        </button>
        <button
          className="btn-outline"
          type="button"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
