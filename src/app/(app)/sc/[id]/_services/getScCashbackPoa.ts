import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import type { CashbackData } from "@/lib/scCashback";

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
    }, 60000);

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

/**
 * Like getScCashbackPoa(piCode), but only a real "outlet not found" (404) is
 * returned as data — any other failure throws, so the form summary doesn't
 * freeze cashback = 0 just because the API was down.
 */
export async function getScCashbackPoaStrict(piCode: string): Promise<CashbackData> {
  const url = `${CANVASSER_API_BASE_URL}/api/get-cashback-poa?pi_code=${encodeURIComponent(piCode)}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    redirect: "follow",
    cache: "no-store",
  }, 60000);

  if (res.ok) return await res.json();
  if (res.status === 404) {
    // Same not-found shape getScCashbackPoa returns, so calculateCashbackDetails
    // sees exactly what the outlet card sees.
    return await res.json().catch(() => null) || { status: false, message: "Gudang Tidak Ditemukan", matrix: [] };
  }
  throw new Error(`get-cashback-poa returned status ${res.status}`);
}
