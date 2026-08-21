import { prisma } from "@/lib/prisma";

/**
 * Fetch all kodePI values registered in OutletBlastIn table.
 */
export async function getBlastInOutletCodes(): Promise<string[]> {
  try {
    const rows = await prisma.outletBlastIn.findMany({
      select: { kodePI: true },
    });
    return rows.map((r: { kodePI: string }) => r.kodePI);
  } catch (error) {
    console.error("Error fetching OutletBlastIn codes:", error);
    return [];
  }
}

/**
 * Fetch Set of kodePI values registered in OutletBlastIn table.
 */
export async function getBlastInOutletSet(): Promise<Set<string>> {
  const codes = await getBlastInOutletCodes();
  return new Set(codes);
}

/**
 * Check if a specific kodePI is a Blast-In outlet.
 */
export async function isOutletBlastIn(kodePI: string): Promise<boolean> {
  if (!kodePI) return false;
  try {
    const count = await prisma.outletBlastIn.count({ where: { kodePI } });
    return count > 0;
  } catch {
    return false;
  }
}
