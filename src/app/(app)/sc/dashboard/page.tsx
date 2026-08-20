import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NotReadyButton } from "@/components/ui/NotReadyButton";
import { DeletePoaScButton } from "@/components/sc/DeletePoaScButton";
import { formatCurrency as formatRp } from "@/lib/format";
import type { PoaStatus } from "@prisma/client";

export const metadata = { title: "Dashboard POA Sales Counter · Form POA" };

export default async function SalesCounterDashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  // Fetch all Sales Counter forms owned by this MR
  const scForms = await prisma.poaScForm.findMany({
    where: { ownerId: session.userId },
    include: {
      owner: true,
      products: { select: { rencanaTotalBiaya: true } },
      entertainItems: { select: { biayaEntertain: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Group forms by period
  const periodsMap = new Map<string, {
    period: string;
    status: PoaStatus;
    version: number;
    owner: typeof actor;
    _totalProd: number;
    _totalEnt: number;
    _grandTotal: number;
    _outletCount: number;
    updatedAt: Date;
  }>();

  for (const f of scForms) {
    const totalProd = f.products.reduce((sum: number, p: any) => sum + (parseFloat(p.rencanaTotalBiaya.toString()) || 0), 0);
    const totalEnt = f.entertainItems.reduce((sum: number, e: any) => sum + (parseFloat(e.biayaEntertain.toString()) || 0), 0);
    const fEst = totalProd + totalEnt;

    const existing = periodsMap.get(f.period);
    if (existing) {
      existing._totalProd += totalProd;
      existing._totalEnt += totalEnt;
      existing._grandTotal += fEst;
      existing._outletCount += 1;
      if (f.updatedAt > existing.updatedAt) {
        existing.updatedAt = f.updatedAt;
      }
      // Keep lowest/most active status to show progress
      if (f.status === "DRAFT" || (f.status === "SUBMITTED_TO_ASM" && existing.status !== "DRAFT")) {
        existing.status = f.status;
      }
    } else {
      periodsMap.set(f.period, {
        period: f.period,
        status: f.status,
        version: f.version,
        owner: f.owner,
        _totalProd: totalProd,
        _totalEnt: totalEnt,
        _grandTotal: fEst,
        _outletCount: 1,
        updatedAt: f.updatedAt,
      });
    }
  }

  const recentPeriods = [...periodsMap.values()].sort((a, b) => b.period.localeCompare(a.period));

  return (
    <div className="space-y-6">
      {/* Header — static, renders immediately */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
          Selamat datang, <span className="font-semibold uppercase">{actor.name}</span>
          <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
            MR
          </span>
        </p>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-end gap-2">
        <NotReadyButton label="+ Daftar User Baru" message="Fitur Daftar Dokter Baru masih dalam pengembangan." />
        <Link href="/sc/new">
          <Button>+ Buat POA Baru</Button>
        </Link>
      </div>

      {/* Main Period Draft List */}
      <Card>
        <CardHeader>
          <CardTitle>POA Saya</CardTitle>
        </CardHeader>

        {recentPeriods.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Belum ada POA. Buat POA pertama Anda.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto p-5 pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--color-border)" }}>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Period</th>
                  <th className="pb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Ratio %</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>% Budget</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPeriods.map((p) => {
                  const isDraft = p.status === "DRAFT";
                  const isRevisi = p.status === "REVISI";
                  return (
                    <tr key={p.period} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20">
                      <td className="py-3">
                        <p className="font-medium" style={{ color: "var(--color-text)" }}>{p.owner.name}</p>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{p.owner.nip}</p>
                      </td>
                      <td className="py-3 font-medium" style={{ color: "var(--color-text)" }}>{p.period}</td>
                      <td className="py-3">
                        <StatusBadge status={p.status} version={p.version} />
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                        -
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                        {p._grandTotal > 0 ? formatRp(p._grandTotal) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>
                        -
                      </td>
                      <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>
                        -
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {(isDraft || isRevisi) && (
                            <Link href={`/sc/${p.period}/edit`} className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                              Tambah
                            </Link>
                          )}
                          <Link href={`/sc/${p.period}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                            Detail
                          </Link>
                          {isDraft && (
                            <DeletePoaScButton period={p.period} />
                          )}
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
