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
  APPROVAL_USER_DOKTER: "Approval User/Dokter",
  FINALISASI: "Finalisasi",
};

export default async function PusatListPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const actor = await prisma.user.findUnique({ where: { nip: session.userId }, select: { isHka: true, role: true } });
  if (!actor || !canViewPusat(actor)) notFound();

  const rows = await listPusatAction();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>Standarisasi Pusat (HKA)</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Standarisasi per Grup RS. Jadi gateway standarisasi cabang untuk outlet di grup Hospital Key Account.
          </p>
        </div>
        {(actor.isHka || actor.role === "ADMIN") && (
          <Link href="/poa-standarisasi/pusat/new"><Button>+ Buat Standarisasi Pusat</Button></Link>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle>Pengajuan</CardTitle></CardHeader>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada pengajuan standarisasi pusat.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Grup", "Produk", "Dibuat oleh", "Tahap", ""].map((h) => (
                  <th key={h} className="pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 pr-3 font-semibold">{r.hkaGroup}</td>
                  <td className="py-3 pr-3 text-xs">{r.produk.join(", ")}</td>
                  <td className="py-3 pr-3">{r.ownerName}</td>
                  <td className="py-3 pr-3">{r.submittedAt ? "Final" : PHASE_LABEL[r.currentPhase]}</td>
                  <td className="py-3"><Link href={`/poa-standarisasi/pusat/${r.id}`}><Button size="sm" variant="secondary">Buka</Button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
