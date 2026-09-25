import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getNonHospitalEvaluation } from "@/app/actions/nonHospitalEvaluation";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { NhEvalStats } from "@/components/kpi/NhEvalStats";
import { NhEvalTable } from "@/components/kpi/NhEvalTable";
import { periodLabel } from "@/components/kpi/kpiUi";
import { addMonths, periodOf } from "@/lib/nonHospitalScoring";

/** Contract-end months offered in the picker: 3 ahead of now down to 8 back, newest first. */
function endPeriods(): string[] {
  const now = periodOf(new Date());
  return Array.from({ length: 12 }, (_, i) => addMonths(now, 3 - i));
}

/**
 * Evaluasi Kontrak Non-Hospital — layar evaluasi kontrak per bulan berakhirnya
 * kontrak (skema Non-Hospital: Achievement Target 50%, Kunjungan 25%, SC Menang
 * 15%, Absensi 10%). Spec: docs/evaluasi-kontrak-non-hospital/. v1 ADMIN-only.
 */
export default async function EvaluasiKontrakNonHospitalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/summary");

  const params = await searchParams;
  const periods = endPeriods();
  // Default = next month: the contracts that need a decision now.
  const period = params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : periods[2];

  const rows = await getNonHospitalEvaluation(period);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1>Evaluasi Kontrak Non-Hospital</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Kontrak berakhir {periodLabel(period)} · {rows.length} personil · PSR / Supervisor / Area Manager / Manager
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <KpiPeriodPicker periods={periods} period={period} basePath="/evaluasi-kontrak-non-hospital" />
          <a
            href={`/api/export/non-hospital-evaluation?period=${period}`}
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            Export Excel
          </a>
        </div>
      </div>

      <NhEvalStats rows={rows} periodText={periodLabel(period)} />
      <NhEvalTable rows={rows} akhirPeriod={period} />
    </div>
  );
}
