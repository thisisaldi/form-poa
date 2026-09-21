import { HEALTHYONE_API_BASE_URL, fetchWithTimeout } from "@/lib/canvasserApi";

export interface HealthyOnePurchaseOrderItem {
  procode: string;
  sell_pack: string;
  product_name: string;
  ordered_qty: number;
  price: number;
  discount: number;
}

export interface GetHealthyOneParams {
  piCodes: string[];
  startDate?: string;
  endDate?: string;
}

export async function getHealthyOnePurchaseOrderDetail(
  params: GetHealthyOneParams
): Promise<HealthyOnePurchaseOrderItem[]> {
  const { piCodes, startDate = "2025-05-01", endDate = "2026-08-15" } = params;
  if (!piCodes || piCodes.length === 0) return [];

  try {
    const rawBaseUrl = process.env.HEALTHYONE_API_BASE_URL || HEALTHYONE_API_BASE_URL || "http://10.0.170.210:8000/healthcare-intelligence/api";
    const baseUrl = rawBaseUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/marketplacev2/get-purchase-order-detail`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          pi_code: piCodes,
          start_date: startDate,
          end_date: endDate,
        }),
      },
      8000
    );

    if (!res.ok) {
      console.error(`Failed to fetch HealthyOne data from ${url}: status ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      return data as HealthyOnePurchaseOrderItem[];
    }
    if (data && Array.isArray((data as any).data)) {
      return (data as any).data as HealthyOnePurchaseOrderItem[];
    }
    return [];
  } catch (error) {
    console.error("Error fetching HealthyOne purchase order detail:", error);
    return [];
  }
}
