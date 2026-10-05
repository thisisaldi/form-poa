import Link from "next/link";

export type KpiPage = "leaderboard" | "detail" | "monitoring";

const PAGES: { key: KpiPage; label: string; hint: string; href: string; roles?: string[] }[] = [
  { key: "leaderboard", label: "Leaderboard", hint: "Semua orang · point saja", href: "/kpi-leaderboard" },
  { key: "detail", label: "Detail KPI", hint: "Khusus atasan · bawahan langsung", href: "/kpi-detail", roles: ["ADMIN", "SM", "NSM"] },
  { key: "monitoring", label: "Monitoring Bulanan", hint: "Skor per bulan · sync & input", href: "/kpi-perpanjangan", roles: ["ADMIN", "MR", "ASM", "SM", "NSM"] },
];

/**
 * Page switcher of the single "KPI Personil" menu entry (mockup `.pages`
 * buttons). Only shows pages the role may open; every page repeats its own
 * role check — this is navigation, not authorization.
 */
export function KpiPageNav({ current, role }: { current: KpiPage; role: string }) {
  const pages = PAGES.filter((p) => !p.roles || p.roles.includes(role));
  if (pages.length < 2) return null;
  return (
    <nav aria-label="Halaman KPI Personil" className="flex flex-wrap gap-2">
      {pages.map((p) => {
        const on = p.key === current;
        return (
          <Link
            key={p.key}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className="flex min-w-44 flex-col rounded-md border px-4 py-2 text-sm font-semibold"
            style={{
              borderColor: on ? "var(--color-blue)" : "var(--color-border)",
              background: on ? "var(--color-blue-light)" : "var(--color-surface)",
              color: on ? "var(--color-blue)" : "var(--color-text)",
            }}
          >
            {p.label}
            <span className="text-[11px] font-normal" style={{ color: "var(--color-text-faint)" }}>{p.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
