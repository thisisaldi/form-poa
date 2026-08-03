import { prisma } from "@/lib/prisma";

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
}

const DEFAULT_MESSAGE = "Sistem sedang dalam pemeliharaan. Silakan coba lagi beberapa saat lagi.";

/**
 * Reads the singleton MaintenanceMode row — id=1 is seeded by migration, so
 * this always resolves. Fails OPEN (treated as disabled) on any query error
 * rather than throwing — this runs inside (app)/layout.tsx on every request
 * for every non-ADMIN role, so a transient DB hiccup here must not become an
 * accidental site-wide lockout with no way for anyone to reach /admin and
 * turn it back off.
 */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  try {
    const row = await prisma.maintenanceMode.findUnique({ where: { id: 1 } });
    return { enabled: row?.enabled ?? false, message: row?.message ?? null };
  } catch (err) {
    console.error("[maintenance] failed to read MaintenanceMode, failing open:", err);
    return { enabled: false, message: null };
  }
}

export function maintenanceMessage(state: MaintenanceState): string {
  return state.message?.trim() || DEFAULT_MESSAGE;
}
