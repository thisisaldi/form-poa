"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <IconHome />,
  },
  {
    href: "/poa/new",
    label: "New POA",
    icon: <IconPlus />,
    roles: ["MR"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: <IconCheck />,
    roles: ["ASM", "SM", "NSM"],
  },
  // Summary temporarily hidden for all roles — re-add roles to bring it back.
  // {
  //   href: "/summary",
  //   label: "Summary",
  //   icon: <IconChart />,
  //   roles: ["ASM", "SM", "NSM", "ADMIN"],
  // },
  // PM Dashboard temporarily hidden for all roles — re-add roles to bring it back.
  // {
  //   href: "/pm-dashboard",
  //   label: "PM Dashboard",
  //   icon: <IconTable />,
  //   roles: ["NSM", "ADMIN"],
  // },
  {
    href: "/admin",
    label: "Admin",
    icon: <IconTable />,
    roles: ["ADMIN"],
  },
];

interface SidebarProps {
  userRole: string;
  userName: string;
  userNip: string;
}

export function Sidebar({ userRole, userName, userNip }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  );

  const sidebarContent = (
    <>
      {/* Logo / Brand */}
      <div className="flex items-center justify-between border-b px-4 py-4" style={{ borderColor: "var(--color-border)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Pharos" className="h-7 w-auto" />
        {/* Close button — mobile only */}
        <button
          className="md:hidden p-1 rounded"
          style={{ color: "var(--color-text-muted)" }}
          onClick={() => setOpen(false)}
          aria-label="Tutup menu"
        >
          <IconX />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--color-blue-light)] text-[var(--color-blue)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
                  )}
                >
                  <span className="h-4 w-4 shrink-0">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Footer */}
      <div className="border-t px-4 py-4" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-xs font-medium truncate" style={{ color: "var(--color-text)" }}>{userName}</p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {userNip} · {userRole}
        </p>
        <form action="/api/auth/logout" method="POST" className="mt-2">
          <button
            type="submit"
            className="text-xs transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ──────────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center gap-3 border-b px-4"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          className="p-1.5 rounded"
          style={{ color: "var(--color-text-muted)" }}
        >
          <IconMenu />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Pharos" className="h-6 w-auto" />
      </div>

      {/* ── Mobile drawer backdrop ───────────────────────────────────────────── */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* ── Sidebar (drawer on mobile, sticky on desktop) ───────────────────── */}
      <aside
        className={cn(
          // desktop: sticky, always visible
          "md:sticky md:top-0 md:translate-x-0 md:flex md:h-screen md:w-56 md:flex-col md:border-r",
          // mobile: fixed drawer, slides in/out
          "fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col border-r transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

// ─── Inline Icons ─────────────────────────────────────────────────────────────

function IconMenu() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7A1 1 0 003 11h1v6a1 1 0 001 1h4v-4h2v4h4a1 1 0 001-1v-6h1a1 1 0 00.707-1.707l-7-7z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd" />
    </svg>
  );
}
