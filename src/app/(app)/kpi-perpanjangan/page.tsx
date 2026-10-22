import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseKpiPersonil } from "@/lib/kpiAccess";
import { getKpiMonitoringData } from "@/app/actions/kpi";
import { KpiTable } from "@/components/kpi/KpiTable";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { KpiSchemeHeader } from "@/components/kpi/KpiSchemeHeader";
import { KpiPageNav } from "@/components/kpi/KpiPageNav";
import { periodLabel } from "@/components/kpi/kpiUi";
import { SyncAbsensiButton } from "@/components/kpi/SyncAbsensiButton";
import { SyncCallActivityButton } from "@/components/kpi/SyncCallActivityButton";
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
 * Akses (2026-09-28): ADMIN melihat semua personil; MR/ASM/SM/NSM melihat diri
 * sendiri + bawahannya (pola sama seperti visibilitas POA — lihat
 * getSubordinateOwnerNips di getKpiMonitoringData). Mengedit (sync, input
 * manual) tetap ADMIN-only untuk v1, lihat `canEdit` di bawah.
 * Evaluasi kontrak (KpiContractEvaluation) belum dibangun — halaman ini baru
 * scorecard bulanan + input manual Call Activity/Absensi.
 */
const KPI_VIEWER_ROLES = ["ADMIN", "MR", "ASM", "SM", "NSM"].filter(canUseKpiPersonil);

export default async function KpiPerpanjanganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!KPI_VIEWER_ROLES.includes(session.role)) redirect("/summary");
  const canEdit = session.role === "ADMIN";

  const params = await searchParams;
  const periods = recentPeriods();
  // Default = last COMPLETED month (periods[1]): sales actual and visit data only land after a month ends.
  const period = params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : periods[1];

  const rows = await getKpiMonitoringData(period);
  const scoredCount = rows.filter((r) => r.totalScore != null).length;

  return (
    <div className="space-y-5">
      <KpiPageNav current="monitoring" role={session.role} />
      <KpiSchemeHeader
        scheme="hospital"
        subtitle={`${periodLabel(period)} · ${rows.length} personil · ${scoredCount} sudah lengkap 4 pilar`}
        controls={
          <>
            <KpiPeriodPicker periods={periods} period={period} />
            {canEdit && (
              <>
                <SyncCallActivityButton period={period} />
                <SyncAbsensiButton period={period} />
              </>
            )}
          </>
        }
      />

      <KpiDashboardStats rows={rows} />

      <KpiTable rows={rows} period={period} canEdit={canEdit} />
    </div>
  );
}
