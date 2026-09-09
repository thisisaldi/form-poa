export interface CashbackMatrixItem {
  code?: string;
  pro_code?: string;
  cashback_percentage?: number;
  cashback_percent?: number;
}

export interface CashbackPiItem {
  total_expenditure_pi?: number;
  min_sales?: number;
  multiplier?: number;
}

export interface CashbackVariantItem {
  variant?: number;
  multiplier?: number;
}

export interface CashbackLimitItem {
  limit?: number;
}

export interface CashbackData {
  matrix?: CashbackMatrixItem[];
  pi?: CashbackPiItem[];
  variant?: CashbackVariantItem[];
  limit?: CashbackLimitItem[];
  date?: string;
  period?: string;
  message?: string;
  data?: any;
  status?: boolean;
  success?: boolean;
}

export interface CashbackItemDetail {
  kodeProduk: string;
  estimasiSales: number;
  rawCashbackPct: number;
  eligible: boolean;
  rawCashbackVal: number;
  finalCashbackVal: number;
}

export interface CashbackCalculationResult {
  totalEstimasiSales: number;
  variantCount: number;
  variantMultiplier: number;
  piMultiplier: number;
  totalCashback: number;
  items: CashbackItemDetail[];
  limitVal: number;
}
