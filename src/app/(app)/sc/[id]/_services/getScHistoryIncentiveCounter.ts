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

    const queryParams = `pi_code=${encodeURIComponent(cleanPiCode)}&quarter=${encodeURIComponent(
      q
    )}&year=${encodeURIComponent(cleanYear)}`;

    // Try /api/api path first (matching Django sub-router pattern), fallback to /api if 404
    const primaryUrl = `${baseUrl}/api/get-history-incentive-sales-counter?${queryParams}`;
    let res = await fetchWithTimeout(
      primaryUrl,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
      8000
    );

    if (res.status === 404) {
      // Try single /api route
      const fallbackUrl = `${baseUrl}/get-history-incentive-sales-counter?${queryParams}`;
      const fallbackRes = await fetchWithTimeout(
        fallbackUrl,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
        },
        8000
      ).catch(() => null);

      if (fallbackRes && fallbackRes.ok) {
        return await fallbackRes.json();
      }
      // If still 404 or not found, return null cleanly without error log spam
      return null;
    }

    if (!res.ok) {
      console.warn(
        `Canvasser History Incentive Sales Counter API returned status ${res.status} for ${primaryUrl}`
      );
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching history incentive sales counter from Canvasser API:`, error);
    return null;
  }
}
