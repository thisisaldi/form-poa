import { prisma } from "@/lib/prisma";

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
}

const DEFAULT_MESSAGE = "Sistem sedang dalam pemeliharaan. Silakan coba lagi beberapa saat lagi.";

/** Reads the singleton MaintenanceMode row — id=1 is seeded by migration, so this always resolves. */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  const row = await prisma.maintenanceMode.findUnique({ where: { id: 1 } });
  return { enabled: row?.enabled ?? false, message: row?.message ?? null };
}

export function maintenanceMessage(state: MaintenanceState): string {
  return state.message?.trim() || DEFAULT_MESSAGE;
}
