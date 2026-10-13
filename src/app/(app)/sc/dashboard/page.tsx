import { redirect } from "next/navigation";
import { formatWibShort } from "@/lib/formatWib";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DeletePoaScButton } from "@/components/sc/DeletePoaScButton";
import { PoaStatusProgressChart } from "@/components/poa/PoaStatusProgressChart";
import { formatCurrency as formatRp } from "@/lib/format";
import type { PoaStatus } from "@prisma/client";
import { displayRole } from "@/lib/role";
import { getVisiblePoaScFilter, getPendingActionScFilter, getMrIdsUnder } from "@/lib/authz";
import { currentQuarter } from "@/lib/quarterUtils";
import { ScDashboardExportButton } from "@/components/sc/ScDashboardExportButton";

export const metadata = { title: "Dashboard POA Sales Counter · Form POA" };

// One table row = one MR in one period (all of that MR's outlets), so the page
// size counts MR+period groups, not individual outlet forms.
const PAGE_SIZE = 5;

function buildPageHref(page: number, q?: string) {
  const sp = new URLSearchParams();
  sp.set("page", String(page));
  if (q) sp.set("q", q);
  return `/sc/dashboard?${sp.toString()}`;
}

interface DashboardForm {
  id: string;
  period: string;
  status: PoaStatus;
  version: number;
  ownerId: string;
  lamaPeriode: number | null;
  updatedAt: Date;
  owner: { nip: string; name: string };
  products: { kodeProduk: string; qtyPerBulan: number | null; periodeMonth: string | null }[];
}

interface MrGroupStat {
  groupNip: string;
  groupName: string;
  groupRole: string;
  mrNips: string[];
  submittedNips: Set<string>;
}

// Progres submit MR + status counts for managers. Independent of the list
// query below, so the page starts it first and awaits it alongside the list.
async function loadMrProgress(
  actorNip: string,
  visibleFilter: Awaited<ReturnType<typeof getVisiblePoaScFilter>>
) {
  let mrProgressPeriod: string | null = null;
  let mrGroups: MrGroupStat[] = [];
  let statusCounts: Partial<Record<PoaStatus, number>> = {};

  const directSubs = (await prisma.user.findMany({
    where: { nipAtasan: actorNip, isActive: true },
    select: { nip: true, name: true, role: true },
    orderBy: { name: "asc" },
  })) as { nip: string; name: string; role: string }[];

  // getMrIdsUnder is a level-by-level BFS (≤ depth queries per manager,
  // request-cached) instead of one query per node.
  const groupsRaw = await Promise.all(
    directSubs.map(async (sub) => {
      if (sub.role === "MR") return { ...sub, mrNips: [sub.nip] };
      const depth = sub.role === "ASM" ? 1 : sub.role === "SM" ? 2 : 1;
      return { ...sub, mrNips: await getMrIdsUnder(sub.nip, depth) };
    })
  );

  const allMrNips = [...new Set(groupsRaw.flatMap((g) => g.mrNips))];
  if (allMrNips.length === 0) return { mrProgressPeriod, mrGroups, statusCounts };

  const submittedByPeriod = (await prisma.poaScForm.groupBy({
    by: ["period"],
    where: { ownerId: { in: allMrNips }, status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] } },
    _count: { _all: true },
  })) as { period: string; _count: { _all: number } }[];

  if (submittedByPeriod.length > 0) {
    submittedByPeriod.sort((a, b) => b._count._all - a._count._all || (b.period < a.period ? -1 : 1));
    mrProgressPeriod = submittedByPeriod[0].period;
  } else {
    const periodRow = await prisma.poaScForm.findFirst({
      where: { ownerId: { in: allMrNips } },
      orderBy: { period: "desc" },
      select: { period: true },
    });
    mrProgressPeriod = periodRow?.period ?? null;
  }

  if (mrProgressPeriod) {
    const [submittedRows, statusRows] = await Promise.all([
      prisma.poaScForm.findMany({
        where: {
          ownerId: { in: allMrNips },
          period: mrProgressPeriod,
          status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] },
        },
        select: { ownerId: true },
      }) as Promise<{ ownerId: string }[]>,
      prisma.poaScForm.groupBy({
        by: ["status"],
        where: { AND: [visibleFilter, { period: mrProgressPeriod }] },
        _count: { _all: true },
      }) as Promise<{ status: PoaStatus; _count: { _all: number } }[]>,
    ]);

    const submittedNips = new Set(submittedRows.map((r) => r.ownerId));
    mrGroups = groupsRaw.map((g) => ({
      groupNip: g.nip,
      groupName: g.name,
      groupRole: g.role,
      mrNips: g.mrNips,
      submittedNips: new Set(g.mrNips.filter((n) => submittedNips.has(n))),
    }));
    statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]));
  }

  return { mrProgressPeriod, mrGroups, statusCounts };
}

export default async function SalesCounterDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const params = await searchParams;
  const isMR = actor.role === "MR";
  const isASM = actor.role === "ASM";

  const q = params.q?.trim();
  const visibleFilter = await getVisiblePoaScFilter(actor);
  const pendingFilter = getPendingActionScFilter(actor);

  // Manager progress is independent of the list — start it now, await below.
  const progressPromise = isMR ? null : loadMrProgress(actor.nip, visibleFilter);

  const where = q
    ? {
        AND: [
          visibleFilter,
          {
            owner: {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { nip: { contains: q, mode: "insensitive" as const } },
              ],
            },
          },
        ],
      }
    : visibleFilter;

  const requestedPage = Math.max(1, Number(params.page) || 1);

  // Page over MR+period groups (one table row each), newest activity first.
  // Only the group keys are read here; forms are loaded for the page below.
  const [allGroups, pendingCount] = await Promise.all([
    prisma.poaScForm.groupBy({
      by: ["ownerId", "period"],
      where,
      _max: { updatedAt: true },
      orderBy: { _max: { updatedAt: "desc" } },
    }) as Promise<{ ownerId: string; period: string }[]>,
    prisma.poaScForm.count({ where: pendingFilter }),
  ]);
  const totalPoaCount = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalPoaCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageGroups = allGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Only the columns the table needs. ESTIMASI = qty × HNA × lama, so no
  // Canvasser/cashback lookups are required here. All forms of the page's
  // groups are loaded so outlet count and totals are complete.
  const scForms: DashboardForm[] =
    pageGroups.length === 0
      ? []
      : await prisma.poaScForm.findMany({
          where: {
            AND: [where, { OR: pageGroups.map((g) => ({ ownerId: g.ownerId, period: g.period })) }],
          },
          select: {
            id: true,
            period: true,
            status: true,
            version: true,
            ownerId: true,
            lamaPeriode: true,
            updatedAt: true,
            owner: { select: { nip: true, name: true } },
            products: { select: { kodeProduk: true, qtyPerBulan: true, periodeMonth: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

  const allProductCodes = Array.from(
    new Set(scForms.flatMap((f) => f.products.map((p) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts: { kodeProduk: string; hna: { toString(): string } }[] =
    allProductCodes.length > 0
      ? await prisma.product.findMany({
          where: { kodeProduk: { in: allProductCodes } },
          select: { kodeProduk: true, hna: true },
        })
      : [];

  const masterProductMap = new Map(masterProducts.map((p) => [p.kodeProduk, p]));

  // Group forms by period & owner
  const periodsMap = new Map<
    string,
    {
      id: string;
      period: string;
      status: PoaStatus;
      version: number;
      owner: { nip: string; name: string };
      _totalEstSales: number;
      _outletCount: number;
      updatedAt: Date;
    }
  >();

  for (const f of scForms) {
    const key = isMR ? f.period : `${f.period}_${f.ownerId}`;
    const lama = f.lamaPeriode || 3;

    const distinctProductMonths = new Set(f.products.map((p) => p.periodeMonth).filter(Boolean));
    const isMultiMonth = distinctProductMonths.size > 1;

    let fEstSales = 0;
    for (const p of f.products) {
      if (!p.kodeProduk) continue;
      const mp = masterProductMap.get(p.kodeProduk);
      const hnaSJ = mp ? Number(mp.hna.toString()) : 0;
      const estSalesPerMonth = (p.qtyPerBulan || 0) * hnaSJ;
      fEstSales += isMultiMonth ? estSalesPerMonth : estSalesPerMonth * lama;
    }

    const existing = periodsMap.get(key);
    if (existing) {
      existing._totalEstSales += fEstSales;
      existing._outletCount += 1;
      if (f.updatedAt > existing.updatedAt) {
        existing.updatedAt = f.updatedAt;
      }
      if (f.status === "DRAFT" || (f.status === "SUBMITTED_TO_ASM" && existing.status !== "DRAFT")) {
        existing.status = f.status;
      }
    } else {
      periodsMap.set(key, {
        id: f.id,
        period: f.period,
        status: f.status,
        version: f.version,
        owner: f.owner,
        _totalEstSales: fEstSales,
        _outletCount: 1,
        updatedAt: f.updatedAt,
      });
    }
  }

  const recentPeriods = [...periodsMap.values()].sort((a, b) => b.period.localeCompare(a.period));

  const { mrProgressPeriod, mrGroups, statusCounts } = progressPromise
    ? await progressPromise
    : {
        mrProgressPeriod: null as string | null,
        mrGroups: [] as MrGroupStat[],
        statusCounts: {} as Partial<Record<PoaStatus, number>>,
      };

  const activeExportQuarter =
    mrProgressPeriod && /^\d{4}-Q[1-4]$/.test(mrProgressPeriod)
      ? mrProgressPeriod
      : currentQuarter();

  return (
    <div className="space-y-6">
      {/* Header — static, renders immediately */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
          Selamat datang, <span className="font-semibold uppercase">{actor.name}</span>
          <span
            className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}
          >
            {displayRole(actor.role, actor.jabatan)}
          </span>
        </p>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-end gap-2">
        {(isMR || isASM) && (
          <Link href="/sc/new">
            <Button>+ Buat POA Baru</Button>
          </Link>
        )}
        <ScDashboardExportButton currentQuarter={activeExportQuarter} />
      </div>

      {/* 1. Menunggu Tindakan Anda */}
      {!isMR && pendingCount > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Menunggu Tindakan Anda</CardTitle>
              <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {pendingCount} POA menunggu persetujuan Anda
              </p>
            </div>
            <Link href="/sc/approvals">
              <Button size="sm" variant="secondary">
                Lihat Persetujuan →
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* 2. Progres Submit MR */}
      {!isMR && mrGroups.length > 0 && mrProgressPeriod && (
        <Card>
          <CardHeader>
            <CardTitle>Progres Submit MR</CardTitle>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}
            >
              Periode {mrProgressPeriod}
            </span>
          </CardHeader>
          <div className="space-y-3">
            {mrGroups.map((g) => {
              const total = g.mrNips.length;
              const done = g.submittedNips.size;
              const isEmpty = total === 0;
              const pct = total > 0 ? (done / total) * 100 : 0;
              const allDone = !isEmpty && done === total;
              const noneDone = !isEmpty && done === 0;
              return (
                <div key={g.groupNip}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {g.groupName}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}
                      >
                        {g.groupRole}
                      </span>
                    </div>
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{
                        color: isEmpty
                          ? "var(--color-text-faint)"
                          : allDone
                          ? "var(--color-success, #16a34a)"
                          : noneDone
                          ? "var(--color-danger, #dc2626)"
                          : "var(--color-text)",
                      }}
                    >
                      {isEmpty ? "0 MR" : `${done}/${total}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: isEmpty ? "0%" : `${pct}%`,
                        background: allDone
                          ? "var(--color-success, #16a34a)"
                          : noneDone
                          ? "var(--color-danger, #dc2626)"
                          : "var(--color-blue, #2563eb)",
                      }}
                    />
                  </div>
                  {isEmpty ? (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      Belum ada MR di bawahnya
                    </p>
                  ) : (
                    !allDone && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                        {total - done} MR belum submit
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 3. Progress Approval Chart */}
      {!isMR && mrProgressPeriod && Object.keys(statusCounts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Progress Approval</CardTitle>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}
            >
              Periode {mrProgressPeriod}
            </span>
          </CardHeader>
          <PoaStatusProgressChart counts={statusCounts} />
        </Card>
      )}

      {/* 4. Semua POA / POA Saya Table */}
      <Card>
        <CardHeader>
          <CardTitle>{isMR ? "POA Saya" : "Semua POA"}</CardTitle>
        </CardHeader>

        {!isMR && (
          <form method="GET" className="mb-4 flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Cari nama atau NIP MR..."
              className="w-full max-w-xs rounded-md px-3 py-1.5 text-sm"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            />
            <Button type="submit" size="sm" variant="secondary">
              Cari
            </Button>
            {q && (
              <Link href={buildPageHref(1)} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Reset
              </Link>
            )}
          </form>
        )}

        {recentPeriods.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {q ? `Tidak ada POA untuk pencarian "${q}".` : "Belum ada POA. Buat POA pertama Anda."}
            </p>
          </div>
        ) : (
          <div>
            {/* Mobile Card View (sm:hidden) */}
            <div className="sm:hidden flex flex-col gap-3">
              {recentPeriods.map((p) => {
                const isDraft = p.status === "DRAFT";
                const isFullyApproved = p.status === "APPROVED_BY_NSM" || (p.status as any) === "APPROVED_BY_ASD" || (p.status as any) === "APPROVED_BY_SD";
                const canAddOutlet = isMR && !isFullyApproved;
                const isSelf = p.owner.nip === actor.nip;
                const detailHref = isSelf ? `/sc/${p.period}` : `/sc/${p.period}?owner=${p.owner.nip}`;
                return (
                  <div
                    key={`mobile_${p.period}_${p.owner.nip}`}
                    className="py-3 px-3.5 rounded-lg space-y-2.5"
                    style={{
                      border: "1px solid var(--color-border)",
                      backgroundColor: "var(--color-bg)",
                    }}
                  >
                    {/* Top Section: MR Info & Status */}
                    <div className="flex items-start gap-3 justify-between">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-semibold leading-snug break-words block" style={{ color: "var(--color-text)" }}>
                          {p.owner.name}
                        </span>
                        <p className="text-xs font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                          MR: {p.owner.nip}
                        </p>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <StatusBadge status={p.status} version={p.version} />
                      </div>
                    </div>

                    {/* Sub-info Row: Periode & Total Outlet */}
                    <div
                      className="flex items-center gap-x-2.5 text-xs pt-0.5 flex-wrap"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
                        <span>Periode:</span>
                        <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{p.period}</strong>
                      </span>
                      <span className="text-slate-300 dark:text-slate-600 select-none">•</span>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
                        <span>Total Outlet:</span>
                        <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{p._outletCount}</strong>
                      </span>
                    </div>

                    {/* Metrics 2-column grid */}
                    <div
                      className="grid grid-cols-2 gap-3 py-2 text-xs"
                      style={{ borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}
                    >
                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Estimasi Sales</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-blue)" }}>
                          {p._totalEstSales > 0 ? formatRp(p._totalEstSales) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Periode Kuartal</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-text)" }}>
                          {p.period}
                        </p>
                      </div>
                    </div>

                    {/* Footer: Terakhir diperbarui + Actions */}
                    <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                      {p.updatedAt ? (
                        <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                          Terakhir diperbarui: {formatWibShort(p.updatedAt)}
                        </span>
                      ) : <span />}

                      <div className="flex items-center gap-2.5 ml-auto">
                        {canAddOutlet && (
                          <Link
                            href={`/sc/${p.period}/edit`}
                            className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-colors hover:no-underline"
                            style={{
                              background: "transparent",
                              color: "var(--color-text-muted, #64748b)",
                              border: "1px solid var(--color-border, #e2e8f0)",
                              textDecoration: "none",
                            }}
                          >
                            <span style={{ color: "var(--color-text-muted, #64748b)" }}>Tambah</span>
                          </Link>
                        )}

                        <Link
                          href={detailHref}
                          className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-colors hover:no-underline"
                          style={{
                            background: "var(--color-blue-light, #eff6ff)",
                            color: "var(--color-blue, #2563eb)",
                            border: "1px solid var(--color-blue, #2563eb)",
                            textDecoration: "none",
                          }}
                        >
                          <span style={{ color: "var(--color-blue, #2563eb)" }}>Detail</span>
                        </Link>

                        {isMR && isDraft && <DeletePoaScButton period={p.period} />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View (hidden sm:block) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: "var(--color-border)" }}>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      MR
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      PERIOD
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      STATUS
                    </th>
                    <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      ESTIMASI
                    </th>
                    <th className="pb-3 whitespace-nowrap" />
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                  {recentPeriods.map((p) => {
                    const isDraft = p.status === "DRAFT";
                    const isFullyApproved = p.status === "APPROVED_BY_NSM" || (p.status as any) === "APPROVED_BY_ASD" || (p.status as any) === "APPROVED_BY_SD";
                    const canAddOutlet = isMR && !isFullyApproved;
                    const isSelf = p.owner.nip === actor.nip;
                    const detailHref = isSelf ? `/sc/${p.period}` : `/sc/${p.period}?owner=${p.owner.nip}`;
                    return (
                      <tr key={`${p.period}_${p.owner.nip}`} className="hover:bg-[var(--color-bg-subtle)]/50 transition-colors">
                        <td className="py-3 whitespace-nowrap">
                          <p className="font-medium" style={{ color: "var(--color-text)" }}>
                            {p.owner.name}
                          </p>
                          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                            {p.owner.nip}
                          </p>
                        </td>
                        <td className="py-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                          {p.period}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <StatusBadge status={p.status} version={p.version} />
                        </td>
                        <td className="py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                          {p._totalEstSales > 0 ? formatRp(p._totalEstSales) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-3">
                            {canAddOutlet && (
                              <Link href={`/sc/${p.period}/edit`} className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                                Tambah
                              </Link>
                            )}
                            <Link href={detailHref} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                              Detail
                            </Link>
                            {isMR && isDraft && <DeletePoaScButton period={p.period} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {recentPeriods.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Menampilkan {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalPoaCount)} dari {totalPoaCount} POA
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {totalPages > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <Link
                    href={buildPageHref(Math.max(1, page - 1), q)}
                    scroll={false}
                    className="rounded px-2 py-1"
                    style={{
                      color: page <= 1 ? "var(--color-text-faint)" : "var(--color-text-muted)",
                      pointerEvents: page <= 1 ? "none" : "auto",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    ← Prev
                  </Link>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    Hal {page} / {totalPages}
                  </span>
                  <Link
                    href={buildPageHref(Math.min(totalPages, page + 1), q)}
                    scroll={false}
                    className="rounded px-2 py-1"
                    style={{
                      color: page >= totalPages ? "var(--color-text-faint)" : "var(--color-text-muted)",
                      pointerEvents: page >= totalPages ? "none" : "auto",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    Next →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
