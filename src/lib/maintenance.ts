import { prisma } from "@/lib/prisma";

export interface MaintenanceState {
  enabled: boolean;
  viewOnly: boolean;
  message: string | null;
}

const DEFAULT_MESSAGE = "Sistem sedang dalam pemeliharaan. Silakan coba lagi beberapa saat lagi.";

export const WRITE_BLOCKED_MESSAGE =
  "Sistem sedang mode view-only untuk maintenance/migrasi data. Perubahan data sementara dinonaktifkan — coba lagi nanti.";

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
    return { enabled: row?.enabled ?? false, viewOnly: row?.viewOnly ?? false, message: row?.message ?? null };
  } catch (err) {
    console.error("[maintenance] failed to read MaintenanceMode, failing open:", err);
    return { enabled: false, viewOnly: false, message: null };
  }
}

export function maintenanceMessage(state: MaintenanceState): string {
  return state.message?.trim() || DEFAULT_MESSAGE;
}

/**
 * True when this role's writes should be rejected right now — either the
 * full lockout (`enabled`) or the softer read-only mode (`viewOnly`) is on.
 * ADMIN is always exempt from both, same as the full-lockout screen in
 * (app)/layout.tsx. Every "use server" mutation should call this (or
 * assertWritable below) right after resolving the acting user's role — see
 * the call sites across src/app/actions/*.ts for the established pattern.
 */
export async function isWriteBlocked(role: string): Promise<boolean> {
  if (role === "ADMIN") return false;
  const state = await getMaintenanceState();
  return state.enabled || state.viewOnly;
}

/** Throws WRITE_BLOCKED_MESSAGE if this role's writes are currently blocked — see isWriteBlocked. */
export async function assertWritable(role: string): Promise<void> {
  if (await isWriteBlocked(role)) throw new Error(WRITE_BLOCKED_MESSAGE);
}
