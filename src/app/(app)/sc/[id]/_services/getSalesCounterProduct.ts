import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import type { SalesCounterProductApiResponse } from "../_models/SalesCounterProductModel";

/**
 * Resolves the 6-digit start month of a quarter (e.g. "2026-Q3" -> "202607", "2026-Q1" -> "202601")
 * or returns the period if it is already a 6-digit YYYYMM format.
 */
export function resolveAwalPeriode(period?: string | null): string | undefined {
  if (!period) return undefined;
  const clean = period.trim();
  if (/^\d{6}$/.test(clean)) return clean;
  const match = clean.match(/^(\d{4})-Q([1-4])$/i);
  if (match) {
    const year = match[1];
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3 + 1;
    return `${year}${String(startMonth).padStart(2, "0")}`;
  }
  return undefined;
}

export async function getSalesCounterProduct(
  piCode: string,
  period?: string | null
): Promise<SalesCounterProductApiResponse | null> {
  const awalPeriode = resolveAwalPeriode(period);

  // 1. Coba panggil dengan parameter awal periode terlebih dahulu jika ada
  if (awalPeriode) {
    try {
      const urlWithPeriod = `${CANVASSER_API_BASE_URL}/product/get-sales-counter-product?pi_code=${encodeURIComponent(piCode)}&period=${encodeURIComponent(awalPeriode)}`;
      const res = await fetchWithTimeout(
        urlWithPeriod,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          next: { revalidate: 60 },
        },
        4000
      );

      if (res.ok) {
        const json = (await res.json()) as SalesCounterProductApiResponse;
        if (json && Array.isArray(json.data) && json.data.length > 0) {
          return json;
        }
      }
    } catch (err) {
      console.warn(
        `[getSalesCounterProduct] Failed fetching with period=${awalPeriode} for outlet ${piCode}, falling back to without period:`,
        err
      );
    }
  }

  // 2. Fallback: jika tidak ada periode atau jika pemanggilan dengan periode kosong/gagal, panggil tanpa parameter periode
  try {
    const fallbackUrl = `${CANVASSER_API_BASE_URL}/product/get-sales-counter-product?pi_code=${encodeURIComponent(piCode)}`;
    const res = await fetchWithTimeout(
      fallbackUrl,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 60 },
      },
      4000
    );

    if (!res.ok) {
      console.error(`Canvasser Product API returned status ${res.status} for outlet ${piCode}`);
      return null;
    }

    return (await res.json()) as SalesCounterProductApiResponse;
  } catch (error) {
    console.error(`Failed fetching sales counter products from Canvasser API for outlet ${piCode}:`, error);
    return null;
  }
}
