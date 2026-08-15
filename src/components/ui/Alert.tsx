type AlertProps = {
  tone: "error" | "success";
  children: React.ReactNode;
};

/** The error and success banners that every page used to hand-roll. */
export function Alert({ tone, children }: AlertProps) {
  return (
    <div className={tone === "error" ? "alert alert-error" : "alert alert-success"}>
      {children}
    </div>
  );
}

/** Renders a tRPC mutation or query error, or nothing when there is none. */
export function ErrorAlert({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return <Alert tone="error">{error.message}</Alert>;
}
