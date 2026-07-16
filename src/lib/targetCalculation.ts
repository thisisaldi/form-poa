/**
 * Quarterly target calculation engine — ports the two-phase methodology from
 * "Rev 3 - Turunan Target produk.xlsx" (sheet "1. Acetram") to work off live
 * app data, generalized to a clean 3-month quarter (the source spreadsheet's
 * quarter rollup was a one-off hack tied to its mid-2026 data gap).
 *
 * Targets are unit-QUANTITY based (not Rupiah) — Rupiah value is qty × HNA,
 * derived for display only. Computed once per focus product, at SM-territory
 * level (a "territory" = one SM's group of active MRs, across all their ASMs);
 * NSM totals are a simple sum of their SMs' quarterly quantity/value.
 *
 * Phase 1 — Ratio: each SM territory's monthly qty target is the company-wide
 *   "Target Final" qty (trailing monthly qty average + a manually-set monthly
 *   stretch ramp) allocated by that territory's share of trailing qty sold.
 *
 * Phase 2 — Productivity equalization: territories with below-average
 *   qty-per-FF get a flat addition; that addition is funded by a flat,
 *   proportional subtraction from above-average territories, so the total
 *   target across all territories is unchanged (zero-sum redistribution).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getAllPakets } from "@/lib/paketProduk";

// ─── Period helpers ────────────────────────────────────────────────────────

function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

function addMonths(yyyymm: string, n: number): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  const date = new Date(year, month - 1 + n, 1);
  return toYYYYMM(date.getFullYear(), date.getMonth() + 1);
}

/** "2026-Q3" -> ["202607", "202608", "202609"] */
export function quarterToMonths(quarter: string): string[] {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Invalid quarter format: ${quarter}`);
  const year = parseInt(m[1], 10);
  const q = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3 + 1;
  return [0, 1, 2].map((i) => toYYYYMM(year, startMonth + i));
}

/** The 6 months immediately preceding the quarter's first month. */
function historicalMonths(targetMonths: string[]): string[] {
  const first = targetMonths[0];
  const months: string[] = [];
  for (let i = 6; i >= 1; i--) months.push(addMonths(first, -i));
  return months;
}

// ─── Org helpers ───────────────────────────────────────────────────────────

export interface OrgMaps {
  outletToSm: Map<string, string>;       // kodePI -> SM nip
  ffCountBySm: Map<string, number>;       // SM nip -> active MR count
  smInfo: Map<string, { name: string; nipAtasan: string | null }>; // SM nip -> {name, NSM nip}
  nsmInfo: Map<string, string>;           // NSM nip -> name
  mrsBySm: Map<string, string[]>;         // SM nip -> active MR nips under it
}

export async function buildOrgMaps(): Promise<OrgMaps> {
  const [activeSms, activeAsms, activeMrs, assignments, nsms] = await Promise.all([
    prisma.user.findMany({ where: { role: "SM", isActive: true }, select: { nip: true, name: true, nipAtasan: true } }),
    prisma.user.findMany({ where: { role: "ASM", isActive: true }, select: { nip: true, nipAtasan: true } }),
    prisma.user.findMany({ where: { role: "MR", isActive: true }, select: { nip: true, nipAtasan: true } }),
    prisma.mrOutletAssignment.findMany({ select: { nipMR: true, kodePI: true } }),
    prisma.user.findMany({ where: { role: "NSM", isActive: true }, select: { nip: true, name: true } }),
  ]);

  const asmToSm = new Map<string, string>(); // ASM nip -> SM nip
  for (const asm of activeAsms) if (asm.nipAtasan) asmToSm.set(asm.nip, asm.nipAtasan);

  const mrToSm = new Map<string, string>(); // MR nip -> SM nip (via its ASM)
  for (const mr of activeMrs) {
    if (!mr.nipAtasan) continue;
    const smNip = asmToSm.get(mr.nipAtasan);
    if (smNip) mrToSm.set(mr.nip, smNip);
  }

  const outletToSm = new Map<string, string>();
  for (const a of assignments) {
    const smNip = mrToSm.get(a.nipMR);
    if (smNip) outletToSm.set(a.kodePI, smNip);
  }

  const ffCountBySm = new Map<string, number>();
  const mrsBySm = new Map<string, string[]>();
  for (const mr of activeMrs) {
    const smNip = mr.nipAtasan ? mrToSm.get(mr.nip) : undefined;
    if (!smNip) continue;
    ffCountBySm.set(smNip, (ffCountBySm.get(smNip) ?? 0) + 1);
    const list = mrsBySm.get(smNip) ?? [];
    list.push(mr.nip);
    mrsBySm.set(smNip, list);
  }

  const smInfo = new Map<string, { name: string; nipAtasan: string | null }>();
  for (const sm of activeSms) smInfo.set(sm.nip, { name: sm.name, nipAtasan: sm.nipAtasan });

  const nsmInfo = new Map<string, string>();
  for (const n of nsms) nsmInfo.set(n.nip, n.name);

  return { outletToSm, ffCountBySm, smInfo, nsmInfo, mrsBySm };
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SmTerritoryResult {
  smNip: string;
  smName: string;
  nsmNip: string | null;
  ffCount: number;
  historicalQty: number;
  historicalAvgQty: number;
  ratio: number;
  productivity: number;
  productivityGap: number;
  addition: number;
  subtraction: number;
  monthlyTargetQty: Record<string, number>;
  quarterlyTargetQty: number;
  quarterlyTargetValue: number; // qty × HNA
  perMrTargetQty: number;
  perMrTargetValue: number;
}

export interface ProductTargetResult {
  kodeProduk: string;
  namaProduk: string;
  hna: number;
  monthlyRamp: number;
  hasRampInput: boolean; // false if no ProductTargetInput was set (ramp defaulted to 0)
  companyHistoricalQty: number;
  companyMonthlyAvgQty: number;
  targetFinalQtyByMonth: Record<string, number>;
  territories: SmTerritoryResult[];
}

/** Computes the per-SM-territory quantity target for ONE product in ONE quarter. */
export async function computeProductQuarterlyTarget(
  kodeProduk: string,
  namaProduk: string,
  hna: number,
  quarter: string,
  monthlyRamp: number,
  hasRampInput: boolean,
  org: OrgMaps
): Promise<ProductTargetResult> {
  const targetMonths = quarterToMonths(quarter);
  const histMonths = historicalMonths(targetMonths);

  const salesRows = await prisma.outletSalesMonthly.findMany({
    where: { itemKode: kodeProduk, periode: { in: histMonths } },
    select: { kodePI: true, periode: true, qty: true },
  });

  const monthlyBySm = new Map<string, Map<string, number>>(); // smNip -> (periode -> qty)
  for (const row of salesRows) {
    const smNip = org.outletToSm.get(row.kodePI);
    if (!smNip) continue; // outlet not under any active MR/ASM/SM — excluded from this closed system
    const byMonth = monthlyBySm.get(smNip) ?? new Map<string, number>();
    const v = parseFloat(row.qty.toString()) || 0;
    byMonth.set(row.periode, (byMonth.get(row.periode) ?? 0) + v);
    monthlyBySm.set(smNip, byMonth);
  }

  type Prelim = { smNip: string; smName: string; nsmNip: string | null; ffCount: number; historicalQty: number; historicalAvgQty: number };
  const prelim: Prelim[] = [];
  for (const [smNip, ffCount] of org.ffCountBySm) {
    if (ffCount === 0) continue;
    const info = org.smInfo.get(smNip);
    if (!info) continue;
    const byMonth = monthlyBySm.get(smNip);
    const total = byMonth ? [...byMonth.values()].reduce((s, v) => s + v, 0) : 0;
    prelim.push({ smNip, smName: info.name, nsmNip: info.nipAtasan, ffCount, historicalQty: total, historicalAvgQty: total / 6 });
  }

  const companyHistoricalQty = prelim.reduce((s, p) => s + p.historicalQty, 0);
  const companyMonthlyAvgQty = companyHistoricalQty / 6;

  const targetFinalQtyByMonth: Record<string, number> = {};
  targetMonths.forEach((m, i) => { targetFinalQtyByMonth[m] = companyMonthlyAvgQty + monthlyRamp * (i + 1); });

  const productivityBySm = new Map<string, number>();
  for (const p of prelim) productivityBySm.set(p.smNip, p.ffCount > 0 ? p.historicalAvgQty / p.ffCount : 0);
  const avgProductivity = prelim.length > 0
    ? [...productivityBySm.values()].reduce((s, v) => s + v, 0) / prelim.length
    : 0;

  const additionBySm = new Map<string, number>();
  const gapBySm = new Map<string, number>();
  let totalAdditionPool = 0;
  let sumPositiveGaps = 0;
  for (const p of prelim) {
    const gap = (productivityBySm.get(p.smNip) ?? 0) - avgProductivity;
    gapBySm.set(p.smNip, gap);
    const addition = gap > 0 ? 0 : Math.abs(gap * p.ffCount);
    additionBySm.set(p.smNip, addition);
    totalAdditionPool += addition;
    if (gap > 0) sumPositiveGaps += gap;
  }

  const territories: SmTerritoryResult[] = prelim.map((p) => {
    const ratio = companyHistoricalQty > 0 ? p.historicalQty / companyHistoricalQty : 0;
    const gap = gapBySm.get(p.smNip) ?? 0;
    const addition = additionBySm.get(p.smNip) ?? 0;
    const multiplier = gap > 0 && sumPositiveGaps > 0 ? gap / sumPositiveGaps : 0;
    const subtraction = addition > 0 ? 0 : multiplier * totalAdditionPool;

    const monthlyTargetQty: Record<string, number> = {};
    let quarterlyTargetQty = 0;
    for (const m of targetMonths) {
      const phase1 = ratio * targetFinalQtyByMonth[m];
      const final = Math.max(0, phase1 + addition - subtraction);
      monthlyTargetQty[m] = final;
      quarterlyTargetQty += final;
    }

    return {
      smNip: p.smNip,
      smName: p.smName,
      nsmNip: p.nsmNip,
      ffCount: p.ffCount,
      historicalQty: p.historicalQty,
      historicalAvgQty: p.historicalAvgQty,
      ratio,
      productivity: productivityBySm.get(p.smNip) ?? 0,
      productivityGap: gap,
      addition,
      subtraction,
      monthlyTargetQty,
      quarterlyTargetQty,
      quarterlyTargetValue: quarterlyTargetQty * hna,
      perMrTargetQty: p.ffCount > 0 ? quarterlyTargetQty / p.ffCount : 0,
      perMrTargetValue: p.ffCount > 0 ? (quarterlyTargetQty * hna) / p.ffCount : 0,
    };
  });

  return {
    kodeProduk,
    namaProduk,
    hna,
    monthlyRamp,
    hasRampInput,
    companyHistoricalQty,
    companyMonthlyAvgQty,
    targetFinalQtyByMonth,
    territories,
  };
}

// ─── Batch summary across all focus products ───────────────────────────────

export interface SmSummaryRow {
  smNip: string;
  smName: string;
  nsmNip: string | null;
  ffCount: number;
  totalQty: number;
  totalValue: number;
}

export interface NsmSummaryRow {
  nsmNip: string;
  nsmName: string;
  totalQty: number;
  totalValue: number;
}

export interface QuarterlyFocusSummary {
  quarter: string;
  targetMonths: string[];
  products: ProductTargetResult[];
  bySm: SmSummaryRow[];
  byNsm: NsmSummaryRow[];
  productsMissingRamp: { kodeProduk: string; namaProduk: string }[];
}

/** Runs the per-product SM-territory simulation for every focus product, then rolls up to SM and NSM totals. */
export async function computeFocusProductTargetsSummary(quarter: string): Promise<QuarterlyFocusSummary> {
  const { getProducts } = await import("@/lib/masterData");
  const allProducts = await getProducts();
  const focusProducts = allProducts.filter((p) => getAllPakets(p.namaProduk).length > 0);

  const org = await buildOrgMaps();

  const rampInputs = await prisma.productTargetInput.findMany({
    where: { quarter, kodeProduk: { in: focusProducts.map((p) => p.kodeProduk) } },
  });
  const rampByKode = new Map<string, number>();
  for (const r of rampInputs) rampByKode.set(r.kodeProduk, parseFloat(r.monthlyRamp.toString()) || 0);

  const products: ProductTargetResult[] = [];
  const productsMissingRamp: { kodeProduk: string; namaProduk: string }[] = [];
  for (const p of focusProducts) {
    const hasRampInput = rampByKode.has(p.kodeProduk);
    if (!hasRampInput) productsMissingRamp.push({ kodeProduk: p.kodeProduk, namaProduk: p.namaProduk });
    const result = await computeProductQuarterlyTarget(
      p.kodeProduk,
      p.namaProduk,
      parseFloat(p.hna) || 0,
      quarter,
      rampByKode.get(p.kodeProduk) ?? 0,
      hasRampInput,
      org
    );
    products.push(result);
  }

  // Roll up to SM level (sum across all focus products).
  const smAgg = new Map<string, SmSummaryRow>();
  for (const product of products) {
    for (const t of product.territories) {
      const row = smAgg.get(t.smNip) ?? { smNip: t.smNip, smName: t.smName, nsmNip: t.nsmNip, ffCount: t.ffCount, totalQty: 0, totalValue: 0 };
      row.totalQty += t.quarterlyTargetQty;
      row.totalValue += t.quarterlyTargetValue;
      smAgg.set(t.smNip, row);
    }
  }
  const bySm = [...smAgg.values()].sort((a, b) => b.totalValue - a.totalValue);

  // Roll up to NSM level (sum of SMs under each NSM).
  const nsmAgg = new Map<string, NsmSummaryRow>();
  for (const sm of bySm) {
    if (!sm.nsmNip) continue;
    const nsmName = org.nsmInfo.get(sm.nsmNip) ?? sm.nsmNip;
    const row = nsmAgg.get(sm.nsmNip) ?? { nsmNip: sm.nsmNip, nsmName, totalQty: 0, totalValue: 0 };
    row.totalQty += sm.totalQty;
    row.totalValue += sm.totalValue;
    nsmAgg.set(sm.nsmNip, row);
  }
  const byNsm = [...nsmAgg.values()].sort((a, b) => b.totalValue - a.totalValue);

  return {
    quarter,
    targetMonths: quarterToMonths(quarter),
    products,
    bySm,
    byNsm,
    productsMissingRamp,
  };
}

// ─── Policy input (Tambahan Target) ────────────────────────────────────────

export async function setProductTargetInput(
  kodeProduk: string,
  quarter: string,
  monthlyRamp: number,
  setBy: string | null
) {
  return prisma.productTargetInput.upsert({
    where: { kodeProduk_quarter: { kodeProduk, quarter } },
    create: { kodeProduk, quarter, monthlyRamp: new Prisma.Decimal(monthlyRamp), setBy },
    update: { monthlyRamp: new Prisma.Decimal(monthlyRamp), setBy },
  });
}

export async function getProductTargetInput(kodeProduk: string, quarter: string): Promise<number | null> {
  const row = await prisma.productTargetInput.findUnique({
    where: { kodeProduk_quarter: { kodeProduk, quarter } },
  });
  return row ? parseFloat(row.monthlyRamp.toString()) || 0 : null;
}

export async function listFocusProducts(): Promise<{ kodeProduk: string; namaProduk: string }[]> {
  const { getProducts } = await import("@/lib/masterData");
  const allProducts = await getProducts();
  return allProducts
    .filter((p) => getAllPakets(p.namaProduk).length > 0)
    .map((p) => ({ kodeProduk: p.kodeProduk, namaProduk: p.namaProduk }));
}
