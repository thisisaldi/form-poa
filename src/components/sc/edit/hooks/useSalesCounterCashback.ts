  export interface CashbackData {
  matrix?: Array<{ code?: string; pro_code?: string; cashback_percentage?: number; cashback_percent?: number }>;
  pi?: Array<{ total_expenditure_pi?: number; min_sales?: number; multiplier?: number }>;
  variant?: Array<{ variant?: number; multiplier?: number }>;
  limit?: Array<{ limit?: number }>;
  date?: string;
  period?: string;
  message?: string;
  data?: any;
  status?: boolean;
  success?: boolean;
}

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

  const items = selectedProducts.map((p) => {
    if (!p.kodeProduk) {
      return { kodeProduk: "", estimasiSales: 0, rawCashbackPct: 0, eligible: false, rawCashbackVal: 0, finalCashbackVal: 0 };
    }

    const master = masterProducts.find((mp) => mp.kodeProduk === p.kodeProduk);
    const hnaSJ = parseFloat(master?.hna || "0") || 0;

    const qtyUb = parseFloat(p.qtyPerBulan) || 0;
    const estimasiSalesMonthly = qtyUb * hnaSJ;
    const estimasiSales = estimasiSalesMonthly * lamaPeriode;

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

    const eligible = estimasiSalesMonthly >= limitVal && estimasiSalesMonthly > 0;
    const rawCashbackValMonthly = eligible ? estimasiSalesMonthly * (rawCashbackPct / 100) : 0;

    return {
      kodeProduk: p.kodeProduk,
      estimasiSalesMonthly,
      estimasiSales,
      rawCashbackPct,
      eligible,
      rawCashbackValMonthly,
      finalCashbackVal: 0,
    };
  });

  const eligibleItems = items.filter((it) => it.eligible);
  const totalEligibleSalesMonthly = eligibleItems.reduce((acc, it) => acc + (it.estimasiSalesMonthly || 0), 0);
  const eligibleVariantCount = eligibleItems.length;

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

  let piMultiplier = 0;
  if (cashbackData?.pi && Array.isArray(cashbackData.pi) && cashbackData.pi.length > 0) {
    const sortedPi = [...cashbackData.pi].sort(
      (a, b) => (b.total_expenditure_pi ?? b.min_sales ?? 0) - (a.total_expenditure_pi ?? a.min_sales ?? 0)
    );
    const piMatch = sortedPi.find((p) => totalEligibleSalesMonthly >= (p.total_expenditure_pi ?? p.min_sales ?? 0));
    piMultiplier = piMatch?.multiplier ?? 0;
  }

  let totalFinalCashback = 0;
  let totalFinalCashbackMonthly = 0;
  const resultMap = new Map<string, number>();
  const monthlyResultMap = new Map<string, number>();

  const duration = lamaPeriode > 0 ? lamaPeriode : 1;

  for (const item of items) {
    if (item.eligible) {
      const monthlyVal = (item.estimasiSalesMonthly || 0) * ((item.rawCashbackPct || 0) / 100) * variantMultiplier * piMultiplier;
      const finalVal = monthlyVal * duration;
      item.finalCashbackVal = finalVal;
      resultMap.set(item.kodeProduk, finalVal);
      monthlyResultMap.set(item.kodeProduk, monthlyVal);
      totalFinalCashback += finalVal;
      totalFinalCashbackMonthly += monthlyVal;
    } else {
      item.finalCashbackVal = 0;
      if (item.kodeProduk) {
        resultMap.set(item.kodeProduk, 0);
        monthlyResultMap.set(item.kodeProduk, 0);
      }
    }
  }

  const itemEligibilityMap = new Map<string, boolean>();
  for (const item of items) {
    if (item.kodeProduk) {
      const finalVal = resultMap.get(item.kodeProduk) ?? 0;
      itemEligibilityMap.set(item.kodeProduk, item.eligible && finalVal > 0);
    }
  }

  return {
    limitVal,
    eligibleVariantCount,
    totalEligibleSales: totalEligibleSalesMonthly * duration,
    totalEligibleSalesMonthly,
    variantMultiplier,
    piMultiplier,
    items,
    itemEligibilityMap,
    resultMap,
    monthlyResultMap,
    totalFinalCashback,
    totalFinalCashbackMonthly,
  };
}
