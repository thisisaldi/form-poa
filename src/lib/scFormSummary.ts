import { quarterToMonths } from "@/lib/quarterUtils";
import { computeScMetrics, type ScMetricsDraft } from "@/lib/scFormMetrics";
import { calculateCashbackDetails, type CashbackData } from "@/lib/scCashback";
import {
  calculateProductDetailRows,
  isCashbackResponseNotFound,
  scGrowthCategory,
} from "@/components/sc/detail/utils/outletCalculationUtils";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";

/**
 * Per-form SC summary, computed once when the MR saves and stored on
 * PoaScForm / PoaScProductItem so pages can SUM columns instead of reloading
 * every product and calling Canvasser per outlet (docs/sc-form-summary).
 *
 * Pure: no I/O. External data comes in through ScSummaryInputs
 * (scFormSummaryLoader.ts fetches it). Arithmetic goes through
 * computeScMetrics, the same function the stats panel runs — except cashback,
 * which follows the editor (computeScSummaryCashback).
 */

/** Bump when the formula or its inputs change, then re-run the backfill with --force. */
export const SUMMARY_VERSION = 1;

/** PoaScForm columns written by the summary. Decimal, so they must not reach client components as-is. */
export const SC_FORM_SUMMARY_COLUMNS = [
  "sumEstimasiSales",
  "sumNilaiSc",
  "sumDiskon",
  "sumCashback",
  "sumEntertain",
  "sumBudgetSc",
  "tercacahEstimasiSales",
  "tercacahNilaiSc",
  "historySalesQuarter",
  "monthlyBreakdown",
  "historyPeriodEnd",
  "scProductListId",
  "totalScProducts",
  "countIntensifikasi",
  "countEkstensifikasi",
  "countPenurunan",
  "countTetap",
  "summaryVersion",
  "summaryComputedAt",
] as const;

/** PoaScProductItem columns written by the summary. */
export const SC_PRODUCT_SUMMARY_COLUMNS = [
  "salesCounterValue",
  "salesCounterMinimum",
  "hnaSnapshot",
  "historySalesB3",
  "cashbackSnapshot",
] as const;

/** Copy of a row without the given columns. */
export function omitColumns<T extends Record<string, unknown>>(row: T, columns: readonly string[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const c of columns) delete copy[c];
  return copy as T;
}

/** One PoaScProductItem row as stored. */
export interface ScSummaryProductRow {
  kodeProduk: string;
  periodeMonth: string;
  qtyPerBulan: number;
  persenMatriksSc: number;
  persenDiskon: number;
  persenCashback: number;
}

export interface ScSummaryForm {
  kodePI: string;
  period: string; // "2026-Q4"
  periodeAwal: string; // "202610"
  lamaPeriode: number;
  products: ScSummaryProductRow[];
  persons: { id: string; outletPersonId: string }[];
  entertainItems: { biayaEntertain: number }[];
}

export interface ScSummaryInputs {
  /** get-sales-counter-product rows for this outlet (Canvasser). */
  scProducts: SalesCounterProduct[];
  /** YYYYMM whose list `scProducts` is. */
  scProductPeriod: string;
  /** HNA per kodeProduk: Exodus sell_price, falling back to Product.hna. */
  hnaByKode: Map<string, number>;
  /** Product.konversiPembagi per kodeProduk (passed to cashback like the panel does). */
  konversiByKode: Map<string, number | null>;
  /** get-cashback-poa response for this outlet (404 body when not found). */
  cashbackData: CashbackData | null;
  /** B-3 history sales of the outlet's SC products (parseScHistorySales). */
  history: ScHistorySales;
  /** Last month (YYYYMM) of the B-3 window `history` was fetched for. */
  historyPeriodEnd: number;
}

export interface ScHistorySales {
  /** Σ sales_value (3-month total) over the outlet's SC products. */
  total: number;
  /** Average sales per month per SC product, keyed by normalized code (no leading zeros, upper case). */
  avgByCode: Map<string, number>;
}

export interface ScGrowthCounts {
  countIntensifikasi: number;
  countEkstensifikasi: number;
  countPenurunan: number;
  countTetap: number;
}

/** Frozen per-row values, written back to PoaScProductItem. */
export interface ScSummaryProductFreeze {
  kodeProduk: string;
  periodeMonth: string;
  /** null = not an SC product of the outlet at save time (left out of the totals). */
  salesCounterValue: number | null;
  salesCounterMinimum: number | null;
  hnaSnapshot: number;
  /** Average B-3 sales per month of the product; the same on every month row. null = not an SC product. */
  historySalesB3: number | null;
  /** Cashback of the product for this row's month; rows add up to sumCashback. null = not an SC product. */
  cashbackSnapshot: number | null;
}

export interface ScFormSummaryValues {
  sumEstimasiSales: number;
  sumNilaiSc: number;
  sumDiskon: number;
  sumCashback: number;
  sumEntertain: number;
  sumBudgetSc: number;
  tercacahEstimasiSales: number;
  tercacahNilaiSc: number;
  historySalesQuarter: number;
  monthlyBreakdown: Record<string, { estimasiSales: number; nilaiSc: number; cashback: number }>;
  historyPeriodEnd: number;
  totalScProducts: number;
  countIntensifikasi: number;
  countEkstensifikasi: number;
  countPenurunan: number;
  countTetap: number;
  summaryVersion: number;
}

export interface ScFormSummaryResult {
  summary: ScFormSummaryValues;
  products: ScSummaryProductFreeze[];
  /** Canvasser's SC product list the summary was computed with (stored once per month in PoaScProductList). */
  scProductList: { period: string; proCodes: string[] };
}

const stripLeadingZeros = (code: string) => code.replace(/^0+/, "");
const normalizeCode = (code: string) => stripLeadingZeros(String(code || "")).toUpperCase();

/** post-history-sales is always asked for the 3 B-3 months. */
const HISTORY_MONTHS = 3;

/** SC product codes of an outlet, in every spelling the detail page matches on. */
export function scProductCodeSet(scProducts: SalesCounterProduct[]): Set<string> {
  const scCodes = new Set<string>();
  for (const cp of scProducts) {
    if (cp.pro_code) {
      scCodes.add(cp.pro_code);
      scCodes.add(stripLeadingZeros(String(cp.pro_code)).toUpperCase());
    }
    if (cp.kode_item) {
      scCodes.add(cp.kode_item);
      scCodes.add(stripLeadingZeros(String(cp.kode_item)).toUpperCase());
    }
  }
  return scCodes;
}

/** pro_code of every SC product in a Canvasser list — what gets stored in PoaScProductList.proCodes. */
export function scProCodes(scProducts: SalesCounterProduct[]): string[] {
  return Array.from(new Set(scProducts.map((cp) => cp.pro_code).filter(Boolean))).sort();
}

/**
 * The set parseScHistorySales filters on. post-history-sales keys its products
 * by pro_code (7 digits, Canvasser's code), so only pro_code is matched —
 * kode_item (6 digits, Pharos' code) is a different number space and matching
 * on it could only let another product's sales in. Leading zeros are ignored.
 */
export function scHistoryCodeSet(proCodes: readonly string[]): Set<string> {
  return new Set(proCodes.map(normalizeCode).filter(Boolean));
}

/**
 * History sales B-3 for one outlet from a post-history-sales `agg: "True"`
 * response, limited to the outlet's SC products (`scCodes` from
 * scHistoryCodeSet) with each product counted once. `total` is Σ sales_value (3 months), the same value as the outlet
 * card's "Histori Sales (B-3)" × 3; `avgByCode` is sales_value ÷ 3 per product,
 * what the card's growth column compares against (useSalesCounterOutletData
 * dedupes by normalized code the same way). Not the detail page's server loop,
 * which sums both the "0100683" and "100683" entries of
 * parseOutletHistorySales' map and so doubles the total.
 */
export function parseScHistorySales(
  response: { data?: Record<string, unknown> | null } | null | undefined,
  kodePI: string,
  scCodes: Set<string>
): ScHistorySales {
  const result: ScHistorySales = { total: 0, avgByCode: new Map() };
  if (!response?.data || scCodes.size === 0) return result;
  const pi = String(kodePI || "").trim();
  const outlet = (response.data[pi] ?? response.data[pi.toUpperCase()] ?? response.data[pi.toLowerCase()]) as
    | Record<string, unknown>
    | undefined;
  if (!outlet || typeof outlet !== "object") return result;

  for (const [code, item] of Object.entries(outlet)) {
    if (code === "total_sales" || code === "average_sales") continue;
    if (!item || typeof item !== "object") continue;
    const norm = normalizeCode(code);
    if (result.avgByCode.has(norm)) continue;
    if (!scCodes.has(norm)) continue;
    const salesValue = Number((item as { sales_value?: unknown }).sales_value) || 0;
    result.avgByCode.set(norm, salesValue / HISTORY_MONTHS);
    result.total += salesValue;
  }
  return result;
}

/**
 * Builds the draft computeScMetrics reads, the same way getSalesCounterDetailData
 * builds the detail page's scDrafts: only the outlet's SC products (all rows
 * when Canvasser lists none), sales_counter_value looked up by exact pro_code,
 * HNA per kodeProduk, konversiPembagi defaulting to 1.
 */
export function buildScSummaryDraft(form: ScSummaryForm, inputs: ScSummaryInputs): {
  draft: ScMetricsDraft;
  products: ScSummaryProductFreeze[];
} {
  const scCodes = scProductCodeSet(inputs.scProducts);
  const scByProCode = new Map<string, SalesCounterProduct>();
  for (const cp of inputs.scProducts) {
    if (cp.pro_code) scByProCode.set(cp.pro_code, cp);
  }

  const isScRow = (kodeProduk: string) =>
    scCodes.size === 0 ||
    scCodes.has(kodeProduk) ||
    scCodes.has(stripLeadingZeros(String(kodeProduk || "")));

  const products: ScSummaryProductFreeze[] = [];
  const draftProducts: ScMetricsDraft["products"] = [];

  for (const p of form.products) {
    const hnaSJ = inputs.hnaByKode.get(p.kodeProduk) ?? 0;
    if (!isScRow(p.kodeProduk)) {
      products.push({
        kodeProduk: p.kodeProduk,
        periodeMonth: p.periodeMonth,
        salesCounterValue: null,
        salesCounterMinimum: null,
        hnaSnapshot: hnaSJ,
        historySalesB3: null,
        cashbackSnapshot: null,
      });
      continue;
    }
    const cp = scByProCode.get(p.kodeProduk);
    const salesCounterValue = cp?.sales_counter_value || 0;
    const salesCounterMinimum = cp?.sales_counter_minimum || 0;
    const konversi = inputs.konversiByKode.get(p.kodeProduk);

    // historySalesB3 / cashbackSnapshot are filled in by computeScFormSummary.
    products.push({
      kodeProduk: p.kodeProduk,
      periodeMonth: p.periodeMonth,
      salesCounterValue,
      salesCounterMinimum,
      hnaSnapshot: hnaSJ,
      historySalesB3: 0,
      cashbackSnapshot: 0,
    });
    draftProducts.push({
      kodeProduk: p.kodeProduk,
      periodeMonth: p.periodeMonth,
      qtyPerBulan: p.qtyPerBulan,
      persenMatriksSc: p.persenMatriksSc,
      persenDiskon: p.persenDiskon,
      persenCashback: p.persenCashback,
      hnaSJ,
      konversiPembagi: konversi ? konversi : 1,
      salesCounterValue,
      salesCounterMinimum,
    });
  }

  return {
    draft: {
      kodePI: form.kodePI,
      periodeAwal: form.periodeAwal,
      lamaPeriode: form.lamaPeriode,
      historySalesQuarter: inputs.history.total,
      products: draftProducts,
      persons: form.persons.map((p) => ({ id: p.id, outletPersonId: p.outletPersonId, nik_ktp: p.outletPersonId })),
      entertainItems: form.entertainItems,
    },
    products,
  };
}

function safeQuarterMonths(period: string): string[] {
  try {
    return quarterToMonths(period);
  } catch {
    return [];
  }
}

/**
 * Calendar months of the form, resolved like saveSalesCounterFormAction and the
 * editor do: the quarter's months, else `lama` months from periodeAwal.
 */
function formMonths(form: ScSummaryForm): string[] {
  const lama = Math.max(1, form.lamaPeriode || 3);
  const quarter = safeQuarterMonths(form.period);
  if (quarter.length === lama) return quarter;

  const startYear = parseInt(form.periodeAwal.slice(0, 4), 10);
  const startMonth = parseInt(form.periodeAwal.slice(4, 6), 10);
  const months: string[] = [];
  for (let i = 0; i < lama; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export interface ScSummaryCashback {
  total: number;
  /** Calendar months of the form, in order. */
  months: string[];
  byMonth: Map<string, number>;
  /** Cashback per product per form month (same order as `months`). */
  byProduct: Map<string, number[]>;
  /** Products none of whose rows falls on a form month. */
  unmappedProducts: Set<string>;
}

/**
 * Cashback the way the editor shows it to the MR: the stored per-month rows are
 * regrouped into one entry per product with `monthlyQty` (months without a row
 * are 0), so every month is rated on its own qty, variant count and total
 * sales. Not the stats panel / outlet card input (one entry per DB row), which
 * counts each product once per row. Outlet without a cashback matrix → 0.
 */
export function computeScSummaryCashback(
  form: ScSummaryForm,
  draftProducts: ScMetricsDraft["products"],
  cashbackData: CashbackData | null
): ScSummaryCashback {
  const months = formMonths(form);
  const byMonth = new Map<string, number>();
  const unmappedProducts = new Set<string>();
  if (isCashbackResponseNotFound(cashbackData)) {
    return { total: 0, months, byMonth, byProduct: new Map(), unmappedProducts };
  }

  const groups = new Map<string, ScMetricsDraft["products"]>();
  for (const p of draftProducts) {
    if (!p.kodeProduk) continue;
    const rows = groups.get(p.kodeProduk);
    if (rows) rows.push(p);
    else groups.set(p.kodeProduk, [p]);
  }

  const selectedProducts: Parameters<typeof calculateCashbackDetails>[0]["selectedProducts"] = [];
  const masterProducts: Parameters<typeof calculateCashbackDetails>[0]["masterProducts"] = [];
  for (const [kodeProduk, rows] of groups) {
    const primary = rows[0];
    const qtyByMonth = new Map<string, number>();
    for (const r of rows) {
      if (r.periodeMonth) qtyByMonth.set(r.periodeMonth, r.qtyPerBulan || 0);
    }
    // No row falls on a form month (legacy single-row data): same qty every month.
    const hasAnyMonthMapped = months.some((m) => qtyByMonth.has(m));
    if (!hasAnyMonthMapped) unmappedProducts.add(kodeProduk);
    const monthlyQty = months.map((m) => String(hasAnyMonthMapped ? (qtyByMonth.get(m) ?? 0) : primary.qtyPerBulan || 0));

    selectedProducts.push({
      kodeProduk,
      qtyPerBulan: String(primary.qtyPerBulan || 0),
      monthlyQty,
      persenCashback: String(primary.persenCashback || 0),
    });
    masterProducts.push({
      kodeProduk,
      hna: String(primary.hnaSJ || 0),
      konversiPembagi: String(primary.konversiPembagi || 1),
    });
  }

  const details = calculateCashbackDetails({
    cashbackData,
    selectedProducts,
    masterProducts,
    lamaPeriode: months.length,
  });
  months.forEach((m, i) => byMonth.set(m, details.monthlyStats[i]?.totalCashbackThisMonth ?? 0));
  return { total: details.totalFinalCashback, months, byMonth, byProduct: details.monthlyBreakdownMap, unmappedProducts };
}

/**
 * Splits computeScSummaryCashback's per-product result over the stored rows so
 * they add up to the form total: a row gets its own month's cashback; a
 * product whose rows fall on no form month (legacy single row) carries its
 * whole cashback on the first row.
 */
function cashbackPerRow(rows: ScSummaryProductFreeze[], cashback: ScSummaryCashback): (number | null)[] {
  const assigned = new Set<string>();
  return rows.map((row) => {
    if (row.cashbackSnapshot == null) return null;
    const monthly = cashback.byProduct.get(row.kodeProduk);
    if (!monthly) return 0;

    if (cashback.unmappedProducts.has(row.kodeProduk)) {
      if (assigned.has(row.kodeProduk)) return 0;
      assigned.add(row.kodeProduk);
      return monthly.reduce((s, v) => s + v, 0);
    }
    const idx = cashback.months.indexOf(row.periodeMonth);
    const key = `${row.kodeProduk}|${row.periodeMonth}`;
    if (idx < 0 || assigned.has(key)) return 0;
    assigned.add(key);
    return monthly[idx] ?? 0;
  });
}

/**
 * History sales per product and the growth category counts, the way the outlet
 * card shows them: calculateProductDetailRows for estimasi sales vs history
 * B-3 × lama, scGrowthCategory for the badge. Needs nothing but the stored
 * rows (qty, HNA) and the history response, so submit can re-run it when the
 * B-3 window has moved without calling Canvasser per outlet.
 */
export function computeScGrowth(
  form: Pick<ScSummaryForm, "period" | "periodeAwal" | "lamaPeriode">,
  products: Pick<ScMetricsDraft["products"][number], "kodeProduk" | "periodeMonth" | "qtyPerBulan" | "hnaSJ">[],
  history: ScHistorySales
): { historyByKode: Map<string, number>; counts: ScGrowthCounts } {
  const historyByKode = new Map<string, number>();
  const scProducts = products
    .filter((p) => p.kodeProduk)
    .map((p) => {
      historyByKode.set(p.kodeProduk, history.avgByCode.get(normalizeCode(p.kodeProduk)) ?? 0);
      return {
        ...p,
        id: p.kodeProduk,
        namaProduk: "",
        produkKompetitor: null,
        persenMatriksSc: 0,
        persenDiskon: 0,
        persenCashback: 0,
        rencanaTotalBiaya: 0,
      };
    });

  const { rows } = calculateProductDetailRows({
    scProducts,
    lama: form.lamaPeriode || 3,
    periodeAwal: form.periodeAwal || form.period,
    cashbackData: null,
    cbDetails: null,
    b3SalesMap: historyByKode,
    b3TotalOutletSalesPerMonth: 0,
  });

  const counts: ScGrowthCounts = { countIntensifikasi: 0, countEkstensifikasi: 0, countPenurunan: 0, countTetap: 0 };
  for (const row of rows) {
    const category = scGrowthCategory(row);
    if (category === "intensifikasi") counts.countIntensifikasi++;
    else if (category === "ekstensifikasi") counts.countEkstensifikasi++;
    else if (category === "penurunan") counts.countPenurunan++;
    else counts.countTetap++;
  }
  return { historyByKode, counts };
}

export function computeScFormSummary(form: ScSummaryForm, inputs: ScSummaryInputs): ScFormSummaryResult {
  const { draft, products } = buildScSummaryDraft(form, inputs);
  const metrics = computeScMetrics({
    drafts: [draft],
    quarterMonths: safeQuarterMonths(form.period),
    getCashbackData: () => inputs.cashbackData,
    historySalesMap: new Map(),
    historyQuarterLabel: "",
  });
  const cashback = computeScSummaryCashback(form, draft.products, inputs.cashbackData);
  const growth = computeScGrowth(form, draft.products, inputs.history);
  const rowCashback = cashbackPerRow(products, cashback);

  const monthlyBreakdown: ScFormSummaryValues["monthlyBreakdown"] = {};
  for (const [month, v] of metrics.monthlyBreakdownMap) {
    monthlyBreakdown[month] = { ...v, cashback: cashback.byMonth.get(month) ?? 0 };
  }

  return {
    summary: {
      sumEstimasiSales: metrics.totalEstimasiSales,
      sumNilaiSc: metrics.totalNilaiSc,
      sumDiskon: metrics.totalDiskon,
      sumCashback: cashback.total,
      sumEntertain: metrics.totalEntertain,
      sumBudgetSc: metrics.totalNilaiSc + metrics.totalDiskon + cashback.total + metrics.totalEntertain,
      tercacahEstimasiSales: metrics.tercacahEstimasiSales,
      tercacahNilaiSc: metrics.tercacahNilaiSc,
      historySalesQuarter: metrics.totalHistorySalesQuarter,
      monthlyBreakdown,
      historyPeriodEnd: inputs.historyPeriodEnd,
      totalScProducts: inputs.scProducts.length,
      ...growth.counts,
      summaryVersion: SUMMARY_VERSION,
    },
    products: products.map((row, i) => ({
      ...row,
      historySalesB3: row.historySalesB3 == null ? null : (growth.historyByKode.get(row.kodeProduk) ?? 0),
      cashbackSnapshot: rowCashback[i],
    })),
    scProductList: { period: inputs.scProductPeriod, proCodes: scProCodes(inputs.scProducts) },
  };
}
