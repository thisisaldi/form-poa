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
    const q = quarter.toUpperCase().startsWith("Q") ? quarter.toUpperCase() : `Q${quarter}`;
    const url = `${CANVASSER_API_BASE_URL}/api/get-history-incentive-sales-counter?pi_code=${encodeURIComponent(
      piCode
    )}&quarter=${encodeURIComponent(q)}&year=${encodeURIComponent(String(year))}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
      5000
    );

    if (!res.ok) {
      console.error(`Canvasser History Incentive Sales Counter API returned status ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching history incentive sales counter from Canvasser API:`, error);
    return null;
  }
}
