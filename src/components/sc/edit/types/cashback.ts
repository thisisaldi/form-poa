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
  estimasiSalesMonthly: number;
  estimasiSales: number;
  rawCashbackPct: number;
  eligible: boolean;
  rawCashbackValMonthly: number;
  finalCashbackVal: number;
  monthlyBreakdown?: number[];
}

export interface CashbackMonthStat {
  mIdx: number;
  productStats: any[];
  eligibleVariantCount: number;
  totalSalesMonthly: number;
  variantMultiplier: number;
  piMultiplier: number;
  totalCashbackThisMonth: number;
}

export interface CashbackCalculationResult {
  limitVal: number;
  eligibleVariantCount: number;
  totalSales: number;
  totalSalesMonthly: number;
  variantMultiplier: number;
  piMultiplier: number;
  items: CashbackItemDetail[];
  itemEligibilityMap: Map<string, boolean>;
  resultMap: Map<string, number>;
  monthlyResultMap: Map<string, number>;
  monthlyBreakdownMap: Map<string, number[]>;
  monthlyStats: CashbackMonthStat[];
  totalFinalCashback: number;
  totalFinalCashbackMonthly: number;
}
