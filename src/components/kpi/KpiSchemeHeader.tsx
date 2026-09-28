import Link from "next/link";

export type KpiScheme = "hospital" | "non-hospital";

const TABS: { scheme: KpiScheme; label: string; href: string; hint: string }[] = [
  { scheme: "hospital", label: "Hospital", href: "/kpi-perpanjangan", hint: "Monitoring skor bulanan" },
  { scheme: "non-hospital", label: "Non-Hospital", href: "/evaluasi-kontrak-non-hospital", hint: "Monitoring skor bulanan" },
];

/**
 * Shared header of the two KPI Perpanjangan pages — Hospital
 * (/kpi-perpanjangan) and Non-Hospital (/evaluasi-kontrak-non-hospital) are the
 * same feature under two scoring schemes, so they share one title and a tab
 * bar instead of being two unrelated menu entries. `controls` is the page's
 * own toolbar (period picker, sync/export buttons).
 */
export function KpiSchemeHeader({
  scheme, subtitle, controls,
}: {
  scheme: KpiScheme;
  subtitle: string;
  controls?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1>KPI Perpanjangan</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>{subtitle}</p>
        </div>
        {controls && <div className="flex flex-wrap items-start gap-2">{controls}</div>}
      </div>

      <nav aria-label="Skema KPI" className="flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map((t) => {
          const active = t.scheme === scheme;
          return (
            <Link
              key={t.scheme}
              href={t.href}
              aria-current={active ? "page" : undefined}
              title={t.hint}
              className="-mb-px flex flex-col border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              style={{
                borderColor: active ? "var(--color-blue)" : "transparent",
                color: active ? "var(--color-blue)" : "var(--color-text-muted)",
              }}
            >
              {t.label}
              <span className="text-[11px] font-normal" style={{ color: "var(--color-text-faint)" }}>{t.hint}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
