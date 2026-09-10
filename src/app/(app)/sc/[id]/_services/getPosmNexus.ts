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
    const https = await import("https");
    const bodyData = JSON.stringify({
      periods: period,
      outletCode: outletId,
    });

    const headers: Record<string, string | number> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyData),
      ...nexusAuthV2Headers(),
    };

    return await new Promise<PosmResponse | null>((resolve) => {
      const req = https.request(
        {
          hostname: "api-nexus.pharos.id",
          port: 443,
          path: "/api/r/posm-placement",
          method: "GET",
          headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errText = "";
            res.on("data", (d) => (errText += d));
            res.on("end", () => {
              console.error(
                `Failed to fetch POSM data for ${outletId}: status ${res.statusCode} - ${errText}`
              );
              resolve(null);
            });
            return;
          }

          let responseBody = "";
          res.on("data", (chunk) => (responseBody += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(responseBody) as PosmResponse;
              resolve(parsed);
            } catch (err) {
              console.error(`Failed parsing POSM response for ${outletId}:`, err);
              resolve(null);
            }
          });
        }
      );

      req.on("error", (err) => {
        console.error(`Error fetching POSM data for ${outletId}:`, err);
        resolve(null);
      });

      req.write(bodyData);
      req.end();
    });
  } catch (error) {
    console.error(`Error in getPosmNexus for ${outletId}:`, error);
    return null;
  }
}
