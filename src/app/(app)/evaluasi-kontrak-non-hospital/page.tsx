import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getNonHospitalMonitoring } from "@/app/actions/nonHospitalEvaluation";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { KpiSchemeHeader } from "@/components/kpi/KpiSchemeHeader";
import { NhMonitoringTable } from "@/components/kpi/NhMonitoringTable";
import { SyncAbsensiButton } from "@/components/kpi/SyncAbsensiButton";
import { KpiPageNav } from "@/components/kpi/KpiPageNav";
import { periodLabel } from "@/components/kpi/kpiUi";
import { addMonths, periodOf } from "@/lib/nonHospitalScoring";

/** Last 12 months (including current), newest first, "YYYY-MM". */
function recentPeriods(): string[] {
  const now = periodOf(new Date());
  return Array.from({ length: 12 }, (_, i) => addMonths(now, -i));
}

/**
 * Monitoring KPI Non-Hospital (OMEGA) — bulanan, semua MR/ASM/SM aktif,
 * tanpa syarat data kontrak (akhir kontrak opsional, tampil bila ada).
 * Achievement 50%, Kunjungan 25%, SC Menang 15%, Absensi 10%. Spec:
 * docs/evaluasi-kontrak-non-hospital/. v1 ADMIN-only. Layar keputusan kontrak
 * lama (NhEvalTable) tidak dipakai lagi di halaman ini — tanpa data kontrak
 * tidak ada isinya.
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
  const periods = recentPeriods();
  // Default = last COMPLETED month: sales actual and visit data only land after a month ends.
  const period = params.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period) ? params.period : periods[1];

  const rows = await getNonHospitalMonitoring(period);

  return (
    <div className="space-y-5">
      <KpiPageNav current="monitoring" role={session.role} />
      <KpiSchemeHeader
        scheme="non-hospital"
        subtitle={`${periodLabel(period)} · ${rows.length} personil · Achievement / Kunjungan / SC Menang / Absensi`}
        controls={
          <>
            <KpiPeriodPicker periods={periods} period={period} basePath="/evaluasi-kontrak-non-hospital" />
            <SyncAbsensiButton period={period} scheme="non-hospital" />
          </>
        }
      />
      <NhMonitoringTable rows={rows} />
    </div>
  );
}
