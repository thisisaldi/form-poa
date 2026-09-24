import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getStandarisasiDashboardAction } from "@/app/actions/poaStandarisasi";
import { StandarisasiDashboardTable } from "@/components/poaStandarisasi/StandarisasiDashboardTable";

export const metadata = { title: "Monitoring POA Standarisasi · Form POA" };

export default async function StandarisasiDashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Semua role sales chain boleh (scope datanya dibatasi di action), tapi
  // Sales Support scope-nya cuma memo SP Non Sales.
  if (session.role === "SALES_SUPPORT") redirect("/sales-support");

  const { rows, canOpenDetail } = await getStandarisasiDashboardAction();

  const totalSudah = rows.reduce((n, r) => n + r.sudah.length, 0);
  const totalOnProgress = rows.reduce((n, r) => n + r.onProgress.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1>Monitoring POA Standarisasi</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Produk yang sudah standarisasi (pengajuan sudah final submit) dan yang masih on progress, per outlet.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Outlet" value={rows.length} />
        <SummaryCard label="Produk sudah standarisasi" value={totalSudah} color="var(--color-status-approved, #008f42)" />
        <SummaryCard label="Produk on progress" value={totalOnProgress} color="var(--color-orange, #ea580c)" />
      </div>

      <StandarisasiDashboardTable rows={rows} canOpenDetail={canOpenDetail} />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: color ?? "var(--color-text)" }}>{value}</div>
    </div>
  );
}
