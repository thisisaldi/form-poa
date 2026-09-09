import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMyPoaStandarisasiAction } from "@/app/actions/poaStandarisasi";
import { PHASES } from "@/lib/poaStandarisasiPhases";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DeletePoaStandarisasiButton } from "@/components/poaStandarisasi/DeletePoaStandarisasiButton";

function formatTanggal(d: Date | string | null): string {
  return d ? new Date(d).toLocaleDateString("id-ID") : "—";
}

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
        <div className="flex items-center gap-2">
          <a href="/api/poa-standarisasi/export">
            <Button size="sm" variant="ghost">↓ Export Excel</Button>
          </a>
          <Link href="/poa-standarisasi/new">
            <Button>+ Buat Standarisasi Baru</Button>
          </Link>
        </div>
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
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target Penyelesaian</th>
                  <th className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Tanggal KFT</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {pengajuanList.map((p: (typeof pengajuanList)[number]) => {
                  const jumlahGagal = p.produk.filter((prod: (typeof p.produk)[number]) => prod.standarisasiGagal).length;
                  const jumlahBerhasil = p.produk.length - jumlahGagal;
                  return (
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
                    {/* Popover pakai <details> native (redline: kolom Produk clickable) — zero-JS, tapi absolutely-positioned di dalam wrapper overflow-x-auto tabel, jadi bisa kepotong kalau tabelnya sendiri lagi di-scroll horizontal. Cukup buat kasus normal (gak scroll), upgrade ke Popover berbasis portal kalau itu jadi masalah nyata. */}
                    <td className="py-3 pr-3 text-right text-xs" style={{ position: "relative", color: "var(--color-text-muted)" }}>
                      {p.produk.length === 0 ? (
                        0
                      ) : (
                        <details className="inline-block text-left">
                          <summary
                            className="inline-block cursor-pointer list-none text-right font-medium underline decoration-dotted [&::-webkit-details-marker]:hidden"
                            style={{ color: "var(--color-blue)" }}
                          >
                            {p.produk.length}
                          </summary>
                          <div
                            className="absolute right-0 z-10 mt-1 w-64 rounded-md p-3 text-xs shadow-lg"
                            style={{ background: "var(--color-surface, #fff)", border: "1px solid var(--color-border)" }}
                          >
                            <div className="mb-2 font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-faint)", fontSize: 10 }}>
                              {p.produk.length} Produk di Pengajuan Ini
                            </div>
                            <div className="space-y-1.5">
                              {p.produk.map((prod: (typeof p.produk)[number]) => (
                                <div key={prod.id} className="flex items-center justify-between gap-2">
                                  <span style={{ color: "var(--color-text)" }}>{prod.namaProduk}</span>
                                  <span
                                    className="shrink-0 rounded px-1.5 py-0.5 font-medium"
                                    style={{
                                      fontSize: 10,
                                      background: prod.standarisasiGagal ? "var(--color-error-bg, #FDECEA)" : "var(--color-status-approved-bg, #E6F5EC)",
                                      color: prod.standarisasiGagal ? "var(--color-error)" : "var(--color-status-approved, #008f42)",
                                    }}
                                  >
                                    {prod.standarisasiGagal ? "Gagal Standarisasi" : "Berhasil Standarisasi"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      )}
                      {p.submittedAt && p.produk.length > 0 && (
                        <div className="mt-0.5 font-normal" style={{ color: "var(--color-text-faint)" }}>
                          {jumlahBerhasil > 0 && <>✓ {jumlahBerhasil} produk berhasil standarisasi</>}
                          {jumlahBerhasil > 0 && jumlahGagal > 0 && <br />}
                          {jumlahGagal > 0 && <span style={{ color: "var(--color-error)" }}>✕ {jumlahGagal} produk gagal standarisasi</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-xs" style={{ color: "var(--color-text-muted)" }}>{formatTanggal(p.estimasiTimelineSelesai)}</td>
                    <td className="py-3 pr-3 text-xs" style={{ color: "var(--color-text-muted)" }}>{formatTanggal(p.jadwalMeetingKft)}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {p.currentPhase === "PLANNING" && (
                          <DeletePoaStandarisasiButton pengajuanId={p.id} namaOutlet={p.outlet.namaOutlet} />
                        )}
                        <Link href={`/poa-standarisasi/${p.id}`} className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
                          Detail
                        </Link>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
