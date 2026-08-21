import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export async function getScCashbackPoa(): Promise<any | null> {
  try {
    const url = `${CANVASSER_API_BASE_URL}/api/get-cashback-poa`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`Canvasser Cashback POA API returned status ${res.status} for ${url}`);
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching cashback POA from Canvasser API:`, error);
    return null;
  }
}
