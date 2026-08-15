"use client";

import { useEffect } from "react";
import { Alert } from "@/components/ui/Alert";

/**
 * The last line of defence for a render that throws. Internal details are
 * logged, never shown: the user gets the message and a way to retry.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <Alert tone="error">
        That page could not be loaded. If it keeps happening, the studio team can
        check the server logs{error.digest ? ` for ${error.digest}` : ""}.
      </Alert>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
