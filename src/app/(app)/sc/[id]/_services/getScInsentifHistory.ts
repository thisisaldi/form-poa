import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import { resolvePeriodForQuarter } from "@/lib/quarterUtils";

export async function getScInsentifHistory(piCode: string, period?: string): Promise<any | null> {
  try {
    const activePeriod = period || resolvePeriodForQuarter();
    const res = await fetchWithTimeout(`${CANVASSER_API_BASE_URL}/api/get-sc-insentif-history?pi_code=${piCode}&period=${activePeriod}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      console.error(`Canvasser Insentif History API returned status ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching insentif history from Canvasser API:`, error);
    return null;
  }
}
