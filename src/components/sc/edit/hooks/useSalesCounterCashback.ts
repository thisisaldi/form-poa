import type { CashbackData } from "../types/cashback";

export type { CashbackData };

export function calculateCashbackDetails({
  cashbackData,
  selectedProducts,
  masterProducts,
  lamaPeriode,
}: {
  cashbackData: CashbackData | null | undefined;
  selectedProducts: Array<{
    kodeProduk: string;
    qtyPerBulan: string;
    monthlyQty?: string[];
    persenCashback?: string;
  }>;
  masterProducts: Array<{
    kodeProduk: string;
    hna: string;
    konversiPembagi?: string | null;
  }>;
  lamaPeriode: number;
}) {
  const limitVal = cashbackData?.limit?.[0]?.limit ?? 100000;
  const numMonths = Math.max(1, lamaPeriode || 3);

  // 1. Calculate per-month stats independently
  const monthlyStats = Array.from({ length: numMonths }, (_, mIdx) => {
    // A. Product stats for this specific month
    const productStats = selectedProducts.map((p) => {
      if (!p.kodeProduk) {
        return {
          kodeProduk: "",
          mQty: 0,
          mSales: 0,
          rawCashbackPct: 0,
          eligible: false,
          mCashbackVal: 0,
        };
      }

      const master = masterProducts.find((mp) => mp.kodeProduk === p.kodeProduk);
      const hnaSJ = parseFloat(master?.hna || "0") || 0;

      let mQty = 0;
      if (Array.isArray(p.monthlyQty) && p.monthlyQty[mIdx] !== undefined && p.monthlyQty[mIdx] !== "") {
        mQty = parseFloat(p.monthlyQty[mIdx]) || 0;
      } else {
        mQty = parseFloat(p.qtyPerBulan) || 0;
      }

      const mSales = mQty * hnaSJ;

      let rawCashbackPct = parseFloat(p.persenCashback || "0") || 0;
      if (cashbackData?.matrix) {
        const cleanCode = p.kodeProduk.trim();
        const strippedCode = cleanCode.replace(/^0+/, "");
        const mat = cashbackData.matrix.find((m: any) => {
          const c = String(m.code || m.pro_code || "").trim();
          return c === cleanCode || c.replace(/^0+/, "") === strippedCode;
        });
        if (mat) {
          const rawPct = mat.cashback_percentage ?? mat.cashback_percent ?? 0;
          rawCashbackPct = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
        }
      }

      const eligible = mSales >= limitVal && mSales > 0;

      return {
        kodeProduk: p.kodeProduk,
        mQty,
        mSales,
        rawCashbackPct,
        eligible,
        mCashbackVal: 0,
      };
    });

    // B. Eligible variants & total sales for this month
    const eligibleProducts = productStats.filter((it) => it.eligible);
    const eligibleVariantCount = eligibleProducts.length;
    // Seluruh penjualan dari produk-produk di bulan tersebut (termasuk yang tidak eligible) dimasukkan ke dalam total belanja PI
    const totalSalesMonthly = productStats.reduce((acc, it) => acc + it.mSales, 0);

    // C. Variant multiplier for this month
    let variantMultiplier = 0;
    if (cashbackData?.variant && Array.isArray(cashbackData.variant) && cashbackData.variant.length > 0) {
      const sortedV = [...cashbackData.variant].sort((a, b) => (b.variant ?? 0) - (a.variant ?? 0));
      const minVariantInConfig = sortedV[sortedV.length - 1]?.variant ?? 2;
      if (eligibleVariantCount >= minVariantInConfig) {
        const match = sortedV.find((v) => (v.variant ?? 0) <= eligibleVariantCount);
        variantMultiplier = match?.multiplier ?? 0;
      } else {
        variantMultiplier = 0;
      }
    }

    // D. PI multiplier for this month
    // Menghitung seluruh penjualan dari produk-produk di bulan tersebut (termasuk yang tidak eligible)
    let piMultiplier = 0;
    if (cashbackData?.pi && Array.isArray(cashbackData.pi) && cashbackData.pi.length > 0) {
      const sortedPi = [...cashbackData.pi].sort(
        (a, b) => (b.total_expenditure_pi ?? b.min_sales ?? 0) - (a.total_expenditure_pi ?? a.min_sales ?? 0)
      );
      const piMatch = sortedPi.find((p) => totalSalesMonthly >= (p.total_expenditure_pi ?? p.min_sales ?? 0));
      piMultiplier = piMatch?.multiplier ?? 1;
    }

    // E. Calculate cashback per product for this month
    for (const prod of productStats) {
      if (prod.eligible) {
        prod.mCashbackVal = prod.mSales * (prod.rawCashbackPct / 100) * variantMultiplier * piMultiplier;
      } else {
        prod.mCashbackVal = 0;
      }
    }

    const totalCashbackThisMonth = productStats.reduce((sum, it) => sum + it.mCashbackVal, 0);

    return {
      mIdx,
      productStats,
      eligibleVariantCount,
      totalSalesMonthly,
      variantMultiplier,
      piMultiplier,
      totalCashbackThisMonth,
    };
  });

  // 2. Aggregate per-product results across all months
  const monthlyBreakdownMap = new Map<string, number[]>();
  const resultMap = new Map<string, number>();
  const monthlyResultMap = new Map<string, number>();
  const itemEligibilityMap = new Map<string, boolean>();

  let totalFinalCashback = 0;

  const items = selectedProducts.map((p) => {
    if (!p.kodeProduk) {
      return {
        kodeProduk: "",
        estimasiSalesMonthly: 0,
        estimasiSales: 0,
        rawCashbackPct: 0,
        eligible: false,
        rawCashbackValMonthly: 0,
        finalCashbackVal: 0,
        monthlyBreakdown: Array(numMonths).fill(0),
      };
    }

    const monthlyVals: number[] = [];
    let sumProductSales = 0;
    let anyMonthEligible = false;

    for (let m = 0; m < numMonths; m++) {
      const pStat = monthlyStats[m].productStats.find((s) => s.kodeProduk === p.kodeProduk);
      const mVal = pStat?.mCashbackVal ?? 0;
      monthlyVals.push(mVal);
      sumProductSales += pStat?.mSales ?? 0;
      if (pStat?.eligible) {
        anyMonthEligible = true;
      }
    }

    const finalCashbackVal = monthlyVals.reduce((s, v) => s + v, 0);
    const avgMonthlyVal = numMonths > 0 ? finalCashbackVal / numMonths : 0;
    const avgSalesMonthly = numMonths > 0 ? sumProductSales / numMonths : 0;

    monthlyBreakdownMap.set(p.kodeProduk, monthlyVals);
    resultMap.set(p.kodeProduk, finalCashbackVal);
    monthlyResultMap.set(p.kodeProduk, avgMonthlyVal);
    itemEligibilityMap.set(p.kodeProduk, anyMonthEligible && finalCashbackVal > 0);

    totalFinalCashback += finalCashbackVal;

    const firstMonthPStat = monthlyStats[0]?.productStats.find((s) => s.kodeProduk === p.kodeProduk);

    return {
      kodeProduk: p.kodeProduk,
      estimasiSalesMonthly: avgSalesMonthly,
      estimasiSales: sumProductSales,
      rawCashbackPct: firstMonthPStat?.rawCashbackPct ?? 0,
      eligible: anyMonthEligible,
      rawCashbackValMonthly: avgMonthlyVal,
      finalCashbackVal,
      monthlyBreakdown: monthlyVals,
    };
  });

  const totalFinalCashbackMonthly = numMonths > 0 ? totalFinalCashback / numMonths : 0;
  const totalSales = monthlyStats.reduce((sum, m) => sum + m.totalSalesMonthly, 0);
  const totalSalesMonthly = numMonths > 0 ? totalSales / numMonths : 0;

  const maxVariantCount = Math.max(...monthlyStats.map((m) => m.eligibleVariantCount), 0);
  const maxVariantMultiplier = Math.max(...monthlyStats.map((m) => m.variantMultiplier), 0);
  const maxPiMultiplier = Math.max(...monthlyStats.map((m) => m.piMultiplier), 0);

  return {
    limitVal,
    eligibleVariantCount: maxVariantCount,
    totalSales,
    totalSalesMonthly,
    variantMultiplier: maxVariantMultiplier,
    piMultiplier: maxPiMultiplier,
    items,
    itemEligibilityMap,
    resultMap,
    monthlyResultMap,
    monthlyBreakdownMap,
    monthlyStats,
    totalFinalCashback,
    totalFinalCashbackMonthly,
  };
}
