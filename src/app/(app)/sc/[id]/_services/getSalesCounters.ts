import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";
import type { SalesCounterPersonApiResponse } from "../_models/SalesCounterPersonModel";

export async function getSalesCountersByOutlet(piCode: string): Promise<SalesCounterPersonApiResponse | null> {
  try {
    const res = await fetch(`${CANVASSER_API_BASE_URL}/canvasser/get-sales-counter?pi_code=${piCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`Canvasser API returned status ${res.status} for outlet ${piCode}`);
      return null;
    }

    const data = (await res.json()) as SalesCounterPersonApiResponse;

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data.filter((sc) => {
        const status = sc.status_sc?.toLowerCase();
        return status === "pending" || status === "approved";
      });
    }

    return data;
  } catch (error) {
    console.error(`Failed fetching sales counter from Canvasser API for outlet ${piCode}:`, error);
    return null;
  }
}
