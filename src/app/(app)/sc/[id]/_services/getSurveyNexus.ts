import { nexusAuthV2Headers } from "@/lib/nexusAuth";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";


export interface SurveyResponse {
  data: SurveyList;
  status: string;
  message: string;
}

export interface SurveyList {
  surveys: Survey[];
  has_data: boolean;
  outlet_code: string;
  outlet_name: string;
  total_surveys: number;
  total_outlet_employees?: number;
}

export interface Survey {
  products: SurveyProduct[];
  avg_patient: number;
  response_id: string;
  survey_date: string;
  avg_recipes_in: number;
  avg_transaction: number;
  total_outlet_employees?: number;
}

export interface SurveyProduct{
  category: string;
  product_name: string;
  sales_forecast: number;
  switching_products: Switch[];
}

export interface Switch{
  procode: string;
  prodesc: string;
}

export async function getSurveyData(
  outletId: string,
): Promise<SurveyResponse | null> {
  if (!outletId) return null;
  try {
    const url = `https://api-nexus.pharos.id/api/r/competitor-survey?outletid=${encodeURIComponent(
      outletId.trim()
    )}`;

    const headers = {
      Accept: "application/json",
      ...nexusAuthV2Headers(),
    };

    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers,
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      if (res.status === 404) return null;
      const errBody = await res.text().catch(() => "");
      console.error(
        `Failed to fetch Survey data for ${outletId}: status ${res.status}${errBody ? ` - ${errBody}` : ""}`
      );
      return null;
    }

    const data = (await res.json()) as SurveyResponse;
    return data;
  } catch (error) {
    console.error(`Error fetching Survey data for ${outletId}:`, error);
    return null;
  }
}
