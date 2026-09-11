import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export interface HistorySalesItem {
  code: string;
  history_sales: number;
  sales_value?: number | null;
  period?: number | string | null;
  sales_b1?: number | null;
  sales_b2?: number | null;
  sales_b3?: number | null;
}

export interface HistorySalesResponse {
  data: HistorySalesItem[];
  pi_code?: string;
  period?: string[];
  aggregated?: boolean;
  message?: string | null;
}

export async function getHistorySales(piCode: string, agg: boolean = true): Promise<HistorySalesResponse | null> {
  if (!piCode) return null;
  try {
    const aggParam = agg ? "&agg=True" : "";
    const url = `${CANVASSER_API_BASE_URL}/api/get-history-sales?pi_code=${encodeURIComponent(piCode)}${aggParam}`;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      if (res.status === 404) {
        return null;
      }
      console.error(`Failed to fetch history sales from ${url}: status ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data as HistorySalesResponse;
  } catch (error) {
    console.error("Error fetching history sales from Canvasser API:", error);
    return null;
  }
}
