import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="muted">That page does not exist.</p>
      <Link href="/" className="btn">
        Back to the studio
      </Link>
    </div>
  );
}
