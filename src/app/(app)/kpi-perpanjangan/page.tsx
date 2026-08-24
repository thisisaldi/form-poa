import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getKpiMonitoringData } from "@/app/actions/kpi";
import { Card } from "@/components/ui/Card";
import { KpiTable } from "@/components/kpi/KpiTable";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { SyncAbsensiButton } from "@/components/kpi/SyncAbsensiButton";
import { KpiDashboardStats } from "@/components/kpi/KpiDashboardStats";

export const metadata = { title: "Monitoring KPI Perpanjangan · Form POA" };

/** Last 12 months (including current), newest first, "YYYY-MM". */
function recentPeriods(): string[] {
  const now = new Date();
  const periods: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

/**
 * Monitoring KPI Perpanjangan — scorecard bulanan (4 pilar berbobot) per
 * MR/SPV/ASM/SM, dasar rekomendasi perpanjangan kontrak. Sumber: Memo
 * Internal SM/ETH-II/PI/08.2026. Spec lengkap + asumsi kerja yang masih
 * perlu klarifikasi stakeholder: docs/kpi-monitoring/.
 *
 * v1 access: ADMIN-only (2026-07-30 decision), sama pola seperti /monitoring.
 * Evaluasi kontrak (KpiContractEvaluation) belum dibangun — halaman ini baru
 * scorecard bulanan + input manual Call Activity/Absensi.
 */
export default async function KpiPerpanjanganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/summary");

  const params = await searchParams;
  const periods = recentPeriods();
  const period = params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : periods[0];

  const rows = await getKpiMonitoringData(period);
  const scoredCount = rows.filter((r) => r.totalScore != null).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Monitoring KPI Perpanjangan</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {rows.length} personil (MR/ASM/SM) · {scoredCount} sudah lengkap 4 pilar · periode {period}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <KpiPeriodPicker periods={periods} period={period} />
          <SyncAbsensiButton period={period} />
        </div>
      </div>

      <Card>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Business Result (Sales, 50%) dan Market Development (Customer Expansion, 15%) dihitung otomatis dari
          data yang sudah ada. Activity &amp; Coverage (Call Activity, 25%) dan Attitude (Absensi, 10%) masih
          input manual — belum ada sumber data realisasi kunjungan/absensi di sistem manapun. Beberapa formula
          masih ASUMSI kerja, belum dikonfirmasi stakeholder — lihat{" "}
          <code className="text-[11px]">docs/kpi-monitoring/01-business-rules.md §7</code>.
        </p>
      </Card>

      <KpiDashboardStats rows={rows} />

      <KpiTable rows={rows} period={period} />
    </div>
  );
}
