import type { ScProductItemData } from "../../types";

export interface ProductDetailRowItem {
  product: ScProductItemData;
  qty: number;
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
  sumQtyPerBulan: number;
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
