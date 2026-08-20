import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export async function getScInsentifHistory(piCode: string): Promise<any | null> {
  try {
    const res = await fetch(`${CANVASSER_API_BASE_URL}/api/get-sc-insentif-history?pi_code=${piCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

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
