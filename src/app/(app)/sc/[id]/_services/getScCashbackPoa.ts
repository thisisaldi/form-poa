import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export async function getScCashbackPoa(piCode?: string): Promise<any | null> {
  try {
    const url = piCode
      ? `${CANVASSER_API_BASE_URL}/api/get-cashback-poa?pi_code=${encodeURIComponent(piCode)}`
      : `${CANVASSER_API_BASE_URL}/api/get-cashback-poa`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`Canvasser Cashback POA API returned status ${res.status} for ${url}`);
      try {
        const errorData = await res.json();
        return errorData || { status: false, message: "Gudang Tidak Ditemukan" };
      } catch {
        return { status: false, message: "Gudang Tidak Ditemukan" };
      }
    }

    return await res.json();
  } catch (error) {
    console.error(`Failed fetching cashback POA from Canvasser API:`, error);
    return { status: false, message: "Gudang Tidak Ditemukan" };
  }
}
