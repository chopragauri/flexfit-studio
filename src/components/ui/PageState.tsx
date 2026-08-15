/** The "Loading..." and "nothing here" lines, in one place. */
export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="muted text-sm">{children}</p>;
}

export function AccessDenied({ audience }: { audience: string }) {
  return <p className="muted">Access denied. {audience} only.</p>;
}
