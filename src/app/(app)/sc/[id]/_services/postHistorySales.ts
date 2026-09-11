import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export interface PostHistorySalesProductItem {
  sales_value: number;
  sales_qty: number;
  sales_value_avg: number;
  history_sales_avg: number;
}

export interface PostHistorySalesOutletData {
  total_sales?: number;
  average_sales?: number;
  [proCode: string]: PostHistorySalesProductItem | number | undefined;
}

export interface PostHistorySalesResponse {
  data: Record<string, PostHistorySalesOutletData> | null;
  pi_code?: string[];
  pro_code?: string[] | null;
  period?: string[];
  aggregated?: boolean;
  message?: string | null;
}

export interface PostHistorySalesParams {
  piCodes: string[];
  period?: (number | string)[];
  agg?: boolean;
  proCodes?: string[];
}

export async function postHistorySales(
  params: PostHistorySalesParams
): Promise<PostHistorySalesResponse | null> {
  const { piCodes, period, agg = true, proCodes } = params;
  const cleanPiCodes = (piCodes || []).map((c) => String(c).trim()).filter(Boolean);
  if (cleanPiCodes.length === 0) return null;

  const payload: Record<string, any> = {
    pi_code: cleanPiCodes,
    agg: agg ? "True" : "False",
  };

  if (period && period.length > 0) {
    payload.period = period.map((p) => {
      const num = Number(p);
      return !isNaN(num) ? num : String(p);
    });
  }

  if (proCodes && proCodes.length > 0) {
    const cleanProCodes = proCodes.map((c) => String(c).trim()).filter(Boolean);
    if (cleanProCodes.length > 0) {
      payload.pro_code = cleanProCodes;
    }
  }

  try {
    const url = `${CANVASSER_API_BASE_URL}/api/post-history-sales`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      if (res.status === 404) return null;
      console.error(`Failed to post history sales to ${url}: status ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data as PostHistorySalesResponse;
  } catch (error) {
    console.error("Error calling post-history-sales API:", error);
    return null;
  }
}
