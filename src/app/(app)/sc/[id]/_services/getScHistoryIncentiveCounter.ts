import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export interface ScHistoryIncentiveItem {
  pi_code: string;
  code: string;
  name: string;
  win_incentive: number;
  win_qty: number;
}

export interface ScHistoryIncentiveResponse {
  data: ScHistoryIncentiveItem[];
  pi_code?: string;
  quarter?: string;
  year?: number | string;
}

export async function getScHistoryIncentiveCounter(
  piCode: string,
  quarter: string,
  year: string | number
): Promise<ScHistoryIncentiveResponse | null> {
  try {
    const cleanPiCode = String(piCode || "").trim().toUpperCase();
    const cleanQuarter = String(quarter || "").trim().toUpperCase();
    const q = cleanQuarter.startsWith("Q") ? cleanQuarter : `Q${cleanQuarter}`;
    const cleanYear = String(year || "").trim();

    const baseUrl = (
      CANVASSER_API_BASE_URL ||
      "https://staging-izmo.chc.pharmalink.id/healthcare-productdetection/api"
    ).replace(/\/+$/, "");

    const url = `${baseUrl}/api/get-history-incentive-sales-counter?pi_code=${encodeURIComponent(
      cleanPiCode
    )}&quarter=${encodeURIComponent(q)}&year=${encodeURIComponent(cleanYear)}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
      15000
    );

    if (!res.ok) {
      console.error(
        `Canvasser History Incentive Sales Counter API returned status ${res.status} for ${url}`
      );
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching history incentive sales counter from Canvasser API:`, error);
    return null;
  }
}
