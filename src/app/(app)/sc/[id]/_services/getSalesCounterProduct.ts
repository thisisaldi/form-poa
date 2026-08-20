import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";
import type { SalesCounterProductApiResponse } from "../_models/SalesCounterProductModel";

export async function getSalesCounterProduct(piCode: string): Promise<SalesCounterProductApiResponse | null> {
  try {
    const res = await fetch(`${CANVASSER_API_BASE_URL}/product/get-sales-counter-product?pi_code=${piCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`Canvasser Product API returned status ${res.status} for outlet ${piCode}`);
      return null;
    }

    return await res.json() as SalesCounterProductApiResponse;
  } catch (error) {
    console.error(`Failed fetching sales counter products from Canvasser API for outlet ${piCode}:`, error);
    return null;
  }
}
