/**
 * Authorization module — the SINGLE source of truth for all permission checks.
 *
 * CONVENTION: Every API route and Server Action that reads or mutates PoaForm MUST
 * call through canView/canEdit/getVisiblePoaFilter. Never write ad-hoc permission
 * checks inline elsewhere. This ensures enforcement at the server layer, never only UI.
 *
 * Hierarchy resolution is always dynamic (reads current User.nipAtasan) so that
 * org changes mid-cycle automatically propagate without re-running any job.
 */

import { prisma } from "@/lib/prisma";
import { PoaStatus, Role } from "@prisma/client";
import type { Prisma, PoaForm, User } from "@prisma/client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Statuses where the POA is no longer in draft — visible to superiors. */
export const NON_DRAFT_STATUSES: PoaStatus[] = [
  PoaStatus.SUBMITTED_TO_ASM,
  PoaStatus.APPROVED_BY_ASM,
  PoaStatus.SUBMITTED_TO_SM,
  PoaStatus.APPROVED_BY_SM,
  PoaStatus.SUBMITTED_TO_NSM,
  PoaStatus.APPROVED_BY_NSM,
];

/**
 * Resolve IDs of all MRs that ultimately report (directly or indirectly) to a given user.
 * Traversal depth is bounded to the known org depth (MR→ASM→SM→NSM = 3 hops).
 */
async function getMrIdsUnder(managerId: string, depth: number): Promise<string[]> {
  if (depth === 0) return [];

  const directReports = await prisma.user.findMany({
    where: { nipAtasan: managerId, isActive: true },
    select: { nip: true, role: true },
  });

  const mrIds: string[] = [];
  for (const report of directReports) {
    if (report.role === Role.MR) {
      mrIds.push(report.nip);
    } else {
      const deeper = await getMrIdsUnder(report.nip, depth - 1);
      mrIds.push(...deeper);
    }
  }
  return mrIds;
}

/** Public: returns all MR nips in the subtree of the given user (for monitoring, PM dashboard). */
export async function getSubordinateMRNips(user: User): Promise<string[]> {
  if (user.role === Role.MR) return [user.nip];
  if (user.role === Role.ADMIN) {
    const mrs = await prisma.user.findMany({ where: { role: Role.MR, isActive: true }, select: { nip: true } });
    return mrs.map((m: { nip: string }) => m.nip);
  }
  const depthByRole: Record<string, number> = { [Role.ASM]: 1, [Role.SM]: 2, [Role.NSM]: 3 };
  const depth = depthByRole[user.role] ?? 0;
  return getMrIdsUnder(user.nip, depth);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns a Prisma WHERE clause that filters PoaForms to only those the given
 * user is permitted to see. Use this in every poa list/fetch query.
 */
export async function getVisiblePoaFilter(
  user: User
): Promise<Prisma.PoaFormWhereInput> {
  switch (user.role) {
    case Role.MR:
      // MR sees only their own POA, at any status
      return { ownerId: user.nip };

    case Role.ASM: {
      // ASM sees POAs from their direct MR reports, only after draft
      const mrIds = await getMrIdsUnder(user.nip, 1);
      return {
        ownerId: { in: mrIds },
        status: { in: NON_DRAFT_STATUSES },
      };
    }

    case Role.SM: {
      // SM sees POAs from MRs under their ASMs (2 hops)
      const mrIds = await getMrIdsUnder(user.nip, 2);
      return {
        ownerId: { in: mrIds },
        status: { in: NON_DRAFT_STATUSES },
      };
    }

    case Role.NSM: {
      // NSM sees all POAs (3 hops), after draft
      const mrIds = await getMrIdsUnder(user.nip, 3);
      return {
        ownerId: { in: mrIds },
        status: { in: NON_DRAFT_STATUSES },
      };
    }

    case Role.ADMIN:
      // ADMIN sees everything
      return {};

    default:
      return { id: "impossible" }; // safe fallback — matches nothing
  }
}

/**
 * Can this user see this specific POA?
 */
export async function canView(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;

  if (user.role === Role.MR) {
    return poa.ownerId === user.nip;
  }

  // For managers: POA must be non-draft AND the MR must be in their subtree
  if (poa.status === PoaStatus.DRAFT) return false;

  const depthByRole: Record<string, number> = {
    [Role.ASM]: 1,
    [Role.SM]: 2,
    [Role.NSM]: 3,
  };
  const depth = depthByRole[user.role];
  if (!depth) return false;

  const mrIds = await getMrIdsUnder(user.nip, depth);
  return mrIds.includes(poa.ownerId);
}

/**
 * Can this user edit this specific POA right now?
 *
 * MR: only while DRAFT
 * ASM: only when poa.currentHolderId === user.nip (status SUBMITTED_TO_ASM)
 * SM/NSM: read-only — they approve/forward but cannot edit line items
 */
export function canEdit(user: User, poa: PoaForm): boolean {
  if (user.role === Role.ADMIN) return true;

  if (user.role === Role.MR) {
    return poa.ownerId === user.nip && poa.status === PoaStatus.DRAFT;
  }

  if (user.role === Role.ASM) {
    return poa.currentHolderId === user.nip;
  }

  return false;
}

/**
 * Can this user create a new POA?
 * Only leaf nodes (no active subordinates) who hold at least one outlet.
 */
export async function canCreatePoa(userId: string): Promise<boolean> {
  const [subordinateCount, assignmentCount] = await Promise.all([
    prisma.user.count({ where: { nipAtasan: userId, isActive: true } }),
    prisma.mrOutletAssignment.count({ where: { nipMR: userId } }),
  ]);
  return subordinateCount === 0 && assignmentCount > 0;
}

/**
 * Returns a filter for POAs currently pending this user's action (their inbox).
 */
export function getPendingActionFilter(user: User): Prisma.PoaFormWhereInput {
  if (user.role === Role.MR) {
    return { ownerId: user.nip, status: PoaStatus.DRAFT };
  }
  // For managers: POAs where they are the current holder
  return { currentHolderId: user.nip };
}
