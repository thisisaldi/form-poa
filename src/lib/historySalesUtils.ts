export interface AggregatedProductHistory {
  code: string;
  totalQty: number;
  totalValue: number;
  activeMonths: number;
  avgQty: number; // totalQty / activeMonths
  avgValue: number; // totalValue / activeMonths
  sales_b1: number;
  sales_b2: number;
  sales_b3: number;
  sales_val_b1?: number;
  sales_val_b2?: number;
  sales_val_b3?: number;
  activeMonthsB3?: number;
  avgQtyB3?: number; // (sales_b1 + sales_b2 + sales_b3) / 3
  avgQtyB3Active?: number;
  avgValueB3Active?: number;
}

/**
 * Aggregates raw monthly history sales (from getHistorySales with agg=False)
 * to calculate Average per active transaction month (not divided by 12 months unconditionally).
 */
export function aggregateHistorySales(rawResponse: any): Map<string, AggregatedProductHistory> {
  const map = new Map<string, AggregatedProductHistory>();
  if (!rawResponse?.data) return map;

  const rawPeriods = Array.isArray(rawResponse.period) ? [...rawResponse.period] : [];
  const validPeriods = rawPeriods
    .map(String)
    .filter((p) => p.length === 6)
    .sort(); // ascending: e.g. 202509 ... 202608

  const p1 = validPeriods[validPeriods.length - 1]; // Latest month (B1)
  const p2 = validPeriods[validPeriods.length - 2]; // Month before latest (B2)
  const p3 = validPeriods[validPeriods.length - 3]; // 2 months before latest (B3)

  // 1. If API already aggregated (e.g. from post-history-sales with agg: true)
  // Format: rawResponse.data[piCode][proCode] = { sales_value, sales_qty, sales_value_avg, history_sales_avg }
  if (rawResponse.aggregated && typeof rawResponse.data === "object" && !Array.isArray(rawResponse.data)) {
    const addProductItem = (proCode: string, item: any) => {
      if (proCode === "total_sales" || proCode === "average_sales") return;
      const code = String(proCode).trim();
      if (!code || !item || typeof item !== "object") return;

      const totalQty = Number(item.sales_qty ?? item.history_sales_sum) || 0;
      const totalValue = Number(item.sales_value ?? item.sales_value_sum) || 0;
      const avgQty = Number(item.history_sales_avg ?? item.history_sales) || 0;
      const avgValue = Number(item.sales_value_avg ?? item.sales_value) || 0;

      const aggRecord: AggregatedProductHistory = {
        code,
        totalQty,
        totalValue,
        activeMonths: validPeriods.length || 12,
        avgQty,
        avgValue,
        sales_b1: Number(item.sales_b1) || 0,
        sales_b2: Number(item.sales_b2) || 0,
        sales_b3: Number(item.sales_b3) || 0,
        sales_val_b1: Number(item.sales_val_b1 ?? item.sales_value_b1) || 0,
        sales_val_b2: Number(item.sales_val_b2 ?? item.sales_value_b2) || 0,
        sales_val_b3: Number(item.sales_val_b3 ?? item.sales_value_b3) || 0,
        activeMonthsB3: 0,
        avgQtyB3: avgQty,
        avgQtyB3Active: avgQty,
        avgValueB3Active: avgValue,
      };

      map.set(code, aggRecord);
      map.set(code.replace(/^0+/, ""), aggRecord);
    };

    for (const [k1, v1] of Object.entries(rawResponse.data)) {
      if (k1 === "total_sales" || k1 === "average_sales") continue;
      if (v1 && typeof v1 === "object") {
        if ("sales_qty" in (v1 as any) || "history_sales_avg" in (v1 as any)) {
          addProductItem(k1, v1);
        } else {
          for (const [proCode, item] of Object.entries(v1 as Record<string, any>)) {
            addProductItem(proCode, item);
          }
        }
      }
    }
    return map;
  }

  let rawRows: any[] = [];
  if (Array.isArray(rawResponse.data)) {
    rawRows = rawResponse.data;
  } else if (typeof rawResponse.data === "object") {
    // Format dari post-history-sales dengan aggregated: false
    // rawResponse.data[period][piCode][proCode] = { sales_value, sales_qty }
    for (const [periodKey, piObj] of Object.entries(rawResponse.data)) {
      if (piObj && typeof piObj === "object") {
        for (const [piKey, proObj] of Object.entries(piObj as Record<string, any>)) {
          if (proObj && typeof proObj === "object") {
            for (const [proCode, val] of Object.entries(proObj as Record<string, any>)) {
              if (proCode === "total_sales" || proCode === "average_sales") continue;
              if (val && typeof val === "object") {
                rawRows.push({
                  code: proCode,
                  period: periodKey,
                  history_sales: Number((val as any).sales_qty ?? (val as any).history_sales) || 0,
                  sales_value: Number((val as any).sales_value) || 0,
                });
              }
            }
          }
        }
      }
    }
  }

  // Group raw rows by product code
  const productRows = new Map<string, any[]>();
  for (const row of rawRows) {
    const code = String(row.code || "").trim();
    if (!code) continue;
    const existing = productRows.get(code) || [];
    existing.push(row);
    productRows.set(code, existing);
  }

  for (const [code, rows] of productRows.entries()) {
    // If API already aggregated (e.g. has history_sales_sum and aggregated: true)
    if (rawResponse.aggregated) {
      const item = rows[0];
      const sumQty = Number(item.history_sales_sum) || 0;
      const sumVal = Number(item.sales_value_sum) || 0;
      const b1Qty = Number(item.sales_b1) || 0;
      const b2Qty = Number(item.sales_b2) || 0;
      const b3Qty = Number(item.sales_b3) || 0;
      const b1Val = Number(item.sales_val_b1 ?? item.sales_value_b1) || 0;
      const b2Val = Number(item.sales_val_b2 ?? item.sales_value_b2) || 0;
      const b3Val = Number(item.sales_val_b3 ?? item.sales_value_b3) || 0;
      const activeMonthsB3 = [
        (b1Qty > 0 || b1Val > 0) ? 1 : 0,
        (b2Qty > 0 || b2Val > 0) ? 1 : 0,
        (b3Qty > 0 || b3Val > 0) ? 1 : 0,
      ].reduce((a, b) => a + b, 0);
      const totalQtyB3 = b1Qty + b2Qty + b3Qty;
      const totalValB3 = b1Val + b2Val + b3Val;
      const avgQtyB3Active = activeMonthsB3 > 0 ? totalQtyB3 / activeMonthsB3 : (Number(item.history_sales) || 0);
      const avgValueB3Active = activeMonthsB3 > 0 ? totalValB3 / activeMonthsB3 : (Number(item.sales_value) || 0);

      const aggRecord: AggregatedProductHistory = {
        code,
        totalQty: sumQty,
        totalValue: sumVal,
        activeMonths: 12,
        avgQty: Number(item.history_sales) || 0,
        avgValue: Number(item.sales_value) || 0,
        sales_b1: b1Qty,
        sales_b2: b2Qty,
        sales_b3: b3Qty,
        sales_val_b1: b1Val,
        sales_val_b2: b2Val,
        sales_val_b3: b3Val,
        activeMonthsB3,
        avgQtyB3: totalQtyB3 / 3,
        avgQtyB3Active,
        avgValueB3Active,
      };
      map.set(code, aggRecord);
      map.set(code.replace(/^0+/, ""), aggRecord);
      continue;
    }

    // Non-aggregated (agg=False): rows have period, history_sales, sales_value
    const activeRows = rows.filter((r) => (Number(r.history_sales) || 0) > 0);
    const activeMonths = activeRows.length;
    const totalQty = activeRows.reduce((sum, r) => sum + (Number(r.history_sales) || 0), 0);
    const totalValue = activeRows.reduce((sum, r) => sum + (Number(r.sales_value) || 0), 0);

    const avgQty = activeMonths > 0 ? totalQty / activeMonths : 0;
    const avgValue = activeMonths > 0 ? totalValue / activeMonths : 0;

    const rowB1 = p1 ? rows.find((r) => String(r.period) === p1) : null;
    const rowB2 = p2 ? rows.find((r) => String(r.period) === p2) : null;
    const rowB3 = p3 ? rows.find((r) => String(r.period) === p3) : null;

    const b1Qty = Number(rowB1?.history_sales) || 0;
    const b2Qty = Number(rowB2?.history_sales) || 0;
    const b3Qty = Number(rowB3?.history_sales) || 0;

    const b1Val = Number(rowB1?.sales_value) || 0;
    const b2Val = Number(rowB2?.sales_value) || 0;
    const b3Val = Number(rowB3?.sales_value) || 0;

    const activeMonthsB3 = [
      (b1Qty > 0 || b1Val > 0) ? 1 : 0,
      (b2Qty > 0 || b2Val > 0) ? 1 : 0,
      (b3Qty > 0 || b3Val > 0) ? 1 : 0,
    ].reduce((a, b) => a + b, 0);

    const totalQtyB3 = b1Qty + b2Qty + b3Qty;
    const totalValB3 = b1Val + b2Val + b3Val;

    const avgQtyB3Active = activeMonthsB3 > 0 ? totalQtyB3 / activeMonthsB3 : 0;
    const avgValueB3Active = activeMonthsB3 > 0 ? totalValB3 / activeMonthsB3 : 0;

    const aggRecord: AggregatedProductHistory = {
      code,
      totalQty,
      totalValue,
      activeMonths,
      avgQty,
      avgValue,
      sales_b1: b1Qty,
      sales_b2: b2Qty,
      sales_b3: b3Qty,
      sales_val_b1: b1Val,
      sales_val_b2: b2Val,
      sales_val_b3: b3Val,
      activeMonthsB3,
      avgQtyB3: totalQtyB3 / 3,
      avgQtyB3Active,
      avgValueB3Active,
    };
    map.set(code, aggRecord);
    map.set(code.replace(/^0+/, ""), aggRecord);
  }

  return map;
}

export interface ParsedOutletHistorySales {
  totalSales: number;
  averageSales: number;
  productCount: number;
  productSalesMap: Map<string, number>;
  productQtyMap: Map<string, number>;
}

/**
 * Parses the response of post-history-sales API for a specific outlet.
 * Returns total sales, monthly average sales (across all products), and per-product maps.
 */
export function parseOutletHistorySales(
  response: any,
  piCode: string
): ParsedOutletHistorySales {
  const result: ParsedOutletHistorySales = {
    totalSales: 0,
    averageSales: 0,
    productCount: 0,
    productSalesMap: new Map(),
    productQtyMap: new Map(),
  };

  if (!response?.data || typeof response.data !== "object") return result;

  const rawPi = String(piCode || "").trim();
  const firstKey = Object.keys(response.data)[0];
  const isPeriodNested = firstKey && /^\d{6}$/.test(firstKey);

  if (isPeriodNested) {
    const numMonths = Array.isArray(response.period) && response.period.length > 0 ? response.period.length : 3;
    let sumTotalSales = 0;
    const proQtyTotal = new Map<string, number>();
    const proValTotal = new Map<string, number>();

    for (const [pKey, pObj] of Object.entries(response.data)) {
      if (!pObj || typeof pObj !== "object") continue;
      const outletObj: any = (pObj as any)[rawPi] || (pObj as any)[rawPi.toUpperCase()] || (pObj as any)[rawPi.toLowerCase()] || Object.values(pObj)[0];
      if (!outletObj || typeof outletObj !== "object") continue;

      if (outletObj.total_sales != null) {
        sumTotalSales += Number(outletObj.total_sales) || 0;
      }

      for (const [proCode, val] of Object.entries(outletObj)) {
        if (proCode === "total_sales" || proCode === "average_sales") continue;
        if (val && typeof val === "object") {
          const item = val as any;
          const q = Number(item.sales_qty ?? item.history_sales) || 0;
          const v = Number(item.sales_value) || 0;
          proQtyTotal.set(proCode, (proQtyTotal.get(proCode) || 0) + q);
          proValTotal.set(proCode, (proValTotal.get(proCode) || 0) + v);
        }
      }
    }

    result.totalSales = sumTotalSales;
    result.averageSales = numMonths > 0 ? sumTotalSales / numMonths : 0;

    for (const [code, qTotal] of proQtyTotal.entries()) {
      const vTotal = proValTotal.get(code) || 0;
      const qAvg = numMonths > 0 ? qTotal / numMonths : 0;
      const vAvg = numMonths > 0 ? vTotal / numMonths : 0;

      result.productQtyMap.set(code, qAvg);
      result.productQtyMap.set(code.replace(/^0+/, ""), qAvg);
      result.productSalesMap.set(code, vAvg);
      result.productSalesMap.set(code.replace(/^0+/, ""), vAvg);
      if (qTotal > 0 || vTotal > 0) {
        result.productCount++;
      }
    }

    return result;
  }

  const outletData =
    response.data[rawPi] ||
    response.data[rawPi.toUpperCase()] ||
    response.data[rawPi.toLowerCase()] ||
    Object.values(response.data)[0];

  if (!outletData || typeof outletData !== "object") return result;

  result.totalSales = Number(outletData.total_sales) || 0;
  result.averageSales = Number(outletData.average_sales) || 0;

  for (const [key, val] of Object.entries(outletData)) {
    if (key === "total_sales" || key === "average_sales") continue;
    if (val && typeof val === "object") {
      const item = val as any;
      const salesAvg = Number(item.sales_value_avg) || 0;
      const qtyAvg = Number(item.history_sales_avg) || 0;
      const salesVal = Number(item.sales_value) || 0;
      const salesQty = Number(item.sales_qty) || 0;

      result.productSalesMap.set(key, salesAvg);
      result.productSalesMap.set(key.replace(/^0+/, ""), salesAvg);

      result.productQtyMap.set(key, qtyAvg);
      result.productQtyMap.set(key.replace(/^0+/, ""), qtyAvg);

      if (salesAvg > 0 || qtyAvg > 0 || salesVal > 0 || salesQty > 0) {
        result.productCount++;
      }
    }
  }

  if (result.averageSales === 0 && result.productSalesMap.size > 0) {
    let sumAvg = 0;
    for (const [key, val] of Object.entries(outletData)) {
      if (key === "total_sales" || key === "average_sales") continue;
      if (val && typeof val === "object") {
        sumAvg += Number((val as any).sales_value_avg) || 0;
      }
    }
    if (sumAvg > 0) {
      result.averageSales = sumAvg;
    }
  }

  if (result.totalSales === 0 && result.averageSales > 0) {
    result.totalSales = result.averageSales * 3;
  }

  return result;
}

