import { nexusAuthV2Headers } from "@/lib/nexusAuth";


export interface PosmResponse {
  data: PosmList[];
  periods: Period[];
  has_data: boolean;
  outletCode: string;
  sheet_name: string;
  total_records: number;
}

export interface Period {
  period: string;
}

export interface PosmList{
  period: string;
  records: PosmRecord[],
  has_data: boolean;
  total_records: string;
}

export interface PosmRecord{
  brand: string;
  value: number;
  period: string;
  end_period: string;
  placementDate: string;
  visibilityName: string;

}


export async function getPosmNexus(
  outletId: string,
  period: string[],
): Promise<PosmResponse | null> {
  if (!outletId) return null;
  try {
    const url = `https://api-nexus.pharos.id/api/r/posm-placement`;

    const headers = {
      Accept: "application/json",
      ...nexusAuthV2Headers(),
    };

    const body= JSON.stringify({
      periods: period,
      outletCode: outletId,
    });

    const res = await fetch(url, {
      method: "GET",
      headers,
      body,
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const errBody = await res.text().catch(() => "");
      console.error(
        `Failed to fetch POSM data for ${outletId}: status ${res.status}${errBody ? ` - ${errBody}` : ""}`
      );
      return null;
    }

    const data = (await res.json()) as PosmResponse;
    return data;
  } catch (error) {
    console.error(`Error fetching POSM data for ${outletId}:`, error);
    return null;
  }
}
