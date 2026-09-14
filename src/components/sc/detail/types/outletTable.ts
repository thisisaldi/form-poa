import type { ScProductItemData } from "../../types";

export interface ProductMonthlyQty {
  month: string;      // e.g. "202607"
  monthLabel: string; // e.g. "Jul"
  qty: number;
}

export interface ProductDetailRowItem {
  product: ScProductItemData;
  qty: number; // monthly average or legacy flat qty
  totalQty: number; // total quantity across all months in period
  monthlyBreakdown?: ProductMonthlyQty[];
  estSalesMonth: number;
  estSalesFull: number;
  nilaiScPerMonth: number;
  nilaiScFull: number;
  valCashbackFull: number;
  salesHistorical: number;
  growthPct: number;
}

export interface ProductDetailRowsSummary {
  rows: ProductDetailRowItem[];
  distinctMonths: string[];
  monthlyTotalBreakdown?: ProductMonthlyQty[];
  sumQtyPerBulan: number;
  sumTotalQty: number;
  sumEstSales: number;
  sumEstSalesPerMonth: number;
  sumNilaiSc: number;
  sumNilaiScPerMonth: number;
  sumCashback: number;
  sumSalesHistorical: number;
  sumSalesHistoricalPerMonth: number;
  effectiveOutletSalesPerMonth: number;
  effectiveOutletSalesFull: number;
  overallGrowthPct: number;
  repeatCount: number;
  newCount: number;
}
