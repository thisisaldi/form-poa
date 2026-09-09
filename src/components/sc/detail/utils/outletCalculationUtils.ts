import { getB3ByQuarter } from "@/lib/b3Utils";
import { formatMonthKey } from "./formatDateUtils";
import type { ScProductItemData } from "../../types";
import type { HistoryInsentifInfo } from "../types/insentif";
import type { ProductDetailRowItem, ProductDetailRowsSummary } from "../types/outletTable";

export type { HistoryInsentifInfo, ProductDetailRowItem, ProductDetailRowsSummary };

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

  for (const p of scProducts) {
    const hnaSJ = p.hnaSJ || 0;
    const qty = p.qtyPerBulan || 0;

    const estMonth = qty * hnaSJ;
    const estFull = estMonth * lama;

    const scVal = p.salesCounterValue;
    const scMin = p.salesCounterMinimum || 0;

    let valScPerMonth = 0;
    if (scVal != null && scVal > 0) {
      valScPerMonth = qty >= scMin ? qty * scVal : 0;
    } else {
      valScPerMonth = estMonth * ((p.persenMatriksSc || 0) / 100);
    }
    const valScFull = valScPerMonth * lama;

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
 * Calculates per-product metrics, totals, and growth for the products table.
 */
export function calculateProductDetailRows({
  scProducts,
  lama,
  cashbackData,
  cbDetails,
  b3SalesMap,
  b3TotalOutletSalesPerMonth,
}: {
  scProducts: ScProductItemData[];
  lama: number;
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
  let repeatCount = 0;
  let newCount = 0;

  const rows: ProductDetailRowItem[] = scProducts.map((p) => {
    const hnaSJ = p.hnaSJ || 0;
    const qty = p.qtyPerBulan || 0;
    sumQtyPerBulan += qty;

    const estSalesMonth = qty * hnaSJ;
    sumEstSalesPerMonth += estSalesMonth;

    const estSalesFull = estSalesMonth * lama;
    sumEstSales += estSalesFull;

    const scVal = p.salesCounterValue;
    const scMin = p.salesCounterMinimum || 0;
    let nilaiScPerMonth = 0;
    if (scVal != null && scVal > 0) {
      nilaiScPerMonth = qty >= scMin ? qty * scVal : 0;
    } else {
      nilaiScPerMonth = (qty * hnaSJ) * ((p.persenMatriksSc || 0) / 100);
    }
    sumNilaiScPerMonth += nilaiScPerMonth;

    const nilaiScFull = nilaiScPerMonth * lama;
    sumNilaiSc += nilaiScFull;

    const valCashbackFull = cashbackData
      ? (cbDetails?.resultMap?.get(p.kodeProduk) ?? 0)
      : estSalesFull * ((p.persenCashback || 0) / 100);
    sumCashback += valCashbackFull;

    const avgSales =
      b3SalesMap.get(p.kodeProduk) ??
      b3SalesMap.get(p.kodeProduk.replace(/^0+/, "")) ??
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
      product: p,
      qty,
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

  const overallGrowthPct =
    effectiveOutletSalesFull > 0 && sumEstSales > 0
      ? ((sumEstSales - effectiveOutletSalesFull) / effectiveOutletSalesFull) * 100
      : 0;

  return {
    rows,
    sumQtyPerBulan,
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
