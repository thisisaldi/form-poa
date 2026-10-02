import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listVisiblePoaStandarisasiAction } from "@/app/actions/poaStandarisasi";
import { POA_STANDARISASI_VIEW_ROLES } from "@/lib/role";
import { PHASES } from "@/lib/poaStandarisasiPhases";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DeletePoaStandarisasiButton } from "@/components/poaStandarisasi/DeletePoaStandarisasiButton";

function formatTanggal(d: Date | string | null): string {
  return d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function formatPendek(d: Date | string): string {
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date | string) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY_MS);

type Tone = "green" | "red" | "amber" | "grey";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: "var(--color-status-approved-bg, #E6F5EC)", fg: "var(--color-status-approved, #008f42)" },
  red: { bg: "var(--color-error-bg, #FDECEA)", fg: "var(--color-error, #C0392B)" },
  amber: { bg: "#FBF3E3", fg: "#9A6F1B" },
  grey: { bg: "var(--color-bg-subtle, #F2EDE4)", fg: "var(--color-text-muted)" },
};

// Berjalan: target - hari ini. Sudah submit: target - tanggal submit (dibekukan).
function sisaTarget(target: Date | null, submittedAt: Date | null, today: Date): { text: string; tone: Tone; late: boolean } | null {
  if (!target) return null;
  if (submittedAt) {
    const d = diffDays(startOfDay(target), startOfDay(submittedAt));
    if (d > 0) return { text: `Selesai ${d} hari lebih cepat`, tone: "green", late: false };
    if (d === 0) return { text: "Selesai tepat waktu", tone: "green", late: false };
    return { text: `Selesai terlambat ${-d} hari`, tone: "red", late: false };
  }
  const d = diffDays(startOfDay(target), today);
  if (d < 0) return { text: `Terlambat ${-d} hari`, tone: "red", late: true };
  if (d === 0) return { text: "Jatuh tempo hari ini", tone: "red", late: true };
  return { text: `Sisa ${d} hari`, tone: d <= 7 ? "amber" : "grey", late: false };
}

export const metadata = { title: "POA Standarisasi · Form POA" };

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.id === phase)?.label ?? phase;
}

export default async function PoaStandarisasiListPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Dibuka ke role sales chain 2026-09-29 (user: "ikuti POA PSSP"), visibilitas dibatasi di listVisiblePoaStandarisasiAction.
  if (!POA_STANDARISASI_VIEW_ROLES.includes(session.role)) redirect("/dashboard");
  const canCreate = session.role === "ADMIN" || session.role === "MR";

  const pengajuanList = await listVisiblePoaStandarisasiAction();
  const today = startOfDay(new Date());
  const aktif = pengajuanList.filter((p: (typeof pengajuanList)[number]) => !p.submittedAt);
  const telat = aktif.filter((p: (typeof pengajuanList)[number]) => sisaTarget(p.estimasiTimelineSelesai, null, today)?.late).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>POA Standarisasi</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {canCreate ? "Pengajuan standarisasi yang sudah Anda buat." : "Pengajuan standarisasi tim Anda."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <>
              <a href="/api/poa-standarisasi/export">
                <Button size="sm" variant="ghost">↓ Export Excel</Button>
              </a>
              <Link href="/poa-standarisasi/new">
                <Button>+ Buat Standarisasi Baru</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{canCreate ? "Pengajuan Saya" : "Pengajuan"}</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full px-2.5 py-0.5" style={{ background: TONE.grey.bg, color: TONE.grey.fg }}><b>{pengajuanList.length}</b> pengajuan</span>
              <span className="rounded-full px-2.5 py-0.5" style={{ background: TONE.grey.bg, color: TONE.grey.fg }}><b>{aktif.length}</b> sedang berjalan</span>
              {telat > 0 && <span className="rounded-full px-2.5 py-0.5" style={{ background: TONE.red.bg, color: TONE.red.fg }}><b>{telat}</b> melewati target</span>}
            </div>
          </div>
        </CardHeader>
        {pengajuanList.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {canCreate ? "Belum ada pengajuan standarisasi. Buat yang pertama." : "Belum ada pengajuan standarisasi."}
            </p>
            {canCreate && (
              <Link href="/poa-standarisasi/new" className="mt-3 inline-block">
                <Button size="sm">+ Buat Standarisasi Baru</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Outlet</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Dokter</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Tahap</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Lama Proses</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Target Penyelesaian</th>
                  <th className="pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Tanggal KFT</th>
                  <th className="pb-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {pengajuanList.map((p: (typeof pengajuanList)[number]) => {
                  const jumlahGagal = p.produk.filter((prod: (typeof p.produk)[number]) => prod.standarisasiGagal).length;
                  const jumlahBerhasil = p.produk.length - jumlahGagal;
                  const sisa = sisaTarget(p.estimasiTimelineSelesai, p.submittedAt, today);
                  const lamaHari = Math.max(0, diffDays(p.submittedAt ? startOfDay(p.submittedAt) : today, startOfDay(p.createdAt)));
                  return (
                  <tr key={p.id}>
                    <td className="py-3 pr-3 align-top text-left" style={{ color: "var(--color-text)" }}>
                      <div className="font-semibold leading-snug">{p.outlet.namaOutlet}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        <span className="rounded px-1.5 py-px font-medium" style={{ background: TONE.grey.bg }}>
                          {p.tipeStandarisasi === "PERIODIC" ? "Periodic" : p.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic"}
                        </span>
                        <span>oleh {p.ownerName}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-top text-left text-xs" style={{ color: "var(--color-text)" }}>
                      {p.dokter.length === 0 ? (
                        <span style={{ color: "var(--color-text-faint)" }}>Belum dipilih</span>
                      ) : (
                        <>
                          <ul className="space-y-0.5">{p.dokter.slice(0, 2).map((d: string) => <li key={d}>{d}</li>)}</ul>
                          {p.dokter.length > 2 && (
                            <details className="mt-0.5" style={{ position: "relative" }}>
                              <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden" style={{ color: "var(--color-blue)" }}>
                                +{p.dokter.length - 2} dokter lainnya
                              </summary>
                              <ul className="absolute left-0 z-10 mt-1 w-64 space-y-1 rounded-md p-3 shadow-lg" style={{ background: "var(--color-surface, #fff)", border: "1px solid var(--color-border)" }}>
                                {p.dokter.map((d: string) => <li key={d}>{d}</li>)}
                              </ul>
                            </details>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top text-center">
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
                    <td className="py-3 pr-3 align-top text-center text-xs" style={{ position: "relative", color: "var(--color-text-muted)" }}>
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
                    <td className="py-3 pr-3 align-top text-center whitespace-nowrap">
                      <div className="font-semibold">{lamaHari === 0 ? "Hari ini" : `${lamaHari} hari`}</div>
                      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                        {p.submittedAt ? `Selesai ${formatPendek(p.submittedAt)}` : `Berjalan sejak ${formatPendek(p.createdAt)}`}
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-top text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      {formatTanggal(p.estimasiTimelineSelesai)}
                      {sisa && (
                        <div className="mt-1">
                          <span className="inline-block rounded-full px-2 py-0.5 font-medium" style={{ background: TONE[sisa.tone].bg, color: TONE[sisa.tone].fg }}>{sisa.text}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{formatTanggal(p.jadwalMeetingKft)}</td>
                    <td className="py-3 align-top text-center">
                      <div className="flex items-center justify-center gap-3">
                        {p.currentPhase === "PLANNING" && p.ownerId === session.userId && (
                          <DeletePoaStandarisasiButton pengajuanId={p.id} namaOutlet={p.outlet.namaOutlet} />
                        )}
                        <Link href={`/poa-standarisasi/${p.id}`} className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
                          {!p.submittedAt && p.ownerId === session.userId ? "Lanjutkan →" : "Detail"}
                        </Link>
                        <a href={`/api/poa-standarisasi/${p.id}/export`} className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>↓ Excel</a>
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
