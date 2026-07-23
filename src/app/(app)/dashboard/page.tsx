import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisiblePoaFilter, getPendingActionFilter, canCreatePoa, canEdit } from "@/lib/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { NotReadyButton } from "@/components/ui/NotReadyButton";
import { DeletePoaButton } from "@/components/poa/DeletePoaButton";
import type { Role, PoaForm as PoaFormType, User as UserType, PoaStatus } from "@prisma/client";

export const metadata = { title: "Dashboard · Form POA" };

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

type PoaWithMeta = PoaFormType & {
  owner: UserType;
  _count: { items: number };
  _totalEst: number;
  _dokterCount: number;
  _ratioEstimasi: number | null;  // totalEst / target * 100 (null if no target)
  _pctBudget: number | null;       // weighted avg budget % (0-100), null if no items
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
    // Not MR-only anymore — an ASM/SM/NSM with a vacant team is eligible too
    // (see canCreatePoa in authz.ts).
    canCreatePoa(session.userId),
  ]);

  const [recentRaw, pendingPoas] = await Promise.all([
    prisma.poaForm.findMany({
      where: visibleFilter,
      include: {
        owner: true,
        items: {
          select: {
            rencanaTotalBiaya: true,
            namaCust: true,
            persenPsspDokter: true, persenDiskon: true,
            persenDp: true, persenListingFee: true, persenEntertain: true, pengaliNilaiR: true,
          },
        },
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

  type RawItem = {
    rencanaTotalBiaya: { toString(): string };
    namaCust: string;
    persenPsspDokter: { toString(): string } | null;
    persenDiskon: { toString(): string } | null;
    persenDp: { toString(): string } | null;
    persenListingFee: { toString(): string } | null;
    persenEntertain: { toString(): string } | null;
    pengaliNilaiR: { toString(): string } | null;
  };
  type RawPoa = typeof recentRaw[number] & { items: RawItem[] };

  // Compute per-POA aggregates
  const toNum = (v: { toString(): string } | null | undefined) => parseFloat((v ?? "0").toString()) || 0;

  const recentPoas: PoaWithMeta[] = (recentRaw as RawPoa[]).map((poa) => {
    const items = poa.items;
    const totalEst = items.reduce((s: number, it: RawItem) => s + toNum(it.rencanaTotalBiaya), 0);
    const dokterCount = new Set(items.map((it: RawItem) => it.namaCust)).size;

    // Ratio % = totalEst / target
    const target = poa.target ? parseFloat(poa.target.toString()) : null;
    const ratioEstimasi = target != null && target > 0 ? (totalEst / target) * 100 : null;

    // Weighted budget percentage
    let budgetSum = 0;
    for (const it of items) {
      const est = toNum(it.rencanaTotalBiaya);
      const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      const pct = toNum(it.persenPsspDokter) * pengaliNilaiR + toNum(it.persenDiskon)
        + toNum(it.persenDp) + toNum(it.persenListingFee) + toNum(it.persenEntertain);
      budgetSum += est * pct;
    }
    const pctBudget = totalEst > 0 ? (budgetSum / totalEst) * 100 : null;

    return {
      ...poa,
      _count: { items: items.length },
      _totalEst: totalEst,
      _dokterCount: dokterCount,
      _ratioEstimasi: ratioEstimasi,
      _pctBudget: pctBudget,
    };
  });

  const editablePoaIds = new Set(
    (await Promise.all(recentPoas.map(async (poa) => ((await canEdit(actor, poa)) ? poa.id : null))))
      .filter((id): id is string => id !== null)
  );

  // ── MR progress stats (non-MR only) ─────────────────────────────────────────

  interface MrGroupStat {
    groupNip: string;
    groupName: string;
    groupRole: string;
    mrNips: string[];
    submittedNips: Set<string>;
  }

  let mrProgressPeriod: string | null = null;
  let mrGroups: MrGroupStat[] = [];

  if (!isMR) {
    // Direct subordinates of the actor
    const directSubs = await prisma.user.findMany({
      where: { nipAtasan: actor.nip, isActive: true },
      select: { nip: true, name: true, role: true },
      orderBy: { name: "asc" },
    }) as { nip: string; name: string; role: string }[];

    // For each direct sub, get MR nips under them (or themselves if they're MRs)
    const groupsRaw: { nip: string; name: string; role: string; mrNips: string[] }[] = [];
    for (const sub of directSubs) {
      if (sub.role === "MR") {
        groupsRaw.push({ ...sub, mrNips: [sub.nip] });
      } else {
        // Get MRs 1 level deeper (ASM→MRs or SM→ASM→MRs would need 2 levels)
        const depth = sub.role === "ASM" ? 1 : sub.role === "SM" ? 2 : 1;
        async function getMrsUnder(managerNip: string, d: number): Promise<string[]> {
          if (d === 0) return [];
          const reports = await prisma.user.findMany({
            where: { nipAtasan: managerNip, isActive: true },
            select: { nip: true, role: true },
          }) as { nip: string; role: string }[];
          const nips: string[] = [];
          for (const r of reports) {
            if (r.role === "MR") nips.push(r.nip);
            else nips.push(...await getMrsUnder(r.nip, d - 1));
          }
          return nips;
        }
        const mrNips = await getMrsUnder(sub.nip, depth);
        groupsRaw.push({ ...sub, mrNips });
      }
    }

    // Get latest period across all MR POAs
    const allMrNips = [...new Set(groupsRaw.flatMap(g => g.mrNips))];
    if (allMrNips.length > 0) {
      const periodRow = await prisma.poaForm.findFirst({
        where: { ownerId: { in: allMrNips } },
        orderBy: { period: "desc" },
        select: { period: true },
      });
      mrProgressPeriod = periodRow?.period ?? null;

      if (mrProgressPeriod) {
        const submittedRows = await prisma.poaForm.findMany({
          where: {
            ownerId: { in: allMrNips },
            period: mrProgressPeriod,
            status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] },
          },
          select: { ownerId: true },
        }) as { ownerId: string }[];
        const submittedNips = new Set(submittedRows.map(r => r.ownerId));

        // Every direct subordinate shows, even ones with zero MRs under them
        // (e.g. an ASM whose team is genuinely empty) — previously filtered
        // out entirely, hiding that the ASM exists with nobody assigned yet.
        mrGroups = groupsRaw
          .map(g => ({
            groupNip: g.nip,
            groupName: g.name,
            groupRole: g.role,
            mrNips: g.mrNips,
            submittedNips: new Set(g.mrNips.filter(n => submittedNips.has(n))),
          }));
      }
    }
  }

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
            <NotReadyButton label="+ Daftar User Baru" message="Fitur Daftar Dokter Baru masih dalam pengembangan." />
          )}
          {eligible && (
            <Link href="/poa/new"><Button>+ Buat POA Baru</Button></Link>
          )}
          {!isMR && (
            <a href={mrProgressPeriod ? `/api/export/team?period=${mrProgressPeriod}` : "/api/export/team"}>
              <Button variant="secondary" size="sm">↓ Export Excel</Button>
            </a>
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
                  <StatusBadge status={poa.status} version={poa.version} />
                  <Link href={`/poa/${poa.id}`}>
                    <Button size="sm" variant="secondary">Review</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!isMR && mrGroups.length > 0 && mrProgressPeriod && (
        <Card>
          <CardHeader>
            <CardTitle>Progres Submit MR</CardTitle>
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
              Periode {mrProgressPeriod}
            </span>
          </CardHeader>
          <div className="space-y-3">
            {mrGroups.map((g) => {
              const total   = g.mrNips.length;
              const done    = g.submittedNips.size;
              const isEmpty = total === 0;
              const pct     = total > 0 ? (done / total) * 100 : 0;
              const allDone = !isEmpty && done === total;
              const noneDone = !isEmpty && done === 0;
              return (
                <div key={g.groupNip}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {g.groupName}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
                        {g.groupRole}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums"
                      style={{ color: isEmpty ? "var(--color-text-faint)" : allDone ? "var(--color-success, #16a34a)" : noneDone ? "var(--color-danger, #dc2626)" : "var(--color-text)" }}>
                      {isEmpty ? "0 MR" : `${done}/${total}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: isEmpty ? "0%" : `${pct}%`,
                        background: allDone ? "var(--color-success, #16a34a)" : noneDone ? "var(--color-danger, #dc2626)" : "var(--color-blue, #2563eb)",
                      }} />
                  </div>
                  {isEmpty ? (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      Belum ada MR di bawahnya
                    </p>
                  ) : !allDone && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      {total - done} MR belum submit
                    </p>
                  )}
                </div>
              );
            })}

            {/* Totals */}
            {mrGroups.length > 1 && (() => {
              const totalMR   = mrGroups.reduce((s, g) => s + g.mrNips.length, 0);
              const doneTotal = mrGroups.reduce((s, g) => s + g.submittedNips.size, 0);
              return (
                <div className="flex items-center justify-between pt-3 text-sm"
                  style={{ borderTop: "1px solid var(--color-border)" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>Total</span>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    {doneTotal} dari {totalMR} MR sudah submit
                  </span>
                </div>
              );
            })()}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isMR ? "POA Saya" : "Semua POA"}</CardTitle>
        </CardHeader>
        {recentPoas.length === 0 ? (
          <EmptyState eligible={eligible} role={session.role as Role} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Period</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Ratio %</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>% Budget</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPoas.map((poa) => {
                  const target = poa.target ? parseFloat(poa.target.toString()) : null;
                  const budgetOver = poa._pctBudget != null && poa._pctBudget > 42.5;
                  return (
                  <tr key={poa.id}>
                    <td className="py-3">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{poa.owner.nip}</p>
                    </td>
                    <td className="py-3" style={{ color: "var(--color-text)" }}>{poa.period}</td>
                    <td className="py-3"><StatusBadge status={poa.status} version={poa.version} /></td>
                    <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                      {target != null ? formatRp(target) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      {poa._totalEst > 0 ? formatRp(poa._totalEst) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium">
                      {poa._ratioEstimasi != null ? (
                        <span style={{ color: poa._ratioEstimasi >= 100 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                          {poa._ratioEstimasi.toFixed(1)}%
                        </span>
                      ) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium">
                      {poa._pctBudget != null ? (
                        <span style={{ color: budgetOver ? "var(--color-red)" : "var(--color-text-muted)" }}>
                          {poa._pctBudget.toFixed(1)}%
                        </span>
                      ) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {editablePoaIds.has(poa.id) && (
                          <Link href={`/poa/${poa.id}/edit`} className="text-xs font-medium"
                            style={{ color: "var(--color-text-muted)" }}>
                            Tambah
                          </Link>
                        )}
                        <Link href={`/poa/${poa.id}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                          Detail
                        </Link>
                        {poa.status === "DRAFT" && editablePoaIds.has(poa.id) && (
                          <DeletePoaButton poaId={poa.id} period={poa.period} />
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

function EmptyState({ eligible, role }: { eligible: boolean; role: Role }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {eligible
          ? "Belum ada POA. Buat POA pertama Anda."
          : `Belum ada POA yang perlu ditinjau sebagai ${role}.`}
      </p>
      {eligible && (
        <Link href="/poa/new" className="mt-3 inline-block">
          <Button size="sm">Buat POA</Button>
        </Link>
      )}
    </div>
  );
}
