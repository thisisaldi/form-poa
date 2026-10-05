"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export interface LoginAccessState {
  blockedRoles: string[];
  allowedNips: string[];
}

interface LoginAccessResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "ADMIN") throw new Error("Hanya admin yang bisa mengatur akses login.");
  return session;
}

export async function getLoginAccessAction(): Promise<LoginAccessState> {
  await requireAdmin();
  const row = await prisma.loginAccessConfig.findUnique({ where: { id: 1 } });
  return { blockedRoles: row?.blockedRoles ?? [], allowedNips: row?.allowedNips ?? [] };
}

/** ADMIN is never blockable (would lock out the only way to undo this). */
export async function setLoginAccessAction(blockedRoles: string[], allowedNipsRaw: string): Promise<LoginAccessResult> {
  try {
    const session = await requireAdmin();
    const roles = [...new Set(blockedRoles.filter((r) => r && r !== "ADMIN"))];
    const nips = [...new Set(allowedNipsRaw.split(/[\s,;]+/).map((n) => n.trim().toUpperCase()).filter(Boolean))];
    await prisma.loginAccessConfig.upsert({
      where: { id: 1 },
      update: { blockedRoles: roles, allowedNips: nips, updatedByNip: session.userId },
      create: { id: 1, blockedRoles: roles, allowedNips: nips, updatedByNip: session.userId },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}
