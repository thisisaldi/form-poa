import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export async function getScCashbackPoa(piCode?: string): Promise<any | null> {
  try {
    const url = piCode
      ? `${CANVASSER_API_BASE_URL}/api/get-cashback-poa?pi_code=${encodeURIComponent(piCode)}`
      : `${CANVASSER_API_BASE_URL}/api/get-cashback-poa`;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow",
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      try {
        const errorData = await res.json();
        return errorData || { status: false, message: "Gudang Tidak Ditemukan", matrix: [] };
      } catch {
        return { status: false, message: "Gudang Tidak Ditemukan", matrix: [] };
      }
    }

    return await res.json();
  } catch {
    return { status: false, message: "Gudang Tidak Ditemukan", matrix: [] };
  }
}
