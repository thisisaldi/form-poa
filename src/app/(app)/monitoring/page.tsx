import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips, NON_DRAFT_STATUSES } from "@/lib/authz";
import { buildOrgMaps, type OrgMaps } from "@/lib/targetCalculation";
import { Card } from "@/components/ui/Card";
import { SalesAchievementTable, type AchievementRow } from "@/components/poa/SalesAchievementTable";
import { MonitoringFilterModal } from "@/components/poa/MonitoringFilterModal";

export const metadata = { title: "Monitoring · Form POA" };

type Tab = "mr" | "area" | "outlet" | "produk";

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

/**
 * Monitoring: Target vs Sales Actual, per MR / per Area (SM territory) /
 * per outlet / per produk.
 *
 * "Target" is only ever a REAL figure someone actually set (2026-07-30: "jangan
 * pakai target dummy lagi") — never a stand-in like planned rencana:
 *  - mr/area: PoaForm.target, the Rupiah quota an atasan set per MR/period
 *    (rolled up across an SM's MRs for the area tab).
 *  - produk: ProductTargetAllocation (qty, cascaded NSM→SM→ASM→MR — see
 *    targetCalculation.ts) at the leaf MR level, × Product.hna.
 *  - outlet: there is no per-outlet target model anywhere in this app, so
 *    it's always 0/"-" here — not fabricated from something else.
 * A group with no real target shows Gap as "Belum ada target" rather than
 * treating the missing target as zero (2026-07-30 request).
 *
 * "Sales Actual" is real data synced from mkt_insight.dbo.DIR10001B: a real
 * observed Rupiah figure for outlet/mr/area, and a qty×HNA derivation for
 * produk since DIR10001B has no per-product Rupiah value (same derivation
 * Summary's "produk" tab uses). There is no per-doctor/customer breakdown in
 * DIR10001B at all, so a "dokter" tab isn't offered here.
 *
 * Gap = actual - target (2026-07-30 fix — was target - actual).
 */

// Lightweight placeholder shown while MonitoringContent streams in (2026-08-03
// — same split as summary/page.tsx: this page used to block on ALL of its
// aggregation before rendering anything at all, including the tab bar/filter
// that don't need any of that data). Row count is just a visual
// approximation of SalesAchievementTable, not tied to any real data.
function MonitoringSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 w-64 rounded" style={{ background: "var(--color-bg-subtle)" }} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <div className="h-3 w-24 rounded" style={{ background: "var(--color-bg-subtle)" }} />
            <div className="h-6 w-32 rounded mt-2" style={{ background: "var(--color-bg-subtle)" }} />
          </Card>
        ))}
      </div>
      <Card>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 rounded" style={{ background: "var(--color-bg-subtle)" }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");
  // Restricted to ADMIN only while this page is still being reviewed
  // (2026-07-30) — widen back to the full Summary audience once approved.
  if (session.role !== "ADMIN") redirect("/summary");

  const params = await searchParams;
  const tab: Tab = (params.tab as Tab) ?? "mr";
  const periodFrom = params.periodFrom ?? null;
  const periodTo = params.periodTo ?? null;
  const hasPeriodFilter = !!periodFrom || !!periodTo;
  const areaNip = params.area ?? null;
  const mrNipFilter = params.mr ?? null;
  const filterQuery = `${periodFrom ? `&periodFrom=${periodFrom}` : ""}${periodTo ? `&periodTo=${periodTo}` : ""}${areaNip ? `&area=${areaNip}` : ""}${mrNipFilter ? `&mr=${mrNipFilter}` : ""}`;

  // ── Scope: role-based visibility, then Area/MR filter on top ─────────────

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const baseMrNips = await getSubordinateMRNips(actor);
  const org = await buildOrgMaps();

  const areaOptions = [...org.mrsBySm.entries()]
    .filter(([, mrs]) => mrs.some((n) => baseMrNips.includes(n)))
    .map(([smNip]) => ({ nip: smNip, name: org.smInfo.get(smNip)?.name ?? smNip }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allMrUsers = baseMrNips.length > 0
    ? (await prisma.user.findMany({ where: { nip: { in: baseMrNips } }, orderBy: { name: "asc" }, select: { nip: true, name: true } })) as { nip: string; name: string }[]
    : [];

  let mrNips = baseMrNips;
  if (areaNip) {
    const smMrs = new Set(org.mrsBySm.get(areaNip) ?? []);
    mrNips = mrNips.filter((n) => smMrs.has(n));
  }
  if (mrNipFilter) {
    mrNips = mrNips.filter((n) => n === mrNipFilter);
  }
  const mrNipsSet = new Set(mrNips);
  const mrUsers = allMrUsers.filter((u) => mrNipsSet.has(u.nip));

  // Cheap, deliberately UNBOUNDED (full history) distinct-periods query for the
  // filter dropdown — kept in the shell (not Suspense-deferred like everything
  // else below) so the filter is usable the instant the page loads, same as
  // the tab bar. select-only on an indexed column, nowhere near as expensive
  // as the poas/lineItems fetch/aggregation MonitoringContent does.
  const NON_DRAFT = NON_DRAFT_STATUSES;
  const allPoasForPeriods = baseMrNips.length > 0
    ? (await prisma.poaForm.findMany({ where: { ownerId: { in: baseMrNips }, status: { in: NON_DRAFT } }, select: { period: true } })) as { period: string }[]
    : [];
  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();

  const TABS: { key: Tab; label: string }[] = [
    { key: "mr",     label: "Per MR" },
    { key: "area",   label: "Per Area" },
    { key: "outlet", label: "Per Outlet" },
    { key: "produk", label: "Per Produk" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Monitoring</h1>
        </div>

        <MonitoringFilterModal
          tab={tab}
          periods={allPeriods}
          areas={areaOptions}
          mrs={allMrUsers}
          periodFrom={periodFrom}
          periodTo={periodTo}
          areaNip={areaNip}
          mrNip={mrNipFilter}
        />
      </div>

      <Card padded={false}>
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link key={t.key} href={`/monitoring?tab=${t.key}${filterQuery}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={tab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}>
              {t.label}
            </Link>
          ))}
        </div>
      </Card>

      {/* Everything below needs the heavy poas/lineItems fetch/aggregation —
          streamed in separately (2026-08-03) so it doesn't block the shell
          above from showing up. key= forces a fresh Suspense fallback on
          tab/filter change instead of showing stale content while the new
          data loads. */}
      <Suspense key={`${tab}|${periodFrom ?? ""}|${periodTo ?? ""}|${areaNip ?? ""}|${mrNipFilter ?? ""}`} fallback={<MonitoringSkeleton />}>
        <MonitoringContent
          tab={tab}
          periodFrom={periodFrom}
          periodTo={periodTo}
          hasPeriodFilter={hasPeriodFilter}
          org={org}
          areaOptions={areaOptions}
          mrNips={mrNips}
          mrNipsSet={mrNipsSet}
          mrUsers={mrUsers}
        />
      </Suspense>
    </div>
  );
}

async function MonitoringContent({
  tab, periodFrom, periodTo, hasPeriodFilter, org, areaOptions, mrNips, mrNipsSet, mrUsers,
}: {
  tab: Tab;
  periodFrom: string | null;
  periodTo: string | null;
  hasPeriodFilter: boolean;
  org: OrgMaps;
  areaOptions: { nip: string; name: string }[];
  mrNips: string[];
  mrNipsSet: Set<string>;
  mrUsers: { nip: string; name: string }[];
}) {
  // ── POAs (real target lives here) ─────────────────────────────────────────

  // Same bug/fix as summary/page.tsx: the old local literal only matched the
  // near-unreachable APPROVED_BY_ASM/SM statuses (approvePoa jumps straight
  // SUBMITTED_TO_X → SUBMITTED_TO_Y, see poaWorkflow.ts), starving this page
  // of almost all real data. authz.ts's NON_DRAFT_STATUSES is correct.
  const NON_DRAFT = NON_DRAFT_STATUSES;
  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips }, status: { in: NON_DRAFT } };
  if (hasPeriodFilter) {
    poaWhere.period = {
      ...(periodFrom ? { gte: periodFrom } : {}),
      ...(periodTo ? { lte: periodTo } : {}),
    };
  }

  const poas = mrNips.length > 0
    ? (await prisma.poaForm.findMany({ where: poaWhere, select: { id: true, ownerId: true, period: true, target: true } })) as { id: string; ownerId: string; period: string; target: { toString(): string } | null }[]
    : [];

  const poaIds = poas.map((p) => p.id);

  const targetByOwner = new Map<string, number>();
  for (const poa of poas) {
    targetByOwner.set(poa.ownerId, (targetByOwner.get(poa.ownerId) ?? 0) + toNum(poa.target));
  }

  // Line items are only used here for OUTLET/PRODUK identity (which
  // outlets/products an MR has actually planned for) — never for target
  // value anymore (that was the "dummy target" this page used to show).
  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({
        where: { poaId: { in: poaIds } },
        select: { kodePI: true, kodeProduk: true, namaProduk: true },
      })) as { kodePI: string | null; kodeProduk: string; namaProduk: string }[]
    : [];

  const outletCodesFromLineItems = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];

  // ── PIC (current outlet assignments) ────────────────────────────────────

  const mrOutletRows = mrNips.length > 0
    ? (await prisma.mrOutletAssignment.findMany({ where: { nipMR: { in: mrNips } }, select: { nipMR: true, kodePI: true } })) as { nipMR: string; kodePI: string }[]
    : [];
  const mrNamesByOutlet = new Map<string, string[]>();
  const outletsByMr = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const mrName = mrUsers.find((u) => u.nip === row.nipMR)?.name ?? row.nipMR;
    mrNamesByOutlet.set(row.kodePI, [...(mrNamesByOutlet.get(row.kodePI) ?? []), mrName]);
    outletsByMr.set(row.nipMR, [...(outletsByMr.get(row.nipMR) ?? []), row.kodePI]);
  }
  const outletKodesForMR = [...new Set([...mrOutletRows.map((r) => r.kodePI), ...outletCodesFromLineItems])];

  const outletRows = outletKodesForMR.length > 0
    ? (await prisma.outlet.findMany({ where: { kodePI: { in: outletKodesForMR } }, select: { kodePI: true, namaOutlet: true } })) as { kodePI: string; namaOutlet: string }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

  // ── Sales Actual (DIR10001B, via OutletSalesValueMonthly/OutletSalesMonthly) ─

  const now = new Date();
  const SALES_YEAR_FROM = `${now.getFullYear()}01`;

  const [salesValueRaw, salesQtyRaw] = await Promise.all([
    outletKodesForMR.length > 0
      ? prisma.outletSalesValueMonthly.groupBy({ by: ["kodePI"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_YEAR_FROM } }, _sum: { valueSales: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0
      ? prisma.outletSalesMonthly.groupBy({ by: ["itemKode"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_YEAR_FROM } }, _sum: { qty: true } })
      : Promise.resolve([]),
  ]) as [
    { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[],
    { itemKode: string; _sum: { qty: { toString(): string } | null } }[],
  ];

  const salesValueByOutlet = new Map(salesValueRaw.map((r) => [r.kodePI, toNum(r._sum.valueSales)]));
  const qtyByItemKode = new Map(salesQtyRaw.map((r) => [r.itemKode, toNum(r._sum.qty)]));

  // ── Real product target (ProductTargetAllocation, leaf MR rows only) ─────

  const targetAllocWhere: Record<string, unknown> = { nip: { in: mrNips } };
  if (hasPeriodFilter) {
    targetAllocWhere.quarter = {
      ...(periodFrom ? { gte: periodFrom } : {}),
      ...(periodTo ? { lte: periodTo } : {}),
    };
  }
  const targetAllocRaw = mrNips.length > 0
    ? (await prisma.productTargetAllocation.groupBy({ by: ["kodeProduk"], where: targetAllocWhere, _sum: { qty: true } })) as { kodeProduk: string; _sum: { qty: { toString(): string } | null } }[]
    : [];
  const qtyTargetByProduk = new Map(targetAllocRaw.map((r) => [r.kodeProduk, toNum(r._sum.qty)]));

  // ── Product identity + HNA (name/HNA lookup for any code from line items,
  //    real target allocations, or real sales — not just planned rencana) ──

  const allProdukCodes = [...new Set([
    ...lineItems.map((li) => li.kodeProduk),
    ...qtyTargetByProduk.keys(),
    ...qtyByItemKode.keys(),
  ])];
  const productRows = allProdukCodes.length > 0
    ? (await prisma.product.findMany({ where: { kodeProduk: { in: allProdukCodes } }, select: { kodeProduk: true, namaProduk: true, hna: true } })) as { kodeProduk: string; namaProduk: string; hna: { toString(): string } }[]
    : [];
  const nameByKodeProduk = new Map(productRows.map((p) => [p.kodeProduk, p.namaProduk]));
  const hnaByKodeProduk = new Map(productRows.map((p) => [p.kodeProduk, toNum(p.hna)]));
  for (const li of lineItems) {
    if (!nameByKodeProduk.has(li.kodeProduk)) nameByKodeProduk.set(li.kodeProduk, li.namaProduk);
  }

  // itemKode matches Product.kodeProduk directly (unlike PSSP's kdProduk —
  // see Summary's salesValueByProduk for the same convention).
  const salesValueByProduk = new Map<string, number>();
  for (const [itemKode, qty] of qtyByItemKode) {
    salesValueByProduk.set(itemKode, qty * (hnaByKodeProduk.get(itemKode) ?? 0));
  }
  const targetValueByProduk = new Map<string, number>();
  for (const [kodeProduk, qty] of qtyTargetByProduk) {
    targetValueByProduk.set(kodeProduk, qty * (hnaByKodeProduk.get(kodeProduk) ?? 0));
  }

  // ── Per-tab target/actual lookups ─────────────────────────────────────────

  function mrSalesActual(nip: string): number {
    const outlets = outletsByMr.get(nip) ?? [];
    return outlets.reduce((s, o) => s + (salesValueByOutlet.get(o) ?? 0), 0);
  }

  function salesActualFor(code: string): number {
    if (tab === "outlet") return salesValueByOutlet.get(code) ?? 0;
    if (tab === "produk") return salesValueByProduk.get(code) ?? 0;
    if (tab === "mr") return mrSalesActual(code);
    // area: sum of real sales across every MR (in scope) under this SM
    const mrsUnderSm = (org.mrsBySm.get(code) ?? []).filter((n) => mrNipsSet.has(n));
    return mrsUnderSm.reduce((s, n) => s + mrSalesActual(n), 0);
  }

  function targetFor(code: string): number {
    if (tab === "outlet") return 0; // no per-outlet target model exists
    if (tab === "produk") return targetValueByProduk.get(code) ?? 0;
    if (tab === "mr") return targetByOwner.get(code) ?? 0;
    const mrsUnderSm = (org.mrsBySm.get(code) ?? []).filter((n) => mrNipsSet.has(n));
    return mrsUnderSm.reduce((s, n) => s + (targetByOwner.get(n) ?? 0), 0);
  }

  // ── Group identity per tab ────────────────────────────────────────────────

  type Group = { code: string; name: string; pic: string };
  const groups: Group[] = [];

  if (tab === "mr") {
    for (const mr of mrUsers) groups.push({ code: mr.nip, name: mr.name, pic: mr.name });
  } else if (tab === "area") {
    for (const a of areaOptions) {
      const hasScope = (org.mrsBySm.get(a.nip) ?? []).some((n) => mrNipsSet.has(n));
      if (hasScope) groups.push({ code: a.nip, name: a.name, pic: "-" });
    }
  } else if (tab === "outlet") {
    for (const code of outletKodesForMR) {
      const o = outletMap.get(code);
      const names = mrNamesByOutlet.get(code);
      groups.push({ code, name: o?.namaOutlet ?? "Tidak Diketahui", pic: names && names.length > 0 ? names.join(" / ") : "-" });
    }
  } else {
    for (const code of allProdukCodes) {
      groups.push({ code, name: nameByKodeProduk.get(code) ?? code, pic: "-" });
    }
  }

  const rows: AchievementRow[] = groups.map((g) => {
    const target = targetFor(g.code);
    const salesActual = salesActualFor(g.code);
    return {
      code: g.code,
      name: g.name,
      pic: g.pic,
      target,
      salesActual,
      achievementPct: target > 0 ? (salesActual / target) * 100 : null,
      gap: target > 0 ? salesActual - target : null,
    };
  });

  // Worst achievers first — the point of a monitoring view. Rows with no
  // real target at all (gap === null) fall to the bottom, ordered by
  // whatever sales they still have.
  rows.sort((a, b) => {
    if (a.achievementPct == null && b.achievementPct == null) return b.salesActual - a.salesActual;
    if (a.achievementPct == null) return 1;
    if (b.achievementPct == null) return -1;
    return a.achievementPct - b.achievementPct;
  });

  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const totalSalesActual = rows.reduce((s, r) => s + r.salesActual, 0);
  const totalAchievementPct = totalTarget > 0 ? (totalSalesActual / totalTarget) * 100 : null;
  const totalGap = totalTarget > 0 ? totalSalesActual - totalTarget : null;

  const CODE_LABEL: Record<Tab, string> = { outlet: "Outlet", produk: "Produk", mr: "Personil", area: "Area (SM)" };

  return (
    <div className="space-y-5">
      {/* Counts line — was part of the static header in MonitoringPage's shell;
          moved here since it needs the heavy-fetched poas count (2026-08-03). */}
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {mrUsers.length} MR · {poas.length} POA · Target (real) vs Sales Actual (DIR10001B)
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Target</p>
          <p className="mt-1 text-lg font-semibold">{totalTarget > 0 ? formatRp(totalTarget) : "-"}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Sales Actual</p>
          <p className="mt-1 text-lg font-semibold">{totalSalesActual > 0 ? formatRp(totalSalesActual) : "-"}</p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Achievement</p>
          <p className="mt-1 text-lg font-semibold"
            style={{ color: totalAchievementPct == null ? "var(--color-text)"
              : totalAchievementPct >= 100 ? "var(--color-success, #16a34a)"
              : totalAchievementPct >= 70 ? "var(--color-warning, #f59e0b)"
              : "var(--color-red)" }}>
            {totalAchievementPct != null ? `${totalAchievementPct.toFixed(1)}%` : "-"}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            Gap {totalGap != null ? formatRp(totalGap) : "Belum ada target"}
          </p>
        </Card>
      </div>

      <SalesAchievementTable rows={rows} codeLabel={CODE_LABEL[tab]} />
    </div>
  );
}
