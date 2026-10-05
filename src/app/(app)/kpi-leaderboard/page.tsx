import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getKpiLeaderboard } from "@/app/actions/kpi";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { KpiLeaderboardView } from "@/components/kpi/KpiLeaderboardView";
import { KpiPageNav } from "@/components/kpi/KpiPageNav";
import { periodLabel } from "@/components/kpi/kpiUi";
import { addMonths, periodOf } from "@/lib/nonHospitalScoring";

export const metadata = { title: "Leaderboard KPI Personil · Form POA" };

const SCHEMES = [
  { key: "hospital", label: "Hospital" },
  { key: "non-hospital", label: "Non-Hospital" },
] as const;

/**
 * Leaderboard KPI Personil — point saja, terbuka untuk SEMUA role login
 * (keputusan 2026-10-05, docs/kpi-monitoring/04-final-layout.md §2 + §7 Q1).
 * Rincian per orang tetap di /kpi-perpanjangan (scope bawahan).
 */
export default async function KpiLeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const params = await searchParams;
  const scheme = params.scheme === "non-hospital" ? "non-hospital" : "hospital";
  const now = periodOf(new Date());
  const periods = Array.from({ length: 12 }, (_, i) => addMonths(now, -i));
  // Default = last COMPLETED month: sales actual and visit data only land after a month ends.
  const period = params.period && periods.includes(params.period) ? params.period : periods[1];

  const { rows, unscored } = await getKpiLeaderboard(scheme, period);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1>Leaderboard KPI Personil</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {periodLabel(period)} · point saja, terbuka untuk semua. Rincian per orang ada di Detail KPI (khusus atasan).
          </p>
        </div>
        <KpiPeriodPicker periods={periods} period={period} basePath="/kpi-leaderboard" extraQuery={`scheme=${scheme}`} />
      </div>

      <KpiPageNav current="leaderboard" role={session.role} />

      <nav aria-label="Skema KPI" className="flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {SCHEMES.map((t) => {
          const active = t.key === scheme;
          return (
            <Link
              key={t.key}
              href={`/kpi-leaderboard?scheme=${t.key}&period=${period}`}
              aria-current={active ? "page" : undefined}
              className="-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              style={{ borderColor: active ? "var(--color-blue)" : "transparent", color: active ? "var(--color-blue)" : "var(--color-text-muted)" }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <KpiLeaderboardView key={`${scheme}-${period}`} scheme={scheme} rows={rows} unscored={unscored} />
    </div>
  );
}
