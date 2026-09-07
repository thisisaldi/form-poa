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
}

/**
 * Aggregates raw monthly history sales (from getHistorySales with agg=False)
 * to calculate Average per active transaction month (not divided by 12 months unconditionally).
 */
export function aggregateHistorySales(rawResponse: any): Map<string, AggregatedProductHistory> {
  const map = new Map<string, AggregatedProductHistory>();
  if (!rawResponse?.data || !Array.isArray(rawResponse.data)) return map;

  const rawPeriods = Array.isArray(rawResponse.period) ? [...rawResponse.period] : [];
  const validPeriods = rawPeriods
    .map(String)
    .filter((p) => p.length === 6)
    .sort(); // ascending: e.g. 202509 ... 202608

  const p1 = validPeriods[validPeriods.length - 1]; // Latest month (B1)
  const p2 = validPeriods[validPeriods.length - 2]; // Month before latest (B2)
  const p3 = validPeriods[validPeriods.length - 3]; // 2 months before latest (B3)

  // Group raw rows by product code
  const productRows = new Map<string, any[]>();
  for (const row of rawResponse.data) {
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
      const aggRecord: AggregatedProductHistory = {
        code,
        totalQty: sumQty,
        totalValue: sumVal,
        activeMonths: 12,
        avgQty: Number(item.history_sales) || 0,
        avgValue: Number(item.sales_value) || 0,
        sales_b1: Number(item.sales_b1) || 0,
        sales_b2: Number(item.sales_b2) || 0,
        sales_b3: Number(item.sales_b3) || 0,
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

    const aggRecord: AggregatedProductHistory = {
      code,
      totalQty,
      totalValue,
      activeMonths,
      avgQty,
      avgValue,
      sales_b1: Number(rowB1?.history_sales) || 0,
      sales_b2: Number(rowB2?.history_sales) || 0,
      sales_b3: Number(rowB3?.history_sales) || 0,
    };
    map.set(code, aggRecord);
    map.set(code.replace(/^0+/, ""), aggRecord);
  }

  return map;
}
