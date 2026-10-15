import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getStandarisasiDashboardAction } from "@/app/actions/poaStandarisasi";
import { StandarisasiDashboardTable } from "@/components/poaStandarisasi/StandarisasiDashboardTable";
import { Card } from "@/components/ui/Card";

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
  const totalProduk = totalSudah + totalOnProgress;
  const totalPengajuan = rows.reduce((n, r) => n + r.pengajuan.length, 0);
  const pengajuanSelesai = rows.reduce((n, r) => n + r.pengajuan.filter((p) => p.stage === "Selesai").length, 0);
  const allDpl = rows.flatMap((r) => r.dpl);
  const dplApproved = allDpl.filter((d) => d.status === "APPROVED").length;
  const dplPending = allDpl.filter((d) => d.status === "PENDING").length;
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Monitoring POA Standarisasi</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Pantau posisi tiap pengajuan, kapan aksi terakhir dilakukan, dan produk yang sudah standarisasi per outlet.
          </p>
        </div>
        {/* Export yang sama dengan halaman daftar POA Standarisasi (scope company-wide untuk VIEWER/GM/ADMIN/SD/SFE);
            gaya tombol mengikuti DashboardExportButton di dashboard POA Estimasi. */}
        <a
          href="/api/poa-standarisasi/export"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
        >
          ↓ Export Excel
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Outlet"
          value={rows.length}
          tone={TONE.blue}
          ratio={pct(pengajuanSelesai, totalPengajuan)}
          hint={`${totalPengajuan} pengajuan, ${pengajuanSelesai} sudah selesai`}
        />
        <StatCard
          label="Produk sudah standarisasi"
          value={totalSudah}
          tone={TONE.green}
          ratio={pct(totalSudah, totalProduk)}
          hint={`${pct(totalSudah, totalProduk)}% dari ${totalProduk} produk diajukan`}
        />
        <StatCard
          label="Produk on progress"
          value={totalOnProgress}
          tone={TONE.amber}
          ratio={pct(totalOnProgress, totalProduk)}
          hint="Pengajuan belum final submit"
        />
        <StatCard
          label="Request DPL/DPF"
          value={allDpl.length}
          tone={TONE.green}
          ratio={pct(dplApproved, allDpl.length)}
          hint={`${dplApproved} approved, ${dplPending} pending`}
        />
      </div>

      <StandarisasiDashboardTable rows={rows} canOpenDetail={canOpenDetail} />
    </div>
  );
}

/** Sama dengan TONE di halaman daftar POA Standarisasi. */
const TONE = {
  blue: { fg: "var(--color-blue)", bar: "var(--color-blue)" },
  green: { fg: "var(--color-status-approved)", bar: "var(--color-status-approved)" },
  amber: { fg: "#9A6F1B", bar: "var(--color-status-pending)" },
} as const;

/** Pola StatCard KPI (KpiDashboardStats): label, angka besar, bar tipis rasio, keterangan. */
function StatCard({ label, value, tone, ratio, hint }: { label: string; value: number; tone: { fg: string; bar: string }; ratio: number; hint: string }) {
  return (
    <Card className="p-4!">
      <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color: value ? tone.fg : "var(--color-text-faint)" }}>{value}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
        <div className="h-full rounded-full" style={{ width: `${ratio}%`, background: tone.bar }} />
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{hint}</p>
    </Card>
  );
}
