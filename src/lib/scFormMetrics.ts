import { calculateCashbackDetails, type CashbackData } from "@/lib/scCashback";
import type { ScDraftFormItem, ScProductItemData, ScPersonItemData, ScEntertainItemData } from "@/components/sc/types";

/** The parts of a SC form the stats-panel metrics read. ScDraftFormItem satisfies it. */
export type ScMetricsDraft = Pick<ScDraftFormItem, "kodePI" | "periodeAwal" | "lamaPeriode" | "historySalesQuarter"> & {
  products: Pick<
    ScProductItemData,
    | "kodeProduk"
    | "periodeMonth"
    | "qtyPerBulan"
    | "persenMatriksSc"
    | "persenDiskon"
    | "persenCashback"
    | "hnaSJ"
    | "konversiPembagi"
    | "salesCounterValue"
    | "salesCounterMinimum"
  >[];
  persons: Pick<ScPersonItemData, "id" | "outletPersonId" | "nik_ktp">[];
  entertainItems: Pick<ScEntertainItemData, "biayaEntertain">[];
};

export interface ScMetrics {
  totalEstimasiSales: number;
  totalHistorySalesQuarter: number;
  historyQuarterLabel: string;
  totalNilaiSc: number;
  totalDiskon: number;
  totalCashback: number;
  totalEntertain: number;
  totalBudgetSc: number;
  tercacahEstimasiSales: number;
  tercacahNilaiSc: number;
  monthlyBreakdownMap: Map<string, { estimasiSales: number; nilaiSc: number }>;
  productCount: number;
  personCount: number;
  totalProductEntries: number;
}

/**
 * Stats-panel metrics across SC drafts — moved verbatim out of
 * useSalesCounterDetail's useMemo so the panel and the stored form summary
 * (src/lib/scFormSummary.ts) run the same formula. `getCashbackData` is the
 * only seam: the panel passes one response for every draft, the summary passes
 * each outlet's own.
 */
export function computeScMetrics({
  drafts,
  quarterMonths,
  getCashbackData,
  historySalesMap,
  historyQuarterLabel,
}: {
  drafts: ScMetricsDraft[];
  quarterMonths: string[];
  getCashbackData: (draft: ScMetricsDraft) => CashbackData | null | undefined;
  historySalesMap: Map<string, number>;
  historyQuarterLabel: string;
}): ScMetrics {
  let totalEstimasiSales = 0;
  let totalHistorySalesQuarter = 0;
  let totalNilaiSc = 0;
  let totalDiskon = 0;
  let totalCashback = 0;
  let totalEntertain = 0;

  let tercacahEstimasiSales = 0;
  let tercacahNilaiSc = 0;

  const monthlyBreakdownMap = new Map<string, { estimasiSales: number; nilaiSc: number }>();
  for (const m of quarterMonths) {
    monthlyBreakdownMap.set(m, { estimasiSales: 0, nilaiSc: 0 });
  }

  const distinctProducts = new Set<string>();
  const distinctPersons = new Set<string>();
  let totalProductEntries = 0;

  for (const draft of drafts) {
    const cashbackData = getCashbackData(draft);

    const histVal = draft.historySalesQuarter ?? historySalesMap.get(draft.kodePI) ?? 0;
    totalHistorySalesQuarter += histVal;

    const lama = draft.lamaPeriode || 3;

    const startYear = parseInt(draft.periodeAwal.slice(0, 4), 10);
    const startMonth = parseInt(draft.periodeAwal.slice(4, 6), 10);
    let overlapCount = 0;
    for (let i = 0; i < lama; i++) {
      const d = new Date(startYear, startMonth - 1 + i, 1);
      const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (quarterMonths.includes(yyyymm)) {
        overlapCount++;
      }
    }

    const cbDetails = calculateCashbackDetails({
      cashbackData,
      selectedProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        qtyPerBulan: String(p.qtyPerBulan || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        hna: String(p.hnaSJ || 0),
        konversiPembagi: String(p.konversiPembagi || 1),
      })),
      lamaPeriode: draft.lamaPeriode,
    });

    for (const p of draft.persons) {
      distinctPersons.add(p.outletPersonId || p.nik_ktp || p.id);
    }

    const distinctProductMonths = new Set(draft.products.map((p) => p.periodeMonth).filter(Boolean));
    const isMultiMonth = distinctProductMonths.size > 1;

    for (const p of draft.products) {
      if (!p.kodeProduk) continue;
      distinctProducts.add(p.kodeProduk);
      totalProductEntries++;

      const hnaSJ = p.hnaSJ || 0;
      const qty = p.qtyPerBulan || 0;

      const estSalesPerMonth = qty * hnaSJ;
      const estSalesFull = isMultiMonth ? estSalesPerMonth : estSalesPerMonth * lama;

      const pctMatriks = p.persenMatriksSc || 0;
      const scVal = p.salesCounterValue;
      const scMin = p.salesCounterMinimum || 0;

      let nilaiScPerMonth = 0;
      if (scVal != null && scVal > 0) {
        nilaiScPerMonth = qty >= scMin ? qty * scVal : 0;
      } else {
        nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
      }
      const nilaiScFull = isMultiMonth ? nilaiScPerMonth : nilaiScPerMonth * lama;

      const diskonFull = estSalesFull * ((p.persenDiskon || 0) / 100);
      const cashbackFull = cashbackData
        ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
        : estSalesFull * ((p.persenCashback || 0) / 100);

      totalEstimasiSales += estSalesFull;
      totalNilaiSc += nilaiScFull;
      totalDiskon += diskonFull;
      totalCashback += cashbackFull;

      if (lama > 0 && overlapCount > 0) {
        tercacahEstimasiSales += (estSalesFull / lama) * overlapCount;
        tercacahNilaiSc += (nilaiScFull / lama) * overlapCount;
      }

      // Add to monthly breakdown
      if (isMultiMonth && p.periodeMonth) {
        if (monthlyBreakdownMap.has(p.periodeMonth)) {
          const cur = monthlyBreakdownMap.get(p.periodeMonth)!;
          monthlyBreakdownMap.set(p.periodeMonth, {
            estimasiSales: cur.estimasiSales + estSalesPerMonth,
            nilaiSc: cur.nilaiSc + nilaiScPerMonth,
          });
        }
      } else {
        for (let i = 0; i < lama; i++) {
          const d = new Date(startYear, startMonth - 1 + i, 1);
          const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (monthlyBreakdownMap.has(yyyymm)) {
            const cur = monthlyBreakdownMap.get(yyyymm)!;
            monthlyBreakdownMap.set(yyyymm, {
              estimasiSales: cur.estimasiSales + estSalesPerMonth,
              nilaiSc: cur.nilaiSc + nilaiScPerMonth,
            });
          }
        }
      }
    }

    // Entertain calculation
    const draftEntertain = draft.entertainItems.reduce((s, e) => s + (e.biayaEntertain || 0), 0);
    totalEntertain += draftEntertain;
  }

  const totalBudgetSc = totalNilaiSc + totalDiskon + totalCashback + totalEntertain;

  return {
    totalEstimasiSales,
    totalHistorySalesQuarter,
    historyQuarterLabel,
    totalNilaiSc,
    totalDiskon,
    totalCashback,
    totalEntertain,
    totalBudgetSc,
    tercacahEstimasiSales,
    tercacahNilaiSc,
    monthlyBreakdownMap,
    productCount: distinctProducts.size,
    personCount: distinctPersons.size,
    totalProductEntries,
  };
}
