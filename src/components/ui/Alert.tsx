type AlertProps = {
  tone: "error" | "success";
  children: React.ReactNode;
};

/**
 * The error and success banners every page used to hand-roll.
 *
 * The markup is deliberately the same as the markup it replaces, down to the
 * colours: this component removes the duplication, not the design.
 */
export function Alert({ tone, children }: AlertProps) {
  return (
    <p
      className="panel p-3 text-sm"
      style={{ color: tone === "error" ? "var(--danger)" : "var(--success)" }}
    >
      {children}
    </p>
  );
}

/** Renders a tRPC mutation or query error, or nothing when there is none. */
export function ErrorAlert({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return <Alert tone="error">{error.message}</Alert>;
}
