import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";
import { prisma } from "@/lib/prisma";

export interface ApotekOnlineResponse {
  data?: string[] | null;
  message?: string | null;
  NIP?: string;
}

function stripTestPrefix(nip: string): string {
  return nip.replace(/^test/i, "");
}

export async function getApotekOnline(
  nip: string,
  position?: string
): Promise<string[]> {
  if (!nip) return [];
  try {
    let targetNip = nip.trim();
    let targetPosition = position;

    // Check dummy user mappings
    if (targetNip === "SCMR123456") {
      targetNip = "P250091";
      targetPosition = targetPosition || "MR";
    } else if (targetNip === "SCASM123456") {
      targetNip = "L260437";
      targetPosition = targetPosition || "ASM";
    } else if (targetNip === "SCSM123456") {
      targetNip = "P230219";
      targetPosition = targetPosition || "SM";
    } else if (targetNip === "SCNSM123456") {
      targetNip = "P080855";
      targetPosition = targetPosition || "NSM";
    } else if (targetNip?.toLowerCase().startsWith("test")) {
      targetNip = stripTestPrefix(targetNip);
    }

    // If position not explicitly provided, look up from User table
    if (!targetPosition) {
      const user = await prisma.user.findUnique({
        where: { nip: nip.trim() },
        select: { role: true },
      });
      targetPosition = user?.role || "MR";
    }

    const url = `${CANVASSER_API_BASE_URL}/api/get-apotek-online?nip=${encodeURIComponent(
      targetNip
    )}&position=${encodeURIComponent(targetPosition || "MR")}`;

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
