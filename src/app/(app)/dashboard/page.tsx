import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisiblePoaFilter, getPendingActionFilter, canCreatePoa, canEdit } from "@/lib/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { Role, PoaForm as PoaFormType, User as UserType } from "@prisma/client";

export const metadata = { title: "Dashboard · Form POA" };

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp" + n.toLocaleString("id-ID");
}

type PoaWithMeta = PoaFormType & {
  owner: UserType;
  _count: { items: number };
  _totalEst: number;
  _dokterCount: number;
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = (await getCurrentUser())!;
  const actor = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!actor) return null;

  const params = await searchParams;
  const isMR = session.role === "MR";

  const [visibleFilter, pendingFilter, eligible] = await Promise.all([
    getVisiblePoaFilter(actor),
    Promise.resolve(getPendingActionFilter(actor)),
    isMR ? canCreatePoa(session.userId) : Promise.resolve(false),
  ]);

  const [recentRaw, pendingPoas] = await Promise.all([
    prisma.poaForm.findMany({
      where: visibleFilter,
      include: {
        owner: true,
        items: { select: { rencanaTotalBiaya: true, namaCust: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.poaForm.findMany({
      where: pendingFilter,
      include: { owner: true },
      orderBy: { updatedAt: "asc" },
      take: 5,
    }),
  ]);

  type RawItem = { rencanaTotalBiaya: { toString(): string }; namaCust: string };
  type RawPoa = typeof recentRaw[number] & { items: RawItem[] };

  // Compute per-POA aggregates
  const recentPoas: PoaWithMeta[] = (recentRaw as RawPoa[]).map((poa) => {
    const items = poa.items;
    const totalEst = items.reduce((s: number, it: RawItem) => s + parseFloat(it.rencanaTotalBiaya.toString()), 0);
    const dokterCount = new Set(items.map((it: RawItem) => it.namaCust)).size;
    return {
      ...poa,
      _count: { items: items.length },
      _totalEst: totalEst,
      _dokterCount: dokterCount,
    };
  });

  return (
    <div className="space-y-6">
      {params.error === "no_outlets" && (
        <div className="rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--color-warning-light, #fff7ed)", color: "var(--color-warning, #92400e)", border: "1px solid var(--color-warning-border, #fcd34d)" }}>
          Akun Anda belum memiliki outlet yang ditugaskan. Hubungi admin untuk mendapatkan akses.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
            Selamat datang, {session.name}
            <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
              style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
              {session.role}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMR && (
            <Link href="/customers/new"><Button variant="secondary" size="sm">+ Daftar User Baru</Button></Link>
          )}
          {isMR && eligible && (
            <Link href="/poa/new"><Button>+ Buat POA Baru</Button></Link>
          )}
        </div>
      </div>

      {!isMR && pendingPoas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Menunggu Tindakan Anda</CardTitle>
            <Link href="/approvals" className="text-xs" style={{ color: "var(--color-blue)" }}>
              Lihat semua →
            </Link>
          </CardHeader>
          <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {(pendingPoas as (PoaFormType & { owner: UserType })[]).map((poa) => (
              <li key={poa.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {poa.owner.name}
                    <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                      ({poa.owner.nip})
                    </span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    Periode: {poa.period}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={poa.status} />
                  <Link href={`/poa/${poa.id}`}>
                    <Button size="sm" variant="secondary">Review</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isMR ? "POA Saya" : "Semua POA"}</CardTitle>
        </CardHeader>
        {recentPoas.length === 0 ? (
          <EmptyState isMR={isMR} eligible={eligible} role={session.role as Role} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>User</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Update</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPoas.map((poa) => (
                  <tr key={poa.id}>
                    <td className="py-3">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{poa.owner.nip}</p>
                    </td>
                    <td className="py-3" style={{ color: "var(--color-text)" }}>{poa.period}</td>
                    <td className="py-3"><StatusBadge status={poa.status} /></td>
                    <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      {poa._totalEst > 0 ? formatRp(poa._totalEst) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {poa._dokterCount > 0 ? poa._dokterCount : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {poa._count.items > 0 ? poa._count.items : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(poa.updatedAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {canEdit(actor!, poa) && (
                          <Link href={`/poa/${poa.id}/edit`} className="text-xs font-medium"
                            style={{ color: "var(--color-text-muted)" }}>
                            Edit
                          </Link>
                        )}
                        <Link href={`/poa/${poa.id}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                          Detail
                        </Link>
                      </div>
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

function EmptyState({ isMR, eligible, role }: { isMR: boolean; eligible: boolean; role: Role }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {isMR
          ? "Belum ada POA. Buat POA pertama Anda."
          : `Belum ada POA yang perlu ditinjau sebagai ${role}.`}
      </p>
      {isMR && eligible && (
        <Link href="/poa/new" className="mt-3 inline-block">
          <Button size="sm">Buat POA</Button>
        </Link>
      )}
    </div>
  );
}
