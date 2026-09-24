import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import type { SalesCounterProductApiResponse } from "../_models/SalesCounterProductModel";

/**
 * Resolves candidate 6-digit YYYYMM periods to try in priority order.
 * - If current month is within the target quarter (e.g. today is 202609 in 2026-Q3):
 *   tries current month [202609], followed by earlier months in the quarter.
 * - If target quarter is in the future (e.g. 2026-Q4 while today is 202609):
 *   tries target quarter start month first [202610], then falls back to current month [202609].
 * - If target quarter is in the past (e.g. 2026-Q1 while today is 202609):
 *   tries last month of that quarter [202603], then first month [202601], then current month [202609].
 * - If direct YYYYMM is given (e.g. 202610):
 *   tries that month first, then current month if different.
 */
export function resolveCandidatePeriods(period?: string | null): string[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentYYYYMM = `${currentYear}${String(currentMonthNum).padStart(2, "0")}`;

  if (!period) return [currentYYYYMM];
  const clean = period.trim();

  // If explicit 6-digit YYYYMM
  if (/^\d{6}$/.test(clean)) {
    return clean === currentYYYYMM ? [clean] : [clean, currentYYYYMM];
  }

  // If quarter format (YYYY-Q1..4)
  const match = clean.match(/^(\d{4})-Q([1-4])$/i);
  if (match) {
    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3 + 1;
    const quarterMonths = [0, 1, 2].map((i) => `${year}${String(startMonth + i).padStart(2, "0")}`);

    // If current calendar month is within this quarter (e.g. today is 202609 in 2026-Q3)
    if (quarterMonths.includes(currentYYYYMM)) {
      const priorMonthsInQ = quarterMonths.filter((m) => m < currentYYYYMM).reverse();
      return [currentYYYYMM, ...priorMonthsInQ];
    }

    // If target quarter is in the future (e.g. 2026-Q4 while today is 202609)
    if (currentYYYYMM < quarterMonths[0]) {
      return [quarterMonths[0], currentYYYYMM];
    }

    // If target quarter is in the past (e.g. 2026-Q1 while today is 202609)
    return [quarterMonths[quarterMonths.length - 1], quarterMonths[0], currentYYYYMM];
  }

  return [currentYYYYMM];
}

/**
 * Backward-compatible helper returning the primary resolved candidate period.
 */
export function resolveAwalPeriode(period?: string | null): string | undefined {
  const candidates = resolveCandidatePeriods(period);
  return candidates[0];
}

export async function getSalesCounterProduct(
  piCode: string,
  period?: string | null
): Promise<SalesCounterProductApiResponse | null> {
  const candidates = resolveCandidatePeriods(period);

  // 1. Coba panggil kandidat periode secara berurutan (prioritas periode target -> periode terkini)
  for (const p of candidates) {
    try {
      const urlWithPeriod = `${CANVASSER_API_BASE_URL}/product/get-sales-counter-product?pi_code=${encodeURIComponent(piCode)}&period=${encodeURIComponent(p)}`;
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
        `[getSalesCounterProduct] Failed fetching with period=${p} for outlet ${piCode}:`,
        err
      );
    }
  }

  // 2. Fallback: jika semua kandidat periode kosong/gagal, panggil tanpa parameter periode (mengambil data master aktif terbaru)
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
