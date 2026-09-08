import { nexusAuthV2Headers } from "@/lib/nexusAuth";

export interface BlastInQuarter {
  quarter: number;
  is_paid: boolean;
  paid_at: string | null;
  is_final: boolean;
  reward_acc: number;
  reward_paid: number | null;
  actual_sales: number | null;
  reward_quarter: number;
  sales_final_at: string | null;
  is_sales_achieve: boolean;
  target_sales_acc: number;
  target_sales_quarter: number;
}

export interface BlastInRegistrant {
  status: string;
  batch_id: number;
  batch_name: string;
  outlet_code: string;
  outlet_name: string;
  reward_type: string;
  registrant_id: number;
  target_period: number;
  baseline_period: number;
  quarters: BlastInQuarter[];
}

export interface BlastInResponse {
  data: {
    year: number;
    outlet_code: string;
    registrants: BlastInRegistrant[];
    total_registrant: number;
  };
  status: string;
  message: string;
}

export async function getBlastInData(
  outletId: string,
  year: number = new Date().getFullYear()
): Promise<BlastInResponse | null> {
  if (!outletId) return null;
  try {
    const url = `https://api-nexus.pharos.id/api/r/blastin?outletid=${encodeURIComponent(
      outletId.trim()
    )}&tahun=${year}`;

    const headers = {
      Accept: "application/json",
      ...nexusAuthV2Headers(),
    };

    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const errBody = await res.text().catch(() => "");
      console.error(
        `Failed to fetch Blast-In data for ${outletId}: status ${res.status}${errBody ? ` - ${errBody}` : ""}`
      );
      return null;
    }

    const data = (await res.json()) as BlastInResponse;
    return data;
  } catch (error) {
    console.error(`Error fetching Blast-In data for ${outletId}:`, error);
    return null;
  }
}
