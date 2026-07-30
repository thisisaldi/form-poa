import { Card } from "@/components/ui/Card";
import type { KpiPersonnelRow } from "@/app/actions/kpi";

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const RECOMMENDATION_BANDS = [
  { months: 12, label: "Sangat Baik", color: "var(--color-success, #16a34a)" },
  { months: 9, label: "Baik", color: "var(--color-blue)" },
  { months: 6, label: "Perlu evaluasi", color: "var(--color-warning, #f59e0b)" },
  { months: 0, label: "Tidak direkomendasikan", color: "var(--color-red)" },
] as const;

/**
 * Dashboard ringkasan di atas tabel KPI — ADMIN testing view (2026-07-30
 * request): sekilas distribusi rekomendasi kontrak + rata-rata skor per
 * pilar, sebelum scroll ke tabel detail per personil.
 */
export function KpiDashboardStats({ rows }: { rows: KpiPersonnelRow[] }) {
  const scoredRows = rows.filter((r) => r.totalScore != null);
  const incompleteCount = rows.length - scoredRows.length;

  const avgTotal = avg(scoredRows.map((r) => r.totalScore!));
  const avgSales = avg(rows.map((r) => r.salesScore).filter((v): v is number => v != null));
  const avgActivity = avg(rows.map((r) => r.activityScore).filter((v): v is number => v != null));
  const avgCustomer = avg(rows.map((r) => r.customerScore));
  const avgAbsensi = avg(rows.map((r) => r.absensiScore).filter((v): v is number => v != null));

  const countByMonths = new Map<number, number>();
  for (const r of scoredRows) {
    const months = r.recommendation!.months;
    countByMonths.set(months, (countByMonths.get(months) ?? 0) + 1);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Rata-rata Total Score</p>
          <p className="mt-1 text-lg font-semibold">{avgTotal != null ? avgTotal.toFixed(2) : "-"}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            {scoredRows.length} lengkap · {incompleteCount} belum lengkap
          </p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Avg Sales (50%)</p>
          <p className="mt-1 text-lg font-semibold">{avgSales != null ? avgSales.toFixed(1) : "-"}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Avg Activity (25%)</p>
          <p className="mt-1 text-lg font-semibold">{avgActivity != null ? avgActivity.toFixed(1) : "-"}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Avg Customer (15%) / Absensi (10%)</p>
          <p className="mt-1 text-lg font-semibold">
            {avgCustomer != null ? avgCustomer.toFixed(1) : "-"} / {avgAbsensi != null ? avgAbsensi.toFixed(1) : "-"}
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap divide-x" style={{ borderColor: "var(--color-border)" }}>
          {RECOMMENDATION_BANDS.map((band) => (
            <div key={band.months} className="flex-1 min-w-[7rem] px-4 py-3">
              <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{band.months} bln — {band.label}</p>
              <p className="mt-1 text-lg font-semibold" style={{ color: band.color }}>
                {countByMonths.get(band.months) ?? 0}
              </p>
            </div>
          ))}
          <div className="flex-1 min-w-[7rem] px-4 py-3">
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum lengkap</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: "var(--color-text-faint)" }}>{incompleteCount}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
