import { CANVASSER_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";
import type { LossSalesRekomendasiApiResponse } from "../_models/ScProductRecommendationModel";

export async function getRekomendasiProduk(piCode: string): Promise<LossSalesRekomendasiApiResponse | null> {
  try {
    const res = await fetchWithTimeout(`${CANVASSER_API_BASE_URL}/loss-sales-analysis/get-rekomendasi-produk-poa?pi_code=${piCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      console.error(`Loss Sales Rekomendasi API returned status ${res.status}`);
      return null;
    }

    return (await res.json()) as LossSalesRekomendasiApiResponse;
  } catch (error) {
    console.error(`Failed fetching loss sales rekomendasi products from Canvasser API:`, error);
    return null;
  }
}
