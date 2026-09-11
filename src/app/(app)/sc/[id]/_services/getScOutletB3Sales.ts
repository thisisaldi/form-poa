import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export interface B3SalesItem {
  pro_code: string;
  average_qty: number;
  average_sales: number;
}

export async function getScOutletB3Sales(period: number, piCode: string, proCodes: string[]): Promise<B3SalesItem[]> {
  if (!piCode || !proCodes || proCodes.length === 0) return [];
  try {
    const cleanCodes = proCodes.map((c) => String(c).trim()).filter(Boolean);
    if (cleanCodes.length === 0) return [];

    const res = await fetchWithTimeout(`${CANVASSER_API_BASE_URL}/api/post-get-sc-outlet-b3-sales`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        period,
        pi_code: piCode,
        pro_codes: cleanCodes,
      }),
      next: { revalidate: 60 },
    }, 4000);

    if (!res.ok) {
      console.error(`B3 Sales API returned status ${res.status} for ${piCode}`);
      return [];
    }

    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  } catch (err) {
    console.error("Failed fetching B3 Sales from Canvasser API:", err);
    return [];
  }
}
