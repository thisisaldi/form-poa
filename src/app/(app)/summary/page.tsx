import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { getAllPakets } from "@/lib/paketProduk";
import { getActivePsspByOutlets, type ActivePsspRow } from "@/app/actions/customer";
import { Card } from "@/components/ui/Card";
import { MonitoringChecklist } from "@/components/poa/MonitoringChecklist";
import type { MonitoringGroup, MonitoringTotals } from "@/components/poa/MonitoringChecklist";
import { TerritoryTable } from "@/components/poa/TerritoryTable";

// PSSP contract rows key products by name only (Procode ≠ Item Kode across
// systems — see computeOldEstPerMonth in LineItemEditor.tsx for the same
// convention), so matching an active PSSP row to a "produk" tab group must
// normalize on namaProduk, never kodeProduk/kdProduk.
function normName(s: string): string {
  return s.toLowerCase().trim();
}

export const metadata = { title: "Summary · Form POA" };

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "outlet" | "customer" | "produk" | "mr";

interface SalesFigures {
  historis2025: number;
  salesYtd: number;
  salesPlusEst: number;
  growthPct: number;
  achievementPct: number;
  // Raw components behind growthPct/achievementPct, exposed so Ringkasan can
  // sum them across groups and derive a true growth-of-totals / total
  // achievement instead of averaging each group's own percentage (2026-07-27
  // rework: averaging % masks group-size differences — Simpson's-paradox-style
  // drift from the summed historis2025/salesYtd/salesPlusEst shown alongside).
  salesComparable: number;
  achievementBase: number;
}

interface TerritoryGroup {
  code: string;
  name: string;
  pic: string;
  estimasi: number;
  variasiProduk: number;
  variasiProdukFokus: number;
  produkPssp: number;
  customer: number;
  pengajuan: number;
  terstandarisasi: number;
  prosesStandar: number;
  gap: number;
  psspTotal: number;
  discountTotal: number;
  entertainTotal: number;
  budgetTotal: number;
  realisasi: number;
  gapVsRealisasi: number;
  sales: SalesFigures;
  estimasiAktif: number;
  userPsspAktif: number;
  userPsspAktifEstimasi: number;
  salesAktif: number;
  listingFeeTotal: number;
  avgPasienPerUser: number | null;
  avgStPerPasien: number | null;
  pelunasanRunningRate: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function toYYYYMM(y: number, m: number): string {
  return `${y}${String(m).padStart(2, "0")}`;
}

// Same "how far along a contract's own period has run" fraction as
// elapsedMonthsCount in LineItemEditor.tsx (ContractCard's Running Rate
// badge) — duplicated here rather than imported since that file is a
// client component. Returns 0 if the period is malformed.
function elapsedFraction(prdAwal: string, prdAkhir: string): number {
  const now = new Date();
  const currentYYYYMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sy = parseInt(prdAwal.slice(0, 4), 10), sm = parseInt(prdAwal.slice(4), 10);
  const ey = parseInt(prdAkhir.slice(0, 4), 10), em = parseInt(prdAkhir.slice(4), 10);
  const total = (ey - sy) * 12 + (em - sm) + 1;
  if (total <= 0) return 0;
  const cappedEnd = currentYYYYMM < prdAkhir ? currentYYYYMM : prdAkhir;
  const cy = parseInt(cappedEnd.slice(0, 4), 10), cm = parseInt(cappedEnd.slice(4), 10);
  const elapsed = Math.max(0, Math.min(total, (cy - sy) * 12 + (cm - sm) + 1));
  return elapsed / total;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");

  const params = await searchParams;
  const tab: Tab = (params.tab as Tab) ?? "mr";
  const periodFilter = params.period ?? null;
  // Fitur Sorting pada Summary (2026-07-27) — GAP tertinggi (vs realisasi
  // sebelumnya) is the default, matching the existing outlet/customer sort;
  // "estimasi" is the only alternative offered, since that's what produk/mr
  // already used as their (non-configurable) sort before this feature.
  const sortMode: "gap" | "estimasi" = params.sort === "estimasi" ? "estimasi" : "gap";
  const sortQuery = sortMode === "estimasi" ? "&sort=estimasi" : "";

  // ── Data ──────────────────────────────────────────────────────────────────

  // Shared helper (not a local reimplementation) so ADMIN/GM correctly see
  // every MR company-wide instead of walking nipAtasan from their own NIP —
  // neither role reports to/from anyone in that chain, so the old local
  // getSubordinateMRNips(nip) always returned an empty list for them
  // (2026-07-23 fix: "sebagai admin harusnya summary-nya kelihatan semua").
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({
        where: { nip: { in: mrNips } },
        orderBy: { name: "asc" },
      })) as { nip: string; name: string }[]
    : [];

  const NON_DRAFT = ["APPROVED_BY_ASM", "APPROVED_BY_SM", "APPROVED_BY_NSM"];
  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips }, status: { in: NON_DRAFT } };
  if (periodFilter) poaWhere.period = periodFilter;

  const [poas, allPoasForPeriods] = await Promise.all([
    mrNips.length > 0 ? prisma.poaForm.findMany({ where: poaWhere }) as Promise<{ id: string; ownerId: string; period: string }[]> : Promise.resolve([]),
    mrNips.length > 0 ? prisma.poaForm.findMany({ where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT } } }) as Promise<{ period: string }[]> : Promise.resolve([]),
  ]);

  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();
  const poaIds = poas.map((p) => p.id);

  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({ where: { poaId: { in: poaIds } } })) as {
        poaId: string;
        kodePI: string | null;
        kodeCust: string | null;
        namaCust: string;
        namaProduk: string;
        kodeProduk: string;
        statusStandarisasi: string | null;
        rencanaTotalBiaya: { toString(): string } | number;
        persenPsspDokter: { toString(): string } | number | null;
        persenDiskon: { toString(): string } | number | null;
        persenDp: { toString(): string } | number | null;
        persenListingFee: { toString(): string } | number | null;
        persenEntertain: { toString(): string } | number | null;
        pengaliNilaiR: { toString(): string } | number | null;
        jumlahPasienHari: number | null;
        qtyProdukResep: number | null;
      }[]
    : [];

  // Outlet names for the "outlet" tab
  const outletCodes = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];
  const outletRows = outletCodes.length > 0
    ? (await prisma.outlet.findMany({
        where: { kodePI: { in: outletCodes } },
        select: { kodePI: true, namaOutlet: true },
      })) as { kodePI: string; namaOutlet: string }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

  // Realisasi sebelumnya — every PSSP kontrak (running or already finished;
  // PsspKontrak has no separate "active" flag, prdAkhir in the past just
  // means it's done) aggregated by outlet and by customer, so the "outlet"
  // and "customer" tabs can be sorted by gap = estimasi sekarang - realisasi
  // sebelumnya (2026-07-24 request: surface "dulu jelek kok estimasinya
  // tinggi sekarang" outlets/customers at the top instead of by raw estimasi).
  const custCodes = [...new Set(lineItems.map((li) => li.kodeCust).filter(Boolean) as string[])];
  const [realisasiByOutletRaw, realisasiByCustRaw] = await Promise.all([
    outletCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdOutlet"], where: { kdOutlet: { in: outletCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
    custCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdCust"], where: { kdCust: { in: custCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
  ]) as [{ kdOutlet: string | null; _sum: { totalLunas: { toString(): string } | null } }[], { kdCust: string; _sum: { totalLunas: { toString(): string } | null } }[]];
  const realisasiByOutlet = new Map(realisasiByOutletRaw.filter((r) => r.kdOutlet).map((r) => [r.kdOutlet as string, toNum(r._sum.totalLunas)]));
  const realisasiByCust = new Map(realisasiByCustRaw.map((r) => [r.kdCust, toNum(r._sum.totalLunas)]));

  // Build poa→owner map
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  // ── Global unique totals (avoids cross-group double-counting) ─────────────

  const psspProdSet = new Set<string>();
  for (const li of lineItems) {
    const psspp = toNum(li.persenPsspDokter);
    if (psspp > 0) psspProdSet.add(li.kodeProduk);
  }

  const sudahSet = new Set(
    lineItems.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").map((li) => li.kodeProduk)
  );
  const prosesSet = new Set(
    lineItems
      .filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN" && !sudahSet.has(li.kodeProduk))
      .map((li) => li.kodeProduk)
  );
  const allProductSet = new Set(lineItems.map((li) => li.kodeProduk));

  const globalTotals: MonitoringTotals = {
    customer: new Set(lineItems.map((li) => li.namaCust)).size,
    variasiProdukFokus: new Set(
      lineItems.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)
    ).size,
    produkPssp: psspProdSet.size,
    sudahStandar: sudahSet.size,
    prosesStandar: prosesSet.size,
    totalUniqueProducts: allProductSet.size,
  };

  // ── Territory grouping ────────────────────────────────────────────────────

  type TerritoryKey = { code: string; name: string };

  function getTerritoryKey(li: typeof lineItems[0]): TerritoryKey {
    if (tab === "outlet") {
      const o = li.kodePI ? outletMap.get(li.kodePI) : null;
      return { code: li.kodePI ?? "—", name: o?.namaOutlet ?? "Tidak Diketahui" };
    }
    if (tab === "produk") {
      return { code: li.kodeProduk, name: li.namaProduk };
    }
    if (tab === "customer") {
      return { code: li.kodeCust ?? `no-code:${li.namaCust}`, name: li.namaCust };
    }
    const ownerNip = poaOwnerMap.get(li.poaId) ?? "—";
    const mr = mrUsers.find((u) => u.nip === ownerNip);
    return { code: ownerNip, name: mr?.name ?? ownerNip };
  }

  // An outlet's PIC is whichever MR(s) currently hold that specific
  // MrOutletAssignment — a SHADOW-pair outlet can have more than one holder.
  const mrOutletRows = mrNips.length > 0
    ? (await prisma.mrOutletAssignment.findMany({
        where: { nipMR: { in: mrNips } },
        select: { nipMR: true, kodePI: true },
      })) as { nipMR: string; kodePI: string }[]
    : [];
  const mrNamesByOutlet = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const mrName = mrUsers.find((u) => u.nip === row.nipMR)?.name ?? row.nipMR;
    const list = mrNamesByOutlet.get(row.kodePI) ?? [];
    list.push(mrName);
    mrNamesByOutlet.set(row.kodePI, list);
  }

  function findPic(code: string): string {
    if (tab === "mr") {
      const mr = mrUsers.find((u) => u.nip === code);
      return mr?.name ?? code;
    }
    if (tab === "outlet") {
      const names = mrNamesByOutlet.get(code);
      return names && names.length > 0 ? names.join(" / ") : "—";
    }
    return "—"; // "produk" tab — no single PIC concept for a product
  }

  // ── Matriks Summary Per Outlet / Per Produk (2026-07-27) ──────────────────
  // Fetched once regardless of which tab is active — both "outlet" and
  // "produk" need active-PSSP + real sales data, and the fetch is cheap
  // relative to the lineItems query above.
  const outletKodesForMR = [...new Set(mrOutletRows.map((r) => r.kodePI))];
  const SALES_2026_FROM = "202601";

  // "Data Sales" card in Ringkasan (2026-07-27 follow-up to the Matriks
  // Summary work above) — same DIR10001B-sourced OutletSalesValueMonthly,
  // just a wider period window (Jan last year → last completed month this
  // year) so historis/YTD/growth can be computed the same way
  // getMrSalesSummary (salesSummary.ts) already does for a single MR, just
  // generalized to whichever outlets belong to the active group.
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;
  const lastCompletedMonth = now.getMonth(); // 0 = no completed month yet (January)
  const lastYearFullFrom = toYYYYMM(lastYear, 1);
  const lastYearFullTo = toYYYYMM(lastYear, 12);
  const ytdFrom = toYYYYMM(currentYear, 1);
  const ytdTo = lastCompletedMonth > 0 ? toYYYYMM(currentYear, lastCompletedMonth) : null;
  const lastYearComparableTo = lastCompletedMonth > 0 ? toYYYYMM(lastYear, lastCompletedMonth) : null;

  const [activePssp, listingFeeRows, salesValueRaw, salesQtyRaw, salesHistoryRaw] = await Promise.all([
    outletKodesForMR.length > 0 ? getActivePsspByOutlets(outletKodesForMR) : Promise.resolve([] as ActivePsspRow[]),
    outletKodesForMR.length > 0
      ? prisma.listingFeeKontrak.findMany({ where: { kdOutlet: { in: outletKodesForMR } }, select: { kdOutlet: true, noreq: true, value: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0
      ? prisma.outletSalesValueMonthly.groupBy({ by: ["kodePI"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_2026_FROM } }, _sum: { valueSales: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0
      ? prisma.outletSalesMonthly.groupBy({ by: ["itemKode"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_2026_FROM } }, _sum: { qty: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0 && ytdTo
      ? prisma.outletSalesValueMonthly.findMany({
          where: { kodePI: { in: outletKodesForMR }, periode: { gte: lastYearFullFrom, lte: ytdTo } },
          select: { kodePI: true, periode: true, valueSales: true },
        })
      : Promise.resolve([]),
  ]) as [
    ActivePsspRow[],
    { kdOutlet: string | null; noreq: string; value: { toString(): string } }[],
    { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[],
    { itemKode: string; _sum: { qty: { toString(): string } | null } }[],
    { kodePI: string; periode: string; valueSales: { toString(): string } }[],
  ];

  interface SalesAgg { historisTahunLalu: number; ytd: number; comparable: number }
  const salesAggByOutlet = new Map<string, SalesAgg>();
  for (const row of salesHistoryRaw) {
    const v = toNum(row.valueSales);
    const agg = salesAggByOutlet.get(row.kodePI) ?? { historisTahunLalu: 0, ytd: 0, comparable: 0 };
    if (row.periode >= lastYearFullFrom && row.periode <= lastYearFullTo) agg.historisTahunLalu += v;
    if (ytdTo && row.periode >= ytdFrom && row.periode <= ytdTo) agg.ytd += v;
    if (lastYearComparableTo && row.periode >= lastYearFullFrom && row.periode <= lastYearComparableTo) agg.comparable += v;
    salesAggByOutlet.set(row.kodePI, agg);
  }
  const outletsByMr = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const list = outletsByMr.get(row.nipMR) ?? [];
    list.push(row.kodePI);
    outletsByMr.set(row.nipMR, list);
  }

  // DIR10001B is outlet-level only — no per-customer/per-product sales value
  // exists there, so "customer"/"produk" tabs have nothing real to show here
  // (produk's own "Sales Aktif" column elsewhere is a qty×HNA derivation, a
  // different metric — see salesValueByProduk above — not this card's YoY view).
  function realSalesAgg(code: string): SalesAgg {
    if (tab === "outlet") return salesAggByOutlet.get(code) ?? { historisTahunLalu: 0, ytd: 0, comparable: 0 };
    if (tab === "mr") {
      const outlets = outletsByMr.get(code) ?? [];
      return outlets.reduce((acc, o) => {
        const a = salesAggByOutlet.get(o);
        if (a) { acc.historisTahunLalu += a.historisTahunLalu; acc.ytd += a.ytd; acc.comparable += a.comparable; }
        return acc;
      }, { historisTahunLalu: 0, ytd: 0, comparable: 0 });
    }
    return { historisTahunLalu: 0, ytd: 0, comparable: 0 };
  }

  function computeRealSales(code: string, estimasi: number): SalesFigures {
    const agg = realSalesAgg(code);
    const salesPlusEst = agg.ytd + estimasi;
    const growthPct = agg.comparable > 0 ? ((agg.ytd - agg.comparable) / agg.comparable) * 100 : 0;
    const achievementBase = lastCompletedMonth > 0 && agg.historisTahunLalu > 0
      ? agg.historisTahunLalu * lastCompletedMonth / 12
      : 0;
    const achievementPct = achievementBase > 0 ? (salesPlusEst / achievementBase) * 100 : 0;
    return {
      historis2025: agg.historisTahunLalu,
      salesYtd: agg.ytd,
      salesPlusEst,
      growthPct,
      achievementPct,
      salesComparable: agg.comparable,
      achievementBase,
    };
  }

  // ListingFeeKontrak.value is the CONTRACT's total, repeated on every one of
  // its product rows (same "value duplicated per row" shape as PsspKontrak.biaya
  // — see computeActivePsspStats in activePssp.ts) — must dedupe by (outlet,
  // noreq) before summing, or a contract with N products would multiply-count
  // its own value N times (found via a live bug report: one outlet's Listing
  // Fee showed ~18x too high because its 22-product contract got summed 22
  // times instead of once).
  const seenListingFeeContract = new Set<string>();
  const listingFeeByOutlet = new Map<string, number>();
  for (const r of listingFeeRows) {
    if (!r.kdOutlet) continue;
    const key = `${r.kdOutlet}|${r.noreq}`;
    if (seenListingFeeContract.has(key)) continue;
    seenListingFeeContract.add(key);
    listingFeeByOutlet.set(r.kdOutlet, (listingFeeByOutlet.get(r.kdOutlet) ?? 0) + toNum(r.value));
  }
  const salesValueByOutlet = new Map(salesValueRaw.map((r) => [r.kodePI, toNum(r._sum.valueSales)]));
  const qtyByItemKode = new Map(salesQtyRaw.map((r) => [r.itemKode, toNum(r._sum.qty)]));

  // "Sales Aktif" per product is DERIVED (qty × HNA) rather than a real observed
  // Rupiah figure like the outlet-level one above — OutletSalesMonthly is a
  // quantity feed (same one targetCalculation.ts uses), there's no per-product
  // Rupiah sales value model. itemKode matches Product.kodeProduk directly
  // (unlike PSSP's kdProduk, which is a different code namespace entirely).
  const productCodesForSales = [...qtyByItemKode.keys()];
  const hnaProducts = productCodesForSales.length > 0
    ? (await prisma.product.findMany({
        where: { kodeProduk: { in: productCodesForSales } },
        select: { kodeProduk: true, hna: true },
      })) as { kodeProduk: string; hna: { toString(): string } }[]
    : [];
  const hnaByKodeProduk = new Map(hnaProducts.map((p) => [p.kodeProduk, toNum(p.hna)]));
  const salesValueByProduk = new Map<string, number>();
  for (const [itemKode, qty] of qtyByItemKode) {
    salesValueByProduk.set(itemKode, qty * (hnaByKodeProduk.get(itemKode) ?? 0));
  }

  // Active PSSP rows grouped by outlet (kdOutlet matches kodePI directly) and
  // by normalized product NAME (kdProduk ≠ kodeProduk, see normName above).
  const activePsspByOutlet = new Map<string, ActivePsspRow[]>();
  const activePsspByProdName = new Map<string, ActivePsspRow[]>();
  for (const r of activePssp) {
    if (r.kdOutlet) {
      const list = activePsspByOutlet.get(r.kdOutlet) ?? [];
      list.push(r);
      activePsspByOutlet.set(r.kdOutlet, list);
    }
    if (r.nmProduk) {
      const key = normName(r.nmProduk);
      const list = activePsspByProdName.get(key) ?? [];
      list.push(r);
      activePsspByProdName.set(key, list);
    }
  }

  const groupMap = new Map<string, { key: TerritoryKey; items: typeof lineItems }>();

  if (tab === "mr") {
    for (const mr of mrUsers) {
      groupMap.set(mr.nip, { key: { code: mr.nip, name: mr.name }, items: [] });
    }
  } else if (tab === "outlet") {
    const mrOutletDetails = outletKodesForMR.length > 0
      ? (await prisma.outlet.findMany({
          where: { kodePI: { in: outletKodesForMR } },
          select: { kodePI: true, namaOutlet: true },
        })) as { kodePI: string; namaOutlet: string }[]
      : [];
    for (const o of mrOutletDetails) {
      if (!groupMap.has(o.kodePI)) groupMap.set(o.kodePI, { key: { code: o.kodePI, name: o.namaOutlet }, items: [] });
    }
  }
  // "produk" tab: no pre-seeding — products only appear once actually planned.

  for (const li of lineItems) {
    const key = getTerritoryKey(li);
    if (!groupMap.has(key.code)) groupMap.set(key.code, { key, items: [] });
    groupMap.get(key.code)!.items.push(li);
  }

  const groups: TerritoryGroup[] = [...groupMap.values()]
    .map(({ key, items }) => {
      let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
      const produkPsspSet = new Set<string>();
      for (const li of items) {
        const base = toNum(li.rencanaTotalBiaya);
        const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
        const psspPct = toNum(li.persenPsspDokter) * pengaliNilaiR;
        const discPct = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
        const entPct  = toNum(li.persenEntertain);
        estimasi       += base;
        psspTotal      += base * psspPct;
        discountTotal  += base * discPct;
        entertainTotal += base * entPct;
        if (psspPct > 0) produkPsspSet.add(li.kodeProduk);
      }
      const terstandarisasi = items.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").length;
      const prosesStandar   = items.filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN").length;
      const realisasi = tab === "outlet" ? (realisasiByOutlet.get(key.code) ?? 0)
        : tab === "customer" ? (realisasiByCust.get(key.code) ?? 0)
        : 0;

      // Matriks Summary Per Outlet / Per Produk (2026-07-27) — active PSSP rows
      // matched by outlet code (outlet tab) or normalized product name (produk
      // tab, see normName). Both tabs get estimasiAktif/userPsspAktif; the
      // aktif+pengajuan UNION headcount and Listing Fee only apply per outlet.
      const activeRows = tab === "outlet" ? (activePsspByOutlet.get(key.code) ?? [])
        : tab === "produk" ? (activePsspByProdName.get(normName(key.name)) ?? [])
        : [];
      const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);

      // Pelunasan (%) dari Estimasi, secara Running Rate (2026-07-27 follow-up)
      // — outlet only. Same concept as ContractCard's per-contract Running Rate
      // badge: "expected lunas by now" = estBaris × (elapsed/total periode
      // kontrak), i.e. how much SHOULD already be paid given how far the
      // contract's own period has run. Aggregated across every active contract
      // at this outlet as actual÷expected (not an average of per-contract %),
      // so one badly-lagging contract can't get diluted out by an on-time one.
      let expectedLunas = 0, actualLunasForRR = 0;
      if (tab === "outlet") {
        const activeByContract = new Map<string, ActivePsspRow[]>();
        for (const r of activeRows) {
          const list = activeByContract.get(r.cUrut) ?? [];
          list.push(r);
          activeByContract.set(r.cUrut, list);
        }
        for (const rows of activeByContract.values()) {
          const sumEst = rows.reduce((s, r) => s + r.estBaris, 0);
          const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
          expectedLunas += sumEst * elapsedFraction(rows[0].prdAwal, rows[0].prdAkhir);
          actualLunasForRR += sumLunas;
        }
      }
      const pelunasanRunningRate = expectedLunas > 0 ? (actualLunasForRR / expectedLunas) * 100 : null;

      const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
      const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
      const userPsspAktifEstimasi = tab === "outlet"
        ? new Set([...activeCustKeys, ...draftCustKeys]).size
        : activeCustKeys.size;

      const salesAktif = tab === "outlet" ? (salesValueByOutlet.get(key.code) ?? 0)
        : tab === "produk" ? (salesValueByProduk.get(key.code) ?? 0)
        : 0;
      const listingFeeTotal = tab === "outlet" ? (listingFeeByOutlet.get(key.code) ?? 0) : 0;

      const pasienRows = items.filter((li) => li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
      const avgPasienPerUser = tab === "produk" && pasienRows.length > 0
        ? pasienRows.reduce((s, li) => s + li.jumlahPasienHari!, 0) / pasienRows.length
        : null;
      const stRows = items.filter((li) => li.qtyProdukResep != null && li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
      const avgStPerPasien = tab === "produk" && stRows.length > 0
        ? stRows.reduce((s, li) => s + li.qtyProdukResep! / li.jumlahPasienHari!, 0) / stRows.length
        : null;

      return {
        code: key.code,
        name: key.name,
        pic: findPic(key.code),
        estimasi,
        variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
        variasiProdukFokus: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
        produkPssp: produkPsspSet.size,
        customer: new Set(items.map((li) => li.namaCust)).size,
        pengajuan: items.length,
        terstandarisasi,
        prosesStandar,
        gap: items.length - terstandarisasi,
        psspTotal,
        discountTotal,
        entertainTotal,
        budgetTotal: psspTotal + discountTotal + entertainTotal,
        realisasi,
        gapVsRealisasi: estimasi - realisasi,
        sales: computeRealSales(key.code, estimasi),
        estimasiAktif,
        userPsspAktif: activeCustKeys.size,
        userPsspAktifEstimasi,
        salesAktif,
        listingFeeTotal,
        avgPasienPerUser,
        avgStPerPasien,
        pelunasanRunningRate,
      };
    })
    // "outlet"/"customer": GAP tertinggi (vs prior realisasi) is the default —
    // flags "dulu jelek kok estimasinya tinggi sekarang" — with "Estimasi
    // Tertinggi" as the user-selectable alternative (sortMode, #51 2026-07-27).
    // Other tabs have no realisasi/gap concept at all, so they always sort by
    // estimasi regardless of sortMode.
    .sort((a, b) => {
      if (sortMode !== "gap" || !(tab === "outlet" || tab === "customer")) {
        return b.estimasi - a.estimasi;
      }
      // "outlet": PSSP Aktif paling atas dulu (official spec, item #2: "Urutkan
      // outlet dengan PSSP Aktif paling atas, lalu urutkan berdasarkan GAP
      // Tertinggi") — briefly reverted to realisasi-based on 2026-07-27, then
      // reverted back per the spec re-confirmed same day. "customer" has no
      // PSSP-aktif concept computed (activeRows above is only populated for
      // "outlet"/"produk"), so it keeps the realisasi-based criterion.
      const aHas = tab === "outlet" ? a.estimasiAktif > 0 : a.realisasi > 0;
      const bHas = tab === "outlet" ? b.estimasiAktif > 0 : b.realisasi > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return aHas ? b.gapVsRealisasi - a.gapVsRealisasi : b.estimasi - a.estimasi;
    });

  // ── Tab labels ────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: "outlet",   label: "Per Outlet" },
    { key: "customer", label: "Per Customer" },
    { key: "produk",   label: "Per Produk" },
    { key: "mr",       label: "Per Personil" },
  ];
  const CODE_LABEL: Record<Tab, string> = {
    outlet: "Outlet", customer: "Customer", produk: "Produk", mr: "Personil",
  };

  const monitoringGroups: MonitoringGroup[] = groups.map((g) => ({
    code: g.code,
    name: g.name,
    pic: g.pic,
    estimasi: g.estimasi,
    variasiProduk: g.variasiProduk,
    variasiProdukFokus: g.variasiProdukFokus,
    produkPssp: g.produkPssp,
    customer: g.customer,
    pengajuan: g.pengajuan,
    terstandarisasi: g.terstandarisasi,
    prosesStandar: g.prosesStandar,
    gap: g.gap,
    psspTotal: g.psspTotal,
    discountTotal: g.discountTotal,
    entertainTotal: g.entertainTotal,
    budgetTotal: g.budgetTotal,
    realisasi: g.realisasi,
    gapVsRealisasi: g.gapVsRealisasi,
    historis2025: g.sales.historis2025,
    salesYtd: g.sales.salesYtd,
    salesPlusEst: g.sales.salesPlusEst,
    growthPct: g.sales.growthPct,
    achievementPct: g.sales.achievementPct,
    salesComparable: g.sales.salesComparable,
    achievementBase: g.sales.achievementBase,
    estimasiAktif: g.estimasiAktif,
    userPsspAktif: g.userPsspAktif,
    userPsspAktifEstimasi: g.userPsspAktifEstimasi,
    salesAktif: g.salesAktif,
    listingFeeTotal: g.listingFeeTotal,
    avgPasienPerUser: g.avgPasienPerUser,
    avgStPerPasien: g.avgStPerPasien,
    pelunasanRunningRate: g.pelunasanRunningRate,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Summary POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
          </p>
        </div>

        {/* Period filter */}
        {allPeriods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/summary?tab=${tab}${sortQuery}`}
              className="rounded px-2.5 py-1 text-xs font-medium border"
              style={!periodFilter
                ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
              Semua
            </Link>
            {allPeriods.map((p) => (
              <Link key={p} href={`/summary?tab=${tab}&period=${p}${sortQuery}`}
                className="rounded px-2.5 py-1 text-xs font-medium border"
                style={periodFilter === p
                  ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
                  : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
                {p}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <Card padded={false}>
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link key={t.key}
              href={`/summary?tab=${t.key}${periodFilter ? `&period=${periodFilter}` : ""}${sortQuery}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={tab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}>
              {t.label}
            </Link>
          ))}
        </div>
      </Card>

      {/* Fitur Sorting pada Summary (2026-07-27, #51) — only meaningful for
          "outlet"/"customer", the only tabs with a real GAP-vs-realisasi
          concept; produk/mr always sort by estimasi so the toggle would be
          a no-op there. */}
      {(tab === "outlet" || tab === "customer") && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Urutkan:</span>
          <Link href={`/summary?tab=${tab}${periodFilter ? `&period=${periodFilter}` : ""}`}
            className="rounded px-2.5 py-1 text-xs font-medium border"
            style={sortMode === "gap"
              ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
              : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
            GAP Tertinggi
          </Link>
          <Link href={`/summary?tab=${tab}${periodFilter ? `&period=${periodFilter}` : ""}&sort=estimasi`}
            className="rounded px-2.5 py-1 text-xs font-medium border"
            style={sortMode === "estimasi"
              ? { background: "var(--color-blue)", color: "#fff", borderColor: "var(--color-blue)" }
              : { color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
            Estimasi Tertinggi
          </Link>
        </div>
      )}

      {/* Stats */}
      <MonitoringChecklist groups={monitoringGroups} totals={globalTotals} salesAvailable={tab === "outlet" || tab === "mr"} />

      {/* Per-row breakdown for the active tab — Ringkasan above only shows the
          grand total, this is what actually differs between tabs. */}
      <TerritoryTable groups={monitoringGroups} codeLabel={CODE_LABEL[tab]} showRealisasi={tab === "outlet" || tab === "customer"} variant={tab} />
    </div>
  );
}
