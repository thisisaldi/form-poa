import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NotReadyButton } from "@/components/ui/NotReadyButton";
import { DeletePoaScButton } from "@/components/sc/DeletePoaScButton";
import { PoaStatusProgressChart } from "@/components/poa/PoaStatusProgressChart";
import { formatCurrency as formatRp } from "@/lib/format";
import type { PoaStatus } from "@prisma/client";
import { displayRole } from "@/lib/role";
import { getVisiblePoaScFilter, getPendingActionScFilter } from "@/lib/authz";
import { getScCashbackPoa } from "../[id]/_services/getScCashbackPoa";
import { getSalesCounterProduct } from "../[id]/_services/getSalesCounterProduct";
import { calculateCashbackDetails } from "@/components/sc/edit/hooks/useSalesCounterCashback";

export const metadata = { title: "Dashboard POA Sales Counter · Form POA" };

function buildPageHref(page: number, size: string, q?: string) {
  const sp = new URLSearchParams();
  sp.set("page", String(page));
  sp.set("size", size);
  if (q) sp.set("q", q);
  return `/sc/dashboard?${sp.toString()}`;
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

  const q = params.q?.trim();
  const visibleFilter = await getVisiblePoaScFilter(actor);
  const pendingFilter = getPendingActionScFilter(actor);

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

  const pageSizeParam = params.size ?? "25";
  const pageSize = pageSizeParam === "all" ? null : Number(pageSizeParam) || 25;
  const requestedPage = Math.max(1, Number(params.page) || 1);

  const totalPoaCount = await prisma.poaScForm.count({ where });
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalPoaCount / pageSize)) : 1;
  const page = Math.min(requestedPage, totalPages);

  const [scForms, pendingCount] = await Promise.all([
    prisma.poaScForm.findMany({
      where,
      include: {
        owner: true,
        products: true,
        entertainItems: true,
      },
      orderBy: { updatedAt: "desc" },
      ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    prisma.poaScForm.count({ where: pendingFilter }),
  ]);

  // Collect all product codes across forms to fetch master product HNA
  const allProductCodes = Array.from(
    new Set(scForms.flatMap((f: any) => f.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts =
    allProductCodes.length > 0
      ? await prisma.product.findMany({
          where: { kodeProduk: { in: allProductCodes } },
          select: { kodeProduk: true, hna: true, konversiPembagi: true },
        })
      : [];

  const masterProductMap = new Map<string, any>(
    masterProducts.map((p: any) => [p.kodeProduk, p])
  );

  const outletCodes = Array.from(new Set(scForms.map((f: any) => f.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();

  const [cashbackData] = await Promise.all([
    getScCashbackPoa(),
    Promise.all(
      outletCodes.map(async (kodePI: string) => {
        try {
          const res = await getSalesCounterProduct(kodePI);
          if (res?.data) {
            for (const cp of res.data) {
              canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
                sales_counter_value: cp.sales_counter_value || 0,
                sales_counter_minimum: cp.sales_counter_minimum || 0,
              });
            }
          }
        } catch (err) {
          console.error(`Error fetching SC products for ${kodePI}:`, err);
        }
      })
    ),
  ]);

  // Group forms by period & owner
  const periodsMap = new Map<
    string,
    {
      id: string;
      period: string;
      status: PoaStatus;
      version: number;
      owner: typeof actor;
      _totalEstSales: number;
      _totalBudgetSc: number;
      _outletCount: number;
      updatedAt: Date;
    }
  >();

  for (const f of scForms) {
    const key = isMR ? f.period : `${f.period}_${f.ownerId}`;
    const lama = f.lamaPeriode || 3;

    const cbDetails = calculateCashbackDetails({
      cashbackData,
      selectedProducts: f.products.map((p: any) => ({
        kodeProduk: p.kodeProduk,
        qtyPerBulan: String(p.qtyPerBulan || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: f.products.map((p: any) => {
        const mp = masterProductMap.get(p.kodeProduk);
        return {
          kodeProduk: p.kodeProduk,
          hna: String(mp ? Number(mp.hna.toString()) : 0),
          konversiPembagi: String(mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1),
        };
      }),
      lamaPeriode: lama,
    });

    let fEstSales = 0;
    let fBudgetSc = 0;

    for (const p of f.products) {
      if (!p.kodeProduk) continue;
      const mp = masterProductMap.get(p.kodeProduk);
      const cp = canvasserProductMap.get(`${f.kodePI}_${p.kodeProduk}`);
      const hnaSJ = mp ? Number(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const qty = p.qtyPerBulan || 0;

      const estSalesPerMonth = qty * hnaST;
      const estSalesFull = estSalesPerMonth * lama;

      const qtySjBln = konv > 0 ? qty / konv : 0;
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

      let nilaiScPerMonth = 0;
      if (scVal != null && scVal > 0) {
        nilaiScPerMonth = qtySjBln >= scMin ? qtySjBln * scVal : 0;
      } else {
        const pctMatriks = Number(p.persenMatriksSc?.toString() || 0);
        nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
      }
      const nilaiScFull = nilaiScPerMonth * lama;

      const diskonFull = estSalesFull * (Number(p.persenDiskon?.toString() || 0) / 100);
      const cashbackFull = cashbackData
        ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
        : estSalesFull * (Number(p.persenCashback?.toString() || 0) / 100);

      fEstSales += estSalesFull;
      fBudgetSc += nilaiScFull + diskonFull + cashbackFull;
    }

    const totalEnt = f.entertainItems.reduce(
      (sum: number, e: any) => sum + Number(e.biayaEntertain?.toString() || 0),
      0
    );
    fBudgetSc += totalEnt;

    const existing = periodsMap.get(key);
    if (existing) {
      existing._totalEstSales += fEstSales;
      existing._totalBudgetSc += fBudgetSc;
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
        _totalBudgetSc: fBudgetSc,
        _outletCount: 1,
        updatedAt: f.updatedAt,
      });
    }
  }

  const recentPeriods = [...periodsMap.values()].sort((a, b) => b.period.localeCompare(a.period));

  // MR Progress stats (for managers)
  interface MrGroupStat {
    groupNip: string;
    groupName: string;
    groupRole: string;
    mrNips: string[];
    submittedNips: Set<string>;
  }

  let mrProgressPeriod: string | null = null;
  let mrGroups: MrGroupStat[] = [];
  let statusCounts: Partial<Record<PoaStatus, number>> = {};

  if (!isMR) {
    const directSubs = (await prisma.user.findMany({
      where: { nipAtasan: actor.nip, isActive: true },
      select: { nip: true, name: true, role: true },
      orderBy: { name: "asc" },
    })) as { nip: string; name: string; role: string }[];

    const groupsRaw: { nip: string; name: string; role: string; mrNips: string[] }[] = [];
    for (const sub of directSubs) {
      if (sub.role === "MR") {
        groupsRaw.push({ ...sub, mrNips: [sub.nip] });
      } else {
        const depth = sub.role === "ASM" ? 1 : sub.role === "SM" ? 2 : 1;
        async function getMrsUnder(managerNip: string, d: number): Promise<string[]> {
          if (d === 0) return [];
          const reports = (await prisma.user.findMany({
            where: { nipAtasan: managerNip, isActive: true },
            select: { nip: true, role: true },
          })) as { nip: string; role: string }[];
          const nips: string[] = [];
          for (const r of reports) {
            if (r.role === "MR") nips.push(r.nip);
            else nips.push(...(await getMrsUnder(r.nip, d - 1)));
          }
          return nips;
        }
        const mrNips = await getMrsUnder(sub.nip, depth);
        groupsRaw.push({ ...sub, mrNips });
      }
    }

    const allMrNips = [...new Set(groupsRaw.flatMap((g) => g.mrNips))];
    if (allMrNips.length > 0) {
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
        const submittedRows = (await prisma.poaScForm.findMany({
          where: {
            ownerId: { in: allMrNips },
            period: mrProgressPeriod,
            status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] },
          },
          select: { ownerId: true },
        })) as { ownerId: string }[];

        const submittedNips = new Set(submittedRows.map((r) => r.ownerId));

        mrGroups = groupsRaw.map((g) => ({
          groupNip: g.nip,
          groupName: g.name,
          groupRole: g.role,
          mrNips: g.mrNips,
          submittedNips: new Set(g.mrNips.filter((n) => submittedNips.has(n))),
        }));

        const statusRows = (await prisma.poaScForm.groupBy({
          by: ["status"],
          where: { AND: [visibleFilter, { period: mrProgressPeriod }] },
          _count: { _all: true },
        })) as { status: PoaStatus; _count: { _all: number } }[];

        statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]));
      }
    }
  }

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
        {isMR && (
          <NotReadyButton label="+ Daftar User Baru" message="Fitur Daftar Dokter Baru masih dalam pengembangan." />
        )}
        <Link href="/sc/new">
          <Button>+ Buat POA Baru</Button>
        </Link>
        {!isMR && (
          <a href="/api/export/team">
            <Button variant="secondary" size="sm">
              ↓ Export Excel
            </Button>
          </a>
        )}
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
            <input type="hidden" name="size" value={pageSizeParam} />
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
              <Link href={buildPageHref(1, pageSizeParam)} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
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
          <div className="overflow-x-auto">
            {/* Mobile Scroll Hint */}
            <div className="flex items-center text-[11px] sm:hidden pb-2" style={{ color: "var(--color-text-muted)" }}>
              <span>↔ Geser tabel ke samping untuk melihat semua kolom</span>
            </div>
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
                    TARGET
                  </th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    ESTIMASI
                  </th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    RATIO %
                  </th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    % BUDGET
                  </th>
                  <th className="pb-3 whitespace-nowrap" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPeriods.map((p) => {
                  const isDraft = p.status === "DRAFT";
                  const isRevisi = p.status === "REVISI";
                  const ratioPct = p._totalEstSales > 0 ? (p._totalBudgetSc / p._totalEstSales) * 100 : 0;
                  const detailHref = `/sc/${p.id}`;
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
                      <td className="py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                        -
                      </td>
                      <td className="py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {p._totalEstSales > 0 ? formatRp(p._totalEstSales) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td className="py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                        -
                      </td>
                      <td className="py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {ratioPct > 0 ? `${ratioPct.toFixed(1)}%` : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          {isMR && (isDraft || isRevisi) && (
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
        )}

        {recentPeriods.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Menampilkan {pageSize ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalPoaCount)}` : `1-${totalPoaCount}`} dari {totalPoaCount} POA
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
                <span>Tampilkan:</span>
                {(["25", "50", "100", "all"] as const).map((s) => (
                  <Link
                    key={s}
                    href={buildPageHref(1, s, q)}
                    className="rounded px-1.5 py-0.5"
                    style={{
                      background: pageSizeParam === s ? "var(--color-blue-light)" : "transparent",
                      color: pageSizeParam === s ? "var(--color-blue)" : "var(--color-text-faint)",
                      fontWeight: pageSizeParam === s ? 600 : 400,
                    }}
                  >
                    {s === "all" ? "Semua" : s}
                  </Link>
                ))}
              </div>
              {pageSize && totalPages > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <Link
                    href={buildPageHref(Math.max(1, page - 1), pageSizeParam, q)}
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
                    href={buildPageHref(Math.min(totalPages, page + 1), pageSizeParam, q)}
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
