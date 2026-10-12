"use server";

import { PoaStatus, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getVisiblePoaScFilter } from "@/lib/authz";
import type { SalesCounterAuditLogItem } from "@/components/sc/detail/types/timeline";

const MAX_LOGS = 200;

/**
 * Riwayat Aktivitas SC for one outlet, loaded on demand from the detail page
 * once the user picks an outlet — the page no longer ships every audit log.
 * Same reach as the detail page: forms the user can see, plus forms they
 * currently hold for approval.
 */
export async function getScActivityLogsAction(formIds: string[]): Promise<{
  logs: SalesCounterAuditLogItem[];
  truncated: boolean;
}> {
  const empty = { logs: [], truncated: false };
  const session = await getCurrentUser();
  if (!session || !Array.isArray(formIds) || formIds.length === 0) return empty;

  const actor = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!actor) return empty;

  const visibleFilter = await getVisiblePoaScFilter({ ...actor, role: session.role as Role });
  const forms: { id: string; kodePI: string; namaOutlet: string | null }[] = await prisma.poaScForm.findMany({
    where: {
      id: { in: formIds.slice(0, 50) },
      OR: [visibleFilter, { currentHolderId: actor.nip, status: { not: PoaStatus.DRAFT } }],
    },
    select: { id: true, kodePI: true, namaOutlet: true },
  });
  if (forms.length === 0) return empty;
  const formById = new Map(forms.map((f) => [f.id, f]));

  const rows: (Omit<SalesCounterAuditLogItem, "namaOutlet" | "kodePI"> & { poaScId: string })[] =
    await prisma.poaScAuditLog.findMany({
      where: { poaScId: { in: forms.map((f) => f.id) } },
      select: {
        id: true,
        poaScId: true,
        actorId: true,
        action: true,
        fromStatus: true,
        toStatus: true,
        snapshot: true,
        createdAt: true,
        actor: { select: { nip: true, name: true, role: true, jabatan: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_LOGS + 1,
    });

  // Newest MAX_LOGS, shown oldest-first like the old timeline.
  const truncated = rows.length > MAX_LOGS;
  const logs = rows
    .slice(0, MAX_LOGS)
    .reverse()
    .map((r) => ({
      ...r,
      namaOutlet: formById.get(r.poaScId)?.namaOutlet || null,
      kodePI: formById.get(r.poaScId)?.kodePI || null,
    }));
  return { logs, truncated };
}
