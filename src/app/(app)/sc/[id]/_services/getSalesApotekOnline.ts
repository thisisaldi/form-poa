import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export interface SalesApotekOnlineItem {
  FlagServicedBy: string;
  total: number;
}

export interface SalesApotekOnlineResponse {
  data: SalesApotekOnlineItem[] | null;
  pi_code?: string;
  start_date?: string;
  end_date?: string;
  message?: string | null;
}

export async function getSalesApotekOnline(
  period: string | number,
  piCode: string
): Promise<SalesApotekOnlineResponse | null> {
  if (!piCode) return null;
  try {
    const cleanPeriod = String(period || "").replace(/[^0-9]/g, "");
    const cleanPiCode = String(piCode).trim();
    const url = `${CANVASSER_API_BASE_URL}/api/get-sales-apotek-online?period=${encodeURIComponent(
      cleanPeriod
    )}&pi_code=${encodeURIComponent(cleanPiCode)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data as SalesApotekOnlineResponse;
  } catch (error) {
    console.error("Error fetching sales apotek online from Canvasser API:", error);
    return null;
  }
}
