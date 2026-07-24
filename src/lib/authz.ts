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

/**
 * Resolve IDs of EVERY subordinate (any role, not just MR) within `depth`
 * hops — unlike getMrIdsUnder, this includes intermediate managers themselves.
 * Needed by getVisiblePoaFilter/canView: an ASM/SM/NSM can own a POA directly
 * when their team is vacant (see canCreatePoa), and getMrIdsUnder alone would
 * never surface that owner's NIP to their own superior (2026-07-22 fix — an
 * SM couldn't open an ASM's self-owned, already-submitted POA at all, since
 * the old MR-only subtree check never matched the ASM's own NIP as owner).
 */
async function getSubordinateIdsUnder(managerId: string, depth: number): Promise<string[]> {
  if (depth === 0) return [];

  const directReports = await prisma.user.findMany({
    where: { nipAtasan: managerId, isActive: true },
    select: { nip: true, role: true },
  });

  const ids: string[] = [];
  for (const report of directReports) {
    ids.push(report.nip);
    if (report.role !== Role.MR) {
      const deeper = await getSubordinateIdsUnder(report.nip, depth - 1);
      ids.push(...deeper);
    }
  }
  return ids;
}

/** Public: returns all MR nips in the subtree of the given user (for monitoring, PM dashboard). */
export async function getSubordinateMRNips(user: User): Promise<string[]> {
  if (user.role === Role.MR) return [user.nip];
  // GM/SFE have the same company-wide read-only oversight as ADMIN everywhere
  // else in this file (see canView/getVisiblePoaFilter) — same here. SFE is
  // summary-only (no per-POA drill-down, see canView/getVisiblePoaFilter
  // default case), but /summary itself needs the full company-wide MR list
  // to aggregate over (2026-07-24: new SFE role, "hanya monitor summarynya").
  if (user.role === Role.ADMIN || user.role === Role.GM || user.role === Role.SFE) {
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
      // ASM sees POAs from their direct MR reports (only after draft), PLUS their
      // own POA at any status — an ASM can own a POA themselves when their MR
      // team is vacant (see canCreatePoa), so it needs the same "always visible
      // to its owner" treatment a normal MR gets. Uses getSubordinateIdsUnder
      // (not getMrIdsUnder) so a subordinate ASM/SM's OWN self-owned POA is
      // visible to their superior too, not just plain MR-owned ones.
      const subIds = await getSubordinateIdsUnder(user.nip, 1);
      return {
        OR: [
          { ownerId: user.nip },
          { ownerId: { in: subIds }, status: { in: NON_DRAFT_STATUSES } },
        ],
      };
    }

    case Role.SM: {
      // SM sees POAs from MRs under their ASMs (2 hops), plus their own (see ASM above).
      const subIds = await getSubordinateIdsUnder(user.nip, 2);
      return {
        OR: [
          { ownerId: user.nip },
          { ownerId: { in: subIds }, status: { in: NON_DRAFT_STATUSES } },
        ],
      };
    }

    case Role.NSM: {
      // NSM sees all POAs (3 hops), plus their own (see ASM above).
      const subIds = await getSubordinateIdsUnder(user.nip, 3);
      return {
        OR: [
          { ownerId: user.nip },
          { ownerId: { in: subIds }, status: { in: NON_DRAFT_STATUSES } },
        ],
      };
    }

    case Role.GM:
      // GM: read-only oversight across every territory — same visibility as ADMIN,
      // but canEdit/canApprove below deliberately don't grant GM any write access.
      return {};

    case Role.ADMIN:
      // ADMIN sees everything
      return {};

    case Role.SFE:
      // SFE is monitoring-only (2026-07-24: new role, "hanya monitor
      // summarynya saja") — no per-POA visibility at all, not even read-only
      // like GM. They only ever read the aggregate /summary page, which goes
      // through getSubordinateMRNips (also updated for SFE), not this filter.
      return { id: "impossible" };

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

  // The owner always sees their own POA, any status — normally an MR, but an
  // ASM/SM/NSM can own one too when their team is vacant (see canCreatePoa).
  if (poa.ownerId === user.nip) return true;

  if (user.role === Role.MR) return false; // MR only ever sees their own (checked above)

  // For managers viewing a SUBORDINATE's POA: must be non-draft AND the owner must
  // be in their subtree. REVISI behaves like DRAFT — it's back in the owner's
  // hands, not yet visible upward.
  if (poa.status === PoaStatus.DRAFT || poa.status === PoaStatus.REVISI) return false;

  const depthByRole: Record<string, number> = {
    [Role.ASM]: 1,
    [Role.SM]: 2,
    [Role.NSM]: 3,
  };
  const depth = depthByRole[user.role];
  if (!depth) return false;

  // getSubordinateIdsUnder (not getMrIdsUnder) so a subordinate ASM/SM's own
  // self-owned POA (vacant-team case, see canCreatePoa) is visible to their
  // superior — the old MR-only subtree check never matched a manager's own NIP.
  const subIds = await getSubordinateIdsUnder(user.nip, depth);
  return subIds.includes(poa.ownerId);
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

  // The owner can always edit their own POA — normally an MR, but an ASM/SM/NSM
  // filling in for a vacant team owns theirs the same way (see canCreatePoa).
  if (poa.ownerId === user.nip) return true;

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

/** Statuses where a POA is genuinely still awaiting someone's approval. */
const PENDING_APPROVAL_STATUSES: PoaStatus[] = [
  PoaStatus.SUBMITTED_TO_ASM,
  PoaStatus.SUBMITTED_TO_SM,
  PoaStatus.SUBMITTED_TO_NSM,
];

/**
 * NSM-only override: approve a POA straight to fully-approved, regardless of
 * which stage it's actually at (SUBMITTED_TO_ASM/SM/NSM) and regardless of
 * who the current holder is — skips ASM/SM review entirely. Unlike
 * canApprove, this deliberately does NOT check currentHolderId; it only
 * requires the POA to (a) genuinely be pending somewhere in the chain, not
 * a draft/already-fully-approved, and (b) be in the NSM's own subtree
 * (same rule as canView). Business owner, 2026-07-23: "NSM bisa langsung
 * approve tanpa harus ke ASM atau SM dulu".
 */
export async function canFastTrackApprove(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role !== Role.NSM) return false;
  if (!PENDING_APPROVAL_STATUSES.includes(poa.status)) return false;
  return canView(user, poa);
}

/**
 * Can this user create a new POA?
 *
 * Normal case: an MR (leaf, no subordinates) who holds at least one outlet.
 * Dummy (workshop/demo) accounts skip the outlet-assignment requirement — they
 * can see every outlet (see getOutletsByUser) without needing real assignment rows.
 *
 * Vacant-outlet exception: an ASM/SM/NSM can ALSO create a POA if at least one
 * SPECIFIC outlet's own chain is vacant down to them — e.g. outlet A's MR and
 * ASM are both vacant, so its SM is the first active person who can act on it.
 * This is per-outlet (Outlet.coveredByNip/coveredByRole, computed at import
 * time), not "this manager's whole team is empty" — a mostly-staffed SM still
 * qualifies if even one of their outlets has nobody below them covering it.
 * The POA itself isn't restricted here to just those outlets — getOutletsByUser
 * is what scopes the picker to them.
 */
export async function canCreatePoa(userId: string): Promise<boolean> {
  const [user, subordinateCount, assignmentCount] = await Promise.all([
    prisma.user.findUnique({ where: { nip: userId }, select: { isDummy: true, role: true } }),
    prisma.user.count({ where: { nipAtasan: userId, isActive: true } }),
    prisma.mrOutletAssignment.count({ where: { nipMR: userId } }),
  ]);
  if (user?.isDummy) return true;
  // ADMIN can always create a POA — testing only (2026-07-24): since ADMIN
  // isn't role MR, getSubordinateMRNips() (used by every summary/export/PM
  // dashboard query) never includes an ADMIN-owned POA, so this test data
  // never surfaces in anyone else's ringkasan — only ADMIN's own dashboard/POA
  // view (which already shows everything company-wide) ever sees it.
  if (user?.role === Role.ADMIN) return true;

  // Explicit MR check (not just "no subordinates + has an outlet assignment")
  // so a role that'll never have subordinates or assignments anyway — like
  // SFE, which is monitoring-only by design — can't slip through this branch.
  if (user?.role === Role.MR && subordinateCount === 0 && assignmentCount > 0) return true;

  if (user?.role && ([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role)) {
    const coveredCount = await prisma.outlet.count({
      where: { coveredByNip: userId, coveredByRole: { not: Role.MR } },
    });
    if (coveredCount > 0) return true;
  }

  return false;
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
