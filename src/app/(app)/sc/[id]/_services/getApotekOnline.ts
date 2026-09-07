import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export interface ApotekOnlineResponse {
  data?: string[] | null;
  message?: string | null;
  NIP?: string;
}

export async function getApotekOnline(
  nip: string,
  position: string = "MR"
): Promise<string[]> {
  if (!nip) return [];
  try {
    let targetNip = nip.trim();
    if (targetNip === "SCMR123456") {
      targetNip = "P250091";
    }

    const url = `${CANVASSER_API_BASE_URL}/api/get-apotek-online?nip=${encodeURIComponent(
      targetNip
    )}&position=${encodeURIComponent(position || "MR")}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return [];
    }

    const json = (await res.json()) as ApotekOnlineResponse;
    if (Array.isArray(json?.data)) {
      return json.data.map(String).filter(Boolean);
    }
    return [];
  } catch (error) {
    console.error("Error fetching apotek online from Canvasser API:", error);
    return [];
  }
}
