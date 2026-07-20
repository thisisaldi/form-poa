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

    case Role.GM:
      // GM: read-only oversight across every territory — same visibility as ADMIN,
      // but canEdit/canApprove below deliberately don't grant GM any write access.
      return {};

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
  if (user.role === Role.GM) return true; // read-only oversight, sees every POA at any status

  if (user.role === Role.MR) {
    return poa.ownerId === user.nip;
  }

  // For managers: POA must be non-draft AND the MR must be in their subtree.
  // REVISI behaves like DRAFT — it's back in the MR's hands, not yet visible upward.
  if (poa.status === PoaStatus.DRAFT || poa.status === PoaStatus.REVISI) return false;

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
 * MR: their own POA, any status/time — editing a POA that already left DRAFT
 *     bounces it back to REVISI via flagRevisionOnEdit and requires resubmission.
 * ASM/SM/NSM: any POA visible to them (already submitted + in their subtree),
 *     any time — not only while it's specifically their turn to review. The
 *     edit button is meant to always be there. Editing doesn't skip anyone:
 *     an ASM/SM's edit still needs their own atasan's approval next via the
 *     normal Approve step (see flagRevisionOnEdit in poaWorkflow.ts) — only
 *     the ACT of approving & forwarding is restricted to the current holder,
 *     which is what canApprove() below is for.
 */
export async function canEdit(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;
  // GM is deliberately excluded here — read-only oversight only (see canView).

  if (user.role === Role.MR) {
    return poa.ownerId === user.nip;
  }

  if (([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role)) {
    return canView(user, poa);
  }

  return false;
}

/**
 * Can this user approve & forward this specific POA right now?
 * Stricter than canEdit — only the current holder (whoever it's actually
 * sitting with for review) may complete the approve action.
 */
export function canApprove(user: User, poa: PoaForm): boolean {
  if (user.role === Role.ADMIN) return true;
  // GM is deliberately excluded here too — read-only oversight only.

  return (
    ([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role) &&
    poa.currentHolderId === user.nip
  );
}

/**
 * Can this user create a new POA?
 * Only leaf nodes (no active subordinates) who hold at least one outlet.
 * Dummy (workshop/demo) accounts skip the outlet-assignment requirement — they
 * can see every outlet (see getOutletsByUser) without needing real assignment rows.
 */
export async function canCreatePoa(userId: string): Promise<boolean> {
  const [user, subordinateCount, assignmentCount] = await Promise.all([
    prisma.user.findUnique({ where: { nip: userId }, select: { isDummy: true } }),
    prisma.user.count({ where: { nipAtasan: userId, isActive: true } }),
    prisma.mrOutletAssignment.count({ where: { nipMR: userId } }),
  ]);
  if (subordinateCount !== 0) return false;
  return user?.isDummy ? true : assignmentCount > 0;
}

/**
 * Returns a filter for POAs currently pending this user's action (their inbox).
 */
export function getPendingActionFilter(user: User): Prisma.PoaFormWhereInput {
  if (user.role === Role.MR) {
    return { ownerId: user.nip, status: { in: [PoaStatus.DRAFT, PoaStatus.REVISI] } };
  }
  // For managers: POAs where they are the current holder
  return { currentHolderId: user.nip };
}
