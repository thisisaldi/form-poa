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

function buildPostHistorySalesPayload(params: PostHistorySalesParams): Record<string, unknown> | null {
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

  return payload;
}

export async function postHistorySales(
  params: PostHistorySalesParams
): Promise<PostHistorySalesResponse | null> {
  const payload = buildPostHistorySalesPayload(params);
  if (!payload) return null;

  try {
    const url = `${CANVASSER_API_BASE_URL}/api/post-history-sales`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    }, 60000);

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

/**
 * Like postHistorySales, but only "no history" (404) resolves to null — any
 * other failure (non-2xx, timeout, network) throws, so callers that persist
 * the result (form summary) can tell "no sales" apart from "API down".
 */
export async function postHistorySalesStrict(
  params: PostHistorySalesParams
): Promise<PostHistorySalesResponse | null> {
  const payload = buildPostHistorySalesPayload(params);
  if (!payload) return null;

  const url = `${CANVASSER_API_BASE_URL}/api/post-history-sales`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  }, 60000);

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`post-history-sales returned status ${res.status}`);
  return (await res.json()) as PostHistorySalesResponse;
}
