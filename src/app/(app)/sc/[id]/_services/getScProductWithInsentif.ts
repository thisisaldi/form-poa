import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";
import type { ScProductRecommendationApiResponse } from "../_models/ScProductRecommendationModel";

export async function getScProductWithInsentif(piCode: string): Promise<ScProductRecommendationApiResponse | null> {
  try {
    const res = await fetch(`${CANVASSER_API_BASE_URL}/api/get-sc-product-with-insentif?pi_code=${piCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`Canvasser Insentif API returned status ${res.status}`);
      return null;
    }

    return await res.json() as ScProductRecommendationApiResponse;
  } catch (error) {
    console.error(`Failed fetching insentif products from Canvasser API:`, error);
    return null;
  }
}
