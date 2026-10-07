import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canViewPusat } from "@/lib/hka";
import { listPusatAction } from "@/app/actions/poaStandarisasiPusat";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";

export const metadata = { title: "Standarisasi Pusat · Form POA" };

const PHASE_LABEL: Record<string, string> = {
  APPROVAL_ATASAN: "Approval Atasan",
  APPROVAL_USER_DOKTER: "Approval User / Dokter",
  FINALISASI: "Finalisasi",
};

type Tone = "green" | "amber" | "grey";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: "var(--color-status-approved-bg, #E6F5EC)", fg: "var(--color-status-approved, #008f42)" },
  amber: { bg: "#FBF3E3", fg: "#9A6F1B" },
  grey: { bg: "var(--color-bg-subtle, #F2EDE4)", fg: "var(--color-text-muted)" },
};

const TH = "pb-3 pr-3 text-center text-xs font-medium uppercase tracking-wide whitespace-nowrap";

function formatTanggal(d: string): string {
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default async function PusatListPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const actor = await prisma.user.findUnique({ where: { nip: session.userId }, select: { isHka: true, role: true } });
  if (!actor || !canViewPusat(actor)) notFound();

  const rows = await listPusatAction();
  const canCreate = actor.isHka || actor.role === "ADMIN";
  const aktif = rows.filter((r) => !r.submittedAt).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/poa-standarisasi" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
            ← POA Standarisasi
          </Link>
          <h1 className="mt-1">Standarisasi Pusat</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Standarisasi per Grup RS oleh Hospital Key Account. Menjadi gateway standarisasi cabang untuk outlet di grup terkait.
          </p>
        </div>
        {canCreate && (
          <Link href="/poa-standarisasi/pusat/new"><Button>+ Buat Standarisasi Pusat</Button></Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <CardTitle>Pengajuan</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full px-2.5 py-0.5" style={{ background: TONE.grey.bg, color: TONE.grey.fg }}><b>{rows.length}</b> pengajuan</span>
              <span className="rounded-full px-2.5 py-0.5" style={{ background: TONE.grey.bg, color: TONE.grey.fg }}><b>{aktif}</b> sedang berjalan</span>
            </div>
          </div>
        </CardHeader>
        {rows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {canCreate ? "Belum ada standarisasi pusat. Buat yang pertama." : "Belum ada standarisasi pusat."}
            </p>
            {canCreate && (
              <Link href="/poa-standarisasi/pusat/new" className="mt-3 inline-block">
                <Button size="sm">+ Buat Standarisasi Pusat</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className={TH} style={{ color: "var(--color-text-faint)", textAlign: "left" }}>Grup RS</th>
                  <th className={TH} style={{ color: "var(--color-text-faint)", textAlign: "left" }}>Produk</th>
                  <th className={TH} style={{ color: "var(--color-text-faint)" }}>Tahap</th>
                  <th className={TH} style={{ color: "var(--color-text-faint)" }}>Dibuat</th>
                  <th className={TH.replace("pr-3", "")} style={{ color: "var(--color-text-faint)" }}>Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {rows.map((r) => {
                  const tone = TONE[r.submittedAt ? "green" : "amber"];
                  return (
                    <tr key={r.id}>
                      <td className="py-3 pr-3 align-top text-left">
                        <div className="font-semibold leading-snug">{r.hkaGroup}</div>
                        <div className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>oleh {r.ownerName}</div>
                      </td>
                      <td className="py-3 pr-3 align-top text-left text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {r.produk.join(", ")}
                      </td>
                      <td className="py-3 pr-3 align-top text-center">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>
                          {r.submittedAt ? "Final" : PHASE_LABEL[r.currentPhase]}
                        </span>
                      </td>
                      <td className="py-3 pr-3 align-top text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        {formatTanggal(r.submittedAt ?? r.createdAt)}
                      </td>
                      <td className="py-3 align-top text-center">
                        <Link href={`/poa-standarisasi/pusat/${r.id}`}><Button size="sm" variant="secondary">Buka</Button></Link>
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
