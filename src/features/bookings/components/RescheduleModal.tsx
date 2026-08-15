"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromBookingId: number;
  fromClassName: string;
  fromClassTime: string;
  onSuccess: () => void;
}

export function RescheduleModal({
  isOpen,
  onClose,
  fromBookingId,
  fromClassName,
  fromClassTime,
  onSuccess,
}: RescheduleModalProps) {
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Get available classes with the same name
  const { data: availableClasses } = trpc.classes.list.useQuery(
    {
      from: new Date().toISOString(),
    },
    {
      enabled: isOpen,
    }
  );

  // Filter to only same-name classes (excluding the original)
  const sameNameClasses = (availableClasses || []).filter(
    (cls) => cls.name === fromClassName
  );

  const reschedule = trpc.reschedules.reschedule.useMutation({
    onSuccess: async () => {
      await utils.bookings.mine.invalidate();
      await utils.bookings.waitlisted.invalidate();
      await utils.reschedules.history.invalidate();
      await utils.classes.list.invalidate();
      setSelectedClassId(null);
      onClose();
      onSuccess();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reschedule class"
      subtitle={`Moving: ${fromClassName} on ${formatDateTime(fromClassTime)}`}
      footer={
        <>
          <button className="btn" disabled={reschedule.isPending} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!selectedClassId || reschedule.isPending}
            onClick={() => {
              if (selectedClassId) {
                reschedule.mutate({ fromBookingId, toClassId: selectedClassId });
              }
            }}
          >
            {reschedule.isPending ? "Rescheduling..." : "Reschedule"}
          </button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {sameNameClasses.length ? (
          sameNameClasses.map((cls) => (
            <button
              key={cls.id}
              className="panel w-full p-3 text-left"
              disabled={reschedule.isPending}
              onClick={() => setSelectedClassId(cls.id)}
              style={{
                border:
                  selectedClassId === cls.id
                    ? "2px solid #3b82f6"
                    : "1px solid transparent",
              }}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{cls.name}</h3>
                {(cls.full || (cls.spotsLeft ?? 0) === 0) && (
                  <span className="badge badge-warning">Waitlist</span>
                )}
              </div>
              <p className="muted mt-1 text-xs">
                {formatDateTime(cls.startsAt)} &middot; {cls.room}
              </p>
            </button>
          ))
        ) : (
          <p className="muted py-4 text-center text-sm">
            No other {fromClassName} classes available
          </p>
        )}
      </div>
    </Modal>
  );
}
