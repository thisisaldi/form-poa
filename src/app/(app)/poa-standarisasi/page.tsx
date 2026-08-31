import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMyPoaStandarisasiAction } from "@/app/actions/poaStandarisasi";
import { PHASES } from "@/lib/poaStandarisasiPhases";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";

export const metadata = { title: "POA Standarisasi · Form POA" };

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.id === phase)?.label ?? phase;
}

export default async function PoaStandarisasiListPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Re-disabled for non-ADMIN 2026-08-28 (user request) — was briefly opened
  // to MR same day, ADMIN-only again while under review.
  if (session.role !== "ADMIN") redirect("/dashboard");

  const pengajuanList = await listMyPoaStandarisasiAction();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>POA Standarisasi</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Pengajuan standarisasi yang sudah Anda buat.
          </p>
        </div>
        <Link href="/poa-standarisasi/new">
          <Button>+ Buat Standarisasi Baru</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Pengajuan Saya</CardTitle></CardHeader>
        {pengajuanList.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Belum ada pengajuan standarisasi. Buat yang pertama.
            </p>
            <Link href="/poa-standarisasi/new" className="mt-3 inline-block">
              <Button size="sm">+ Buat Standarisasi Baru</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Outlet</th>
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Tipe</th>
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Tahap</th>
                  <th className="pb-3 pr-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Dibuat</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {pengajuanList.map((p: (typeof pengajuanList)[number]) => (
                  <tr key={p.id}>
                    <td className="py-3 pr-3" style={{ color: "var(--color-text)" }}>{p.outlet.namaOutlet}</td>
                    <td className="py-3 pr-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {p.tipeStandarisasi === "PERIODIC" ? "Periodic" : p.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic"}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
                        style={{
                          background: p.submittedAt ? "var(--color-status-approved-bg, #E6F5EC)" : "var(--color-blue-light)",
                          color: p.submittedAt ? "var(--color-status-approved, #008f42)" : "var(--color-blue)",
                        }}
                      >
                        {p.submittedAt ? "Sudah Disubmit" : phaseLabel(p.currentPhase)}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right text-xs" style={{ color: "var(--color-text-muted)" }}>{p.produk.length}</td>
                    <td className="py-3 pr-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(p.createdAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="py-3 text-right">
                      <Link href={`/poa-standarisasi/${p.id}`} className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
