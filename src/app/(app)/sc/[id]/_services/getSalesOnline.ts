import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export interface SalesOnlineItem {
  code: string;
  qty_sales: number;
  value_sales: number | null;
  zat_aktif: string | null;
}

export interface SalesOnlineResponse {
  data: SalesOnlineItem[];
  pi_code?: string;
  period?: string[];
  message?: string | null;
}

export async function getSalesOnline(piCode: string): Promise<SalesOnlineResponse | null> {
  if (!piCode) return null;
  try {
    const url = `${CANVASSER_API_BASE_URL}/api/get-sales-online?pi_code=${encodeURIComponent(piCode)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`Failed to fetch sales online from ${url}: status ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data as SalesOnlineResponse;
  } catch (error) {
    console.error("Error fetching sales online from Canvasser API:", error);
    return null;
  }
}
