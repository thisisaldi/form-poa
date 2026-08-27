import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export interface HistorySalesItem {
  code: string;
  history_sales: number;
}

export interface HistorySalesResponse {
  data: HistorySalesItem[];
  pi_code?: string;
  period?: string[];
  aggregated?: boolean;
  message?: string | null;
}

export async function getHistorySales(piCode: string): Promise<HistorySalesResponse | null> {
  if (!piCode) return null;
  try {
    const url = `${CANVASSER_API_BASE_URL}/api/get-history-sales?pi_code=${encodeURIComponent(piCode)}&agg=True`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
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
