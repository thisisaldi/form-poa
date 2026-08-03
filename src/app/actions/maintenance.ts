"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getMaintenanceState, type MaintenanceState } from "@/lib/maintenance";

interface MaintenanceActionResult {
  ok: boolean;
  error?: string;
  state?: MaintenanceState;
}

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "ADMIN") throw new Error("Hanya admin yang bisa mengatur mode maintenance.");
  return session;
}

export async function getMaintenanceStateAction(): Promise<MaintenanceState> {
  await requireAdmin();
  return getMaintenanceState();
}

/**
 * Toggles the site-wide maintenance lockout — see MaintenanceMode doc
 * comment in schema.prisma and the (app) layout's gating check. Only an
 * ADMIN can flip this (and only an ADMIN can still reach this action while
 * it's on, since the layout itself blocks every other role first).
 */
export async function setMaintenanceModeAction(enabled: boolean, message: string): Promise<MaintenanceActionResult> {
  try {
    const session = await requireAdmin();
    const row = await prisma.maintenanceMode.upsert({
      where: { id: 1 },
      update: { enabled, message: message.trim() || null, updatedByNip: session.userId },
      create: { id: 1, enabled, message: message.trim() || null, updatedByNip: session.userId },
    });
    revalidatePath("/", "layout");
    return { ok: true, state: { enabled: row.enabled, message: row.message } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}
