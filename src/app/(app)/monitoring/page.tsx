import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { Card } from "@/components/ui/Card";
import { SalesAchievementTable, type AchievementRow } from "@/components/poa/SalesAchievementTable";

export const metadata = { title: "Monitoring · Form POA" };

type Tab = "outlet" | "mr" | "produk";

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

/**
 * Monitoring: Target vs Sales Actual, per outlet / per MR / per produk.
 *
 * "Target" here is the rencana/estimasi an MR has actually planned for that
 * outlet/product (sum of PoaLineItem.rencanaTotalBiaya) — the same figure
 * Summary calls "Estimasi" and already treats as the goal line for its own
 * gap/achievement math. The "mr" tab additionally shows PoaForm.target, the
 * separate Rupiah quota an atasan sets per MR/period.
 *
 * "Sales Actual" is real data synced from mkt_insight.dbo.DIR10001B (see
 * outletSalesValueMonthlySync.ts / salesHistoryMonthlySync.ts): a real
 * observed Rupiah figure for outlet/mr, and a qty×HNA derivation for produk
 * since DIR10001B has no per-product Rupiah value (same derivation Summary's
 * "produk" tab already uses — see salesValueByProduk there). There is no
 * per-doctor/customer breakdown in DIR10001B at all, so a "dokter" tab isn't
 * offered here (2026-07-30 decision, matching Summary's own limitation).
 */
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
  const periodQuery = `${periodFrom ? `&periodFrom=${periodFrom}` : ""}${periodTo ? `&periodTo=${periodTo}` : ""}`;

  // ── Scope & POAs ─────────────────────────────────────────────────────────

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({ where: { nip: { in: mrNips } }, orderBy: { name: "asc" } })) as { nip: string; name: string }[]
    : [];

  const NON_DRAFT = ["APPROVED_BY_ASM", "APPROVED_BY_SM", "APPROVED_BY_NSM"];
  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips }, status: { in: NON_DRAFT } };
  if (hasPeriodFilter) {
    poaWhere.period = {
      ...(periodFrom ? { gte: periodFrom } : {}),
      ...(periodTo ? { lte: periodTo } : {}),
    };
  }

  const [poas, allPoasForPeriods] = await Promise.all([
    mrNips.length > 0
      ? (prisma.poaForm.findMany({ where: poaWhere }) as Promise<{ id: string; ownerId: string; period: string; target: { toString(): string } | null }[]>)
      : Promise.resolve([]),
    mrNips.length > 0
      ? (prisma.poaForm.findMany({ where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT } }, select: { period: true } }) as Promise<{ period: string }[]>)
      : Promise.resolve([]),
  ]);

  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();
  const poaIds = poas.map((p) => p.id);
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({
        where: { poaId: { in: poaIds } },
        select: { poaId: true, kodePI: true, kodeProduk: true, namaProduk: true, rencanaTotalBiaya: true },
      })) as { poaId: string; kodePI: string | null; kodeProduk: string; namaProduk: string; rencanaTotalBiaya: { toString(): string } | number }[]
    : [];

  const outletCodes = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];
  const outletRows = outletCodes.length > 0
    ? (await prisma.outlet.findMany({ where: { kodePI: { in: outletCodes } }, select: { kodePI: true, namaOutlet: true } })) as { kodePI: string; namaOutlet: string }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

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
  const outletKodesForMR = [...new Set(mrOutletRows.map((r) => r.kodePI))];

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

  // "Sales Actual" per produk is DERIVED (qty × HNA), not a real observed
  // Rupiah figure — DIR10001B has no per-product value column. itemKode
  // matches Product.kodeProduk directly (see Summary's salesValueByProduk).
  const productCodesForSales = [...qtyByItemKode.keys()];
  const hnaProducts = productCodesForSales.length > 0
    ? (await prisma.product.findMany({ where: { kodeProduk: { in: productCodesForSales } }, select: { kodeProduk: true, hna: true } })) as { kodeProduk: string; hna: { toString(): string } }[]
    : [];
  const hnaByKodeProduk = new Map(hnaProducts.map((p) => [p.kodeProduk, toNum(p.hna)]));
  const salesValueByProduk = new Map<string, number>();
  for (const [itemKode, qty] of qtyByItemKode) {
    salesValueByProduk.set(itemKode, qty * (hnaByKodeProduk.get(itemKode) ?? 0));
  }

  function salesActualFor(code: string): number {
    if (tab === "outlet") return salesValueByOutlet.get(code) ?? 0;
    if (tab === "produk") return salesValueByProduk.get(code) ?? 0;
    // mr: sum of real outlet-level sales across every outlet this MR currently holds
    const outlets = outletsByMr.get(code) ?? [];
    return outlets.reduce((s, o) => s + (salesValueByOutlet.get(o) ?? 0), 0);
  }

  // ── Group by tab ─────────────────────────────────────────────────────────

  type Key = { code: string; name: string; pic: string };

  function keyFor(li: typeof lineItems[0]): Key {
    if (tab === "outlet") {
      const o = li.kodePI ? outletMap.get(li.kodePI) : null;
      const names = li.kodePI ? mrNamesByOutlet.get(li.kodePI) : undefined;
      return { code: li.kodePI ?? "-", name: o?.namaOutlet ?? "Tidak Diketahui", pic: names && names.length > 0 ? names.join(" / ") : "-" };
    }
    if (tab === "produk") {
      return { code: li.kodeProduk, name: li.namaProduk, pic: "-" };
    }
    const ownerNip = poaOwnerMap.get(li.poaId) ?? "-";
    const mr = mrUsers.find((u) => u.nip === ownerNip);
    return { code: ownerNip, name: mr?.name ?? ownerNip, pic: mr?.name ?? ownerNip };
  }

  const groupMap = new Map<string, { key: Key; target: number }>();

  // Pre-seed so a group with real sales but no submitted plan still shows up
  // (an outlet/MR selling with nothing planned is exactly what monitoring
  // should surface, not hide).
  if (tab === "mr") {
    for (const mr of mrUsers) groupMap.set(mr.nip, { key: { code: mr.nip, name: mr.name, pic: mr.name }, target: 0 });
  } else if (tab === "outlet") {
    const mrOutletDetails = outletKodesForMR.length > 0
      ? (await prisma.outlet.findMany({ where: { kodePI: { in: outletKodesForMR } }, select: { kodePI: true, namaOutlet: true } })) as { kodePI: string; namaOutlet: string }[]
      : [];
    for (const o of mrOutletDetails) {
      const names = mrNamesByOutlet.get(o.kodePI);
      groupMap.set(o.kodePI, { key: { code: o.kodePI, name: o.namaOutlet, pic: names && names.length > 0 ? names.join(" / ") : "-" }, target: 0 });
    }
  }

  for (const li of lineItems) {
    const key = keyFor(li);
    const existing = groupMap.get(key.code);
    const value = toNum(li.rencanaTotalBiaya);
    if (existing) existing.target += value;
    else groupMap.set(key.code, { key, target: value });
  }

  const targetAtasanByMr = new Map<string, number>();
  for (const poa of poas) {
    targetAtasanByMr.set(poa.ownerId, (targetAtasanByMr.get(poa.ownerId) ?? 0) + toNum(poa.target));
  }

  const rows: AchievementRow[] = [...groupMap.values()].map(({ key, target }) => {
    const salesActual = salesActualFor(key.code);
    const achievementPct = target > 0 ? (salesActual / target) * 100 : null;
    return {
      code: key.code,
      name: key.name,
      pic: key.pic,
      target,
      targetAtasan: tab === "mr" ? (targetAtasanByMr.get(key.code) ?? 0) : null,
      salesActual,
      achievementPct,
      gap: target - salesActual,
    };
  });

  // Worst achievers first (that's the point of a monitoring view); rows with
  // no plan at all (target = 0, achievementPct null) fall to the bottom,
  // ordered by whatever sales they still have.
  rows.sort((a, b) => {
    if (a.achievementPct == null && b.achievementPct == null) return b.salesActual - a.salesActual;
    if (a.achievementPct == null) return 1;
    if (b.achievementPct == null) return -1;
    return a.achievementPct - b.achievementPct;
  });

  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const totalSalesActual = rows.reduce((s, r) => s + r.salesActual, 0);
  const totalAchievementPct = totalTarget > 0 ? (totalSalesActual / totalTarget) * 100 : null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "mr",     label: "Per MR" },
    { key: "outlet", label: "Per Outlet" },
    { key: "produk", label: "Per Produk" },
  ];
  const CODE_LABEL: Record<Tab, string> = { outlet: "Outlet", produk: "Produk", mr: "Personil" };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Monitoring</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {mrUsers.length} MR · {poas.length} POA · Target (rencana) vs Sales Actual (DIR10001B)
          </p>
        </div>

        {allPeriods.length > 0 && (
          <form method="get" className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="tab" value={tab} />
            <select name="periodFrom" defaultValue={periodFrom ?? ""} className="input-field text-xs" style={{ width: "auto" }}>
              <option value="">Dari (awal)</option>
              {allPeriods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>–</span>
            <select name="periodTo" defaultValue={periodTo ?? ""} className="input-field text-xs" style={{ width: "auto" }}>
              <option value="">Sampai (akhir)</option>
              {allPeriods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="submit" className="rounded px-2.5 py-1 text-xs font-medium border"
              style={{ background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }}>
              Terapkan
            </button>
            {hasPeriodFilter && (
              <Link href={`/monitoring?tab=${tab}`} className="rounded px-2.5 py-1 text-xs font-medium border"
                style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
                Semua
              </Link>
            )}
          </form>
        )}
      </div>

      <Card padded={false}>
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link key={t.key} href={`/monitoring?tab=${t.key}${periodQuery}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={tab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}>
              {t.label}
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Target (Rencana)</p>
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
        </Card>
      </div>

      <SalesAchievementTable rows={rows} codeLabel={CODE_LABEL[tab]} showTargetAtasan={tab === "mr"} />
    </div>
  );
}
