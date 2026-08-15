"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { NotificationBell } from "./NotificationBell";

type NavLink = { href: string; label: string };

const PUBLIC_LINKS: NavLink[] = [{ href: "/schedule", label: "Schedule" }];

const MEMBER_LINKS: NavLink[] = [
  { href: "/dashboard", label: "My bookings" },
  { href: "/waitlist", label: "Waitlist" },
];

const TRAINER_LINKS: NavLink[] = [
  { href: "/trainer/schedule", label: "My schedule" },
];

const ADMIN_LINKS: NavLink[] = [
  { href: "/admin", label: "Admin" },
  { href: "/admin/attendance", label: "Attendance" },
];

const STAFF_LINKS: NavLink[] = [{ href: "/kiosk", label: "Kiosk" }];

export function NavBar() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      router.push("/login");
    },
  });

  const links = [
    ...PUBLIC_LINKS,
    ...(user ? MEMBER_LINKS : []),
    ...(user?.role === "trainer" ? TRAINER_LINKS : []),
    ...(user?.role === "admin" ? ADMIN_LINKS : []),
    ...(user?.role === "admin" || user?.role === "trainer" ? STAFF_LINKS : []),
  ];

  return (
    <header className="border-b" style={{ borderColor: "var(--border)" }}>
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          FlexFit<span style={{ color: "var(--accent)" }}>.</span>
        </Link>

        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm muted hover:text-white"
          >
            {link.label}
          </Link>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {user && <NotificationBell />}
          {user ? (
            <>
              <span className="text-sm muted">{user.name}</span>
              <button
                className="btn"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
