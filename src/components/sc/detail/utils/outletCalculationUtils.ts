import { getB3ByQuarter } from "@/lib/b3Utils";
import { formatMonthKey, formatShortMonth } from "./formatDateUtils";
import type { ScProductItemData } from "../../types";
import type { HistoryInsentifInfo } from "../types/insentif";
import type { ProductDetailRowItem, ProductDetailRowsSummary, ProductMonthlyQty } from "../types/outletTable";

export type { HistoryInsentifInfo, ProductDetailRowItem, ProductDetailRowsSummary, ProductMonthlyQty };

/**
 * Checks whether the API response for cashback indicates not found or invalid.
 */
export function isCashbackResponseNotFound(cashbackData: any): boolean {
  if (!cashbackData) return true;
  if (cashbackData.message === "Gudang Tidak Ditemukan") return true;
  if (
    typeof cashbackData.message === "string" &&
    (cashbackData.message.toLowerCase().includes("tidak ditemukan") ||
      cashbackData.message.toLowerCase().includes("gudang"))
  ) {
    return true;
  }
  if (
    typeof cashbackData.data?.message === "string" &&
    (cashbackData.data.message.toLowerCase().includes("tidak ditemukan") ||
      cashbackData.data.message.toLowerCase().includes("gudang"))
  ) {
    return true;
  }
  if (cashbackData.status === false || cashbackData.success === false) {
    return true;
  }
  return false;
}

/**
 * Computes aggregated estimated sales and incentive value for an outlet.
 */
export function calculateOutletTotals(
  scProducts: ScProductItemData[],
  lama: number
): { outletEstSales: number; outletNilaiSc: number } {
  let outletEstSales = 0;
  let outletNilaiSc = 0;

  const distinctMonths = new Set(scProducts.map((p) => p.periodeMonth).filter(Boolean));
  const isMultiMonth = distinctMonths.size > 1;

  for (const p of scProducts) {
    const hnaSJ = p.hnaSJ || 0;
    const qty = p.qtyPerBulan || 0;

    const estMonth = qty * hnaSJ;
    const estFull = isMultiMonth ? estMonth : estMonth * lama;

    const scVal = p.salesCounterValue;
    const scMin = p.salesCounterMinimum || 0;

    let valScPerMonth = 0;
    if (scVal != null && scVal > 0) {
      valScPerMonth = qty >= scMin ? qty * scVal : 0;
    } else {
      valScPerMonth = estMonth * ((p.persenMatriksSc || 0) / 100);
    }
    const valScFull = isMultiMonth ? valScPerMonth : valScPerMonth * lama;

    outletEstSales += estFull;
    outletNilaiSc += valScFull;
  }

  return { outletEstSales, outletNilaiSc };
}

/**
 * Computes historical incentive info from B-3 quarter months.
 */
export function computeHistoryInsentifInfo(
  insentifHistoryData: any,
  period: string,
  poaId: string
): HistoryInsentifInfo | null {
  if (!insentifHistoryData || typeof insentifHistoryData !== "object") return null;
  const allKeys = Object.keys(insentifHistoryData).sort();
  if (allKeys.length === 0) return null;

  const b3InfoQuarter = getB3ByQuarter(period || poaId);
  const yr = Math.floor(b3InfoQuarter.period / 100);
  const mo = b3InfoQuarter.period % 100;

  const targetB3Keys: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(yr, mo - 1 - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    targetB3Keys.push(`${y}${m}`);
  }

  const matchedKeys = targetB3Keys.filter((k) => Boolean(insentifHistoryData[k]));
  const usedKeys = matchedKeys.length > 0 ? matchedKeys : allKeys.slice(-3);

  let sumB3Insentif = 0;
  for (const k of usedKeys) {
    const items = Array.isArray(insentifHistoryData[k]) ? insentifHistoryData[k] : [];
    sumB3Insentif += items.reduce(
      (sum: number, it: any) => sum + (parseFloat(it.total_insentif ?? it.insentif ?? 0) || 0),
      0
    );
  }

  const avgB3Insentif = usedKeys.length > 0 ? sumB3Insentif / usedKeys.length : 0;

  let rangeLabel = "";
  if (matchedKeys.length > 0 && b3InfoQuarter.rangeLabel) {
    rangeLabel = b3InfoQuarter.rangeLabel;
  } else if (usedKeys.length === 1) {
    rangeLabel = formatMonthKey(usedKeys[0]);
  } else if (usedKeys.length > 1) {
    rangeLabel = `${formatMonthKey(usedKeys[0])} - ${formatMonthKey(usedKeys[usedKeys.length - 1])}`;
  }

  return {
    usedKeys,
    avgB3Insentif,
    sumB3Insentif,
    rangeLabel,
    totalMonths: usedKeys.length,
  };
}

/**
 * Helper to generate YYYYMM string list for a given start month and duration.
 */
export function getPeriodMonthList(periodeAwal?: string, lama: number = 3): string[] {
  if (!periodeAwal || periodeAwal.length < 6) return [];
  const startYear = parseInt(periodeAwal.slice(0, 4), 10);
  const startMonth = parseInt(periodeAwal.slice(4, 6), 10);
  if (isNaN(startYear) || isNaN(startMonth)) return [];
  const list: string[] = [];
  for (let i = 0; i < (lama || 1); i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    list.push(yyyymm);
  }
  return list;
}

/**
 * Calculates per-product metrics, totals, and growth for the products table.
 * Supports multi-month entries (e.g. 202607: 3, 202608: 4, 202609: 5) grouped by product.
 */
export function calculateProductDetailRows({
  scProducts,
  lama,
  periodeAwal,
  cashbackData,
  cbDetails,
  b3SalesMap,
  b3TotalOutletSalesPerMonth,
}: {
  scProducts: ScProductItemData[];
  lama: number;
  periodeAwal?: string;
  cashbackData: any;
  cbDetails: any;
  b3SalesMap: Map<string, number>;
  b3TotalOutletSalesPerMonth: number;
}): ProductDetailRowsSummary {
  let sumEstSales = 0;
  let sumEstSalesPerMonth = 0;
  let sumNilaiSc = 0;
  let sumNilaiScPerMonth = 0;
  let sumCashback = 0;
  let sumSalesHistorical = 0;
  let sumSalesHistoricalPerMonth = 0;
  let sumQtyPerBulan = 0;
  let sumTotalQty = 0;
  let repeatCount = 0;
  let newCount = 0;

  const distinctMonths = Array.from(
    new Set(scProducts.map((p) => p.periodeMonth).filter((m): m is string => Boolean(m)))
  ).sort();
  const isMultiMonth = distinctMonths.length > 1;

  const generatedMonths = getPeriodMonthList(periodeAwal, lama);
  const periodMonths = generatedMonths.length > 0 ? generatedMonths : distinctMonths;

  const monthlyTotalQtyMap = new Map<string, number>();
  for (const m of periodMonths) {
    monthlyTotalQtyMap.set(m, 0);
  }

  // Group scProducts by kodeProduk
  const productGroupMap = new Map<string, ScProductItemData[]>();
  for (const p of scProducts) {
    const key = p.kodeProduk || p.id;
    if (!productGroupMap.has(key)) {
      productGroupMap.set(key, []);
    }
    productGroupMap.get(key)!.push(p);
  }

  const rows: ProductDetailRowItem[] = Array.from(productGroupMap.entries()).map(([, items]) => {
    const primary = items[0];
    const hnaSJ = primary.hnaSJ || 0;
    const scVal = primary.salesCounterValue;
    const scMin = primary.salesCounterMinimum || 0;
    const pctMatriks = primary.persenMatriksSc || 0;
    const pctCashback = primary.persenCashback || 0;

    let estSalesFull = 0;
    let nilaiScFull = 0;

    const itemMonthMap = new Map<string, number>();
    for (const it of items) {
      if (it.periodeMonth) {
        itemMonthMap.set(it.periodeMonth, it.qtyPerBulan);
      }
    }

    const monthlyBreakdown: ProductMonthlyQty[] = periodMonths.map((m) => {
      const q = itemMonthMap.has(m)
        ? (itemMonthMap.get(m) || 0)
        : (isMultiMonth ? 0 : (primary.qtyPerBulan || 0));
      return {
        month: m,
        monthLabel: formatShortMonth(m) || m,
        qty: q,
      };
    });

    for (const mb of monthlyBreakdown) {
      monthlyTotalQtyMap.set(mb.month, (monthlyTotalQtyMap.get(mb.month) || 0) + mb.qty);
    }

    const productTotalQty = monthlyBreakdown.reduce((sum, mb) => sum + mb.qty, 0);

    if (isMultiMonth) {
      for (const mb of monthlyBreakdown) {
        const q = mb.qty;
        const estMonth = q * hnaSJ;
        estSalesFull += estMonth;

        let scMonth = 0;
        if (scVal != null && scVal > 0) {
          scMonth = q >= scMin ? q * scVal : 0;
        } else {
          scMonth = estMonth * (pctMatriks / 100);
        }
        nilaiScFull += scMonth;
      }
    } else {
      // Legacy flat mono row
      const q = primary.qtyPerBulan || 0;
      const estMonth = q * hnaSJ;
      estSalesFull = estMonth * lama;

      let scMonth = 0;
      if (scVal != null && scVal > 0) {
        scMonth = q >= scMin ? q * scVal : 0;
      } else {
        scMonth = estMonth * (pctMatriks / 100);
      }
      nilaiScFull = scMonth * lama;
    }

    const estSalesMonth = lama > 0 ? estSalesFull / lama : estSalesFull;
    const nilaiScPerMonth = lama > 0 ? nilaiScFull / lama : nilaiScFull;
    const qtyAvgPerMonth = lama > 0 ? productTotalQty / lama : productTotalQty;

    sumTotalQty += productTotalQty;
    sumQtyPerBulan += isMultiMonth ? Math.round(qtyAvgPerMonth) : (primary.qtyPerBulan || 0);
    sumEstSales += estSalesFull;
    sumEstSalesPerMonth += estSalesMonth;
    sumNilaiSc += nilaiScFull;
    sumNilaiScPerMonth += nilaiScPerMonth;

    const valCashbackFull = cashbackData
      ? (cbDetails?.resultMap?.get(primary.kodeProduk) ?? 0)
      : estSalesFull * (pctCashback / 100);
    sumCashback += valCashbackFull;

    const avgSales =
      b3SalesMap.get(primary.kodeProduk) ??
      b3SalesMap.get(primary.kodeProduk.replace(/^0+/, "")) ??
      0;
    sumSalesHistoricalPerMonth += avgSales;
    const salesHistorical = avgSales * lama;
    sumSalesHistorical += salesHistorical;

    if (salesHistorical > 0) {
      repeatCount++;
    } else {
      newCount++;
    }

    let growthPct = 0;
    if (salesHistorical > 0 && estSalesFull > 0) {
      growthPct = ((estSalesFull - salesHistorical) / salesHistorical) * 100;
    }

    return {
      product: primary,
      qty: isMultiMonth ? Math.round(qtyAvgPerMonth) : (primary.qtyPerBulan || 0),
      totalQty: productTotalQty,
      monthlyBreakdown,
      estSalesMonth,
      estSalesFull,
      nilaiScPerMonth,
      nilaiScFull,
      valCashbackFull,
      salesHistorical,
      growthPct,
    };
  });

  const effectiveOutletSalesPerMonth =
    b3TotalOutletSalesPerMonth > 0 ? b3TotalOutletSalesPerMonth : sumSalesHistoricalPerMonth;
  const effectiveOutletSalesFull = effectiveOutletSalesPerMonth * lama;

  const monthlyTotalBreakdown: ProductMonthlyQty[] = periodMonths.map((m) => ({
    month: m,
    monthLabel: formatShortMonth(m) || m,
    qty: monthlyTotalQtyMap.get(m) || 0,
  }));

  const overallGrowthPct =
    effectiveOutletSalesFull > 0 && sumEstSales > 0
      ? ((sumEstSales - effectiveOutletSalesFull) / effectiveOutletSalesFull) * 100
      : 0;

  return {
    rows,
    distinctMonths: periodMonths,
    monthlyTotalBreakdown,
    sumQtyPerBulan,
    sumTotalQty,
    sumEstSales,
    sumEstSalesPerMonth,
    sumNilaiSc,
    sumNilaiScPerMonth,
    sumCashback,
    sumSalesHistorical,
    sumSalesHistoricalPerMonth,
    effectiveOutletSalesPerMonth,
    effectiveOutletSalesFull,
    overallGrowthPct,
    repeatCount,
    newCount,
  };
}
