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
import { PoaStatus, Role, AuditAction } from "@prisma/client";
import type { Prisma, PoaForm, User } from "@prisma/client";

// Small local copy of poaWorkflow.ts's ROLE_LEVEL — not imported from there to
// avoid a circular dependency (poaWorkflow.ts already imports FROM authz.ts).
const ROLE_LEVEL: Record<string, number> = { MR: 0, ASM: 1, SM: 2, NSM: 3 };

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
 *
 * Level-by-level BFS (2026-07-31 perf fix: "summary lag banget") — one bulk
 * `nipAtasan IN [...]` query per depth level (≤3 round-trips total, however
 * wide the org is), not the old per-manager-node recursion (one query per
 * SM, then one per ASM under each, etc. — dozens of sequential round-trips
 * for an NSM with a real subtree, on every single page load that resolves
 * "which MRs report to me").
 */
async function getMrIdsUnder(managerId: string, depth: number): Promise<string[]> {
  const mrIds: string[] = [];
  let currentLevelManagerIds = [managerId];
  for (let level = 0; level < depth && currentLevelManagerIds.length > 0; level++) {
    const directReports = await prisma.user.findMany({
      where: { nipAtasan: { in: currentLevelManagerIds }, isActive: true },
      select: { nip: true, role: true },
    });
    const nextLevelManagerIds: string[] = [];
    for (const report of directReports) {
      if (report.role === Role.MR) mrIds.push(report.nip);
      else nextLevelManagerIds.push(report.nip);
    }
    currentLevelManagerIds = nextLevelManagerIds;
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
 *
 * Same level-by-level BFS as getMrIdsUnder above, same reason.
 */
async function getSubordinateIdsUnder(managerId: string, depth: number): Promise<string[]> {
  const ids: string[] = [];
  let currentLevelManagerIds = [managerId];
  for (let level = 0; level < depth && currentLevelManagerIds.length > 0; level++) {
    const directReports = await prisma.user.findMany({
      where: { nipAtasan: { in: currentLevelManagerIds }, isActive: true },
      select: { nip: true, role: true },
    });
    const nextLevelManagerIds: string[] = [];
    for (const report of directReports) {
      ids.push(report.nip);
      // MRs have no reports of their own — no point querying for their
      // children next level, same short-circuit the old per-node recursion did.
      if (report.role !== Role.MR) nextLevelManagerIds.push(report.nip);
    }
    currentLevelManagerIds = nextLevelManagerIds;
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
  if (user.role === Role.ADMIN || user.role === Role.GM || user.role === Role.SFE || user.role === Role.VIEWER) {
    // isDummy excluded — workshop/test accounts (see generateDummyAccounts.ts,
    // the Admin "Buat Akun Dummy" form) can and do create real-looking POAs
    // (some even SUBMITTED_TO_ASM/REVISI, not just DRAFT) to walk the whole
    // approval flow solo. Without this filter those POAs silently inflate
    // company-wide Summary/dashboard aggregates for ADMIN/GM/SFE (2026-07-29
    // — confirmed 63 dummy-owned POAs already in the live DB). Regular
    // ASM/SM/NSM are unaffected either way since dummy chains' nipAtasan
    // never links into the real hierarchy they walk instead.
    const mrs = await prisma.user.findMany({ where: { role: Role.MR, isActive: true, isDummy: false }, select: { nip: true } });
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
    case Role.VIEWER:
    case Role.SFE:
      // GM/VIEWER/SFE: read-only oversight across every territory — same
      // visibility as ADMIN, but canEdit/canApprove below deliberately
      // don't grant any of them write access. SFE was originally
      // monitoring-only with no per-POA visibility at all (2026-07-24), but
      // was given the same POA detail access as GM/VIEWER on 2026-07-30
      // request ("bisa lihat detail POA bukan overview nya saja").
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
  if (user.role === Role.GM || user.role === Role.VIEWER || user.role === Role.SFE) return true; // read-only oversight, sees every POA at any status

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
 * Lock Edit Logic (2026-07-27, business decision): once an ASM/SM/NSM
 * approves OR edits a POA that isn't their own, everyone at a STRICTLY LOWER
 * role level is locked out of editing it — the actor's own level, and anyone
 * above them, can still edit. Returns the lock threshold as a role level
 * (-1 = nobody locked yet this cycle).
 *
 * Detected by reading PoaAuditLog rather than a stored flag (chosen over a
 * schema migration) — only entries since the most recent DRAFT/REVISI
 * transition count, so a fresh cycle (after a Reject or Cancel Approved NSM,
 * both of which land on REVISI) always starts fully unlocked again.
 */
async function getEditLockLevel(poaId: string, ownerId: string): Promise<number> {
  const logs = await prisma.poaAuditLog.findMany({
    where: { poaId },
    orderBy: { createdAt: "desc" },
    select: { action: true, actorId: true, toStatus: true, actor: { select: { role: true } } },
  });

  let lockLevel = -1;
  for (const log of logs) {
    if (log.toStatus === PoaStatus.DRAFT || log.toStatus === PoaStatus.REVISI) break; // cycle reset point
    if ((log.action === AuditAction.APPROVE || log.action === AuditAction.UPDATE) && log.actorId !== ownerId) {
      const level = ROLE_LEVEL[log.actor.role] ?? -1;
      if (level > lockLevel) lockLevel = level;
    }
  }
  return lockLevel;
}

/**
 * Who was the most recent approver in this POA's current review cycle — the
 * highest level reached so far (approvals only ever move upward, so "most
 * recent APPROVE log" and "highest level" are the same entry). Null if nobody
 * has approved yet this cycle (fresh cycle or still waiting on the first
 * review). Same scan shape/cycle-reset rule as getEditLockLevel above.
 *
 * Used to resolve who a locked-out owner's "Ajukan Edit" request should go
 * to — see requestEdit/grantEditRequest/declineEditRequest in poaWorkflow.ts.
 */
export async function getLastApprover(poaId: string): Promise<{ actorId: string; role: string } | null> {
  const logs = await prisma.poaAuditLog.findMany({
    where: { poaId },
    orderBy: { createdAt: "desc" },
    select: { action: true, toStatus: true, actorId: true, actor: { select: { role: true } } },
  });
  for (const log of logs) {
    if (log.toStatus === PoaStatus.DRAFT || log.toStatus === PoaStatus.REVISI) break;
    if (log.action === AuditAction.APPROVE) return { actorId: log.actorId, role: log.actor.role };
  }
  return null;
}

/** True once anyone above the owner has approved this POA in its current review cycle. */
export async function hasApprovalThisCycle(poaId: string): Promise<boolean> {
  return (await getLastApprover(poaId)) !== null;
}

/**
 * Can this user edit this specific POA right now?
 *
 * MR: their own POA, any status/time — editing it while still waiting on its
 *     first review (submitted, nobody above has approved yet this cycle) just
 *     saves in place, no bounce. Only once someone above has already approved
 *     does an edit bounce it back to REVISI via flagRevisionOnEdit and require
 *     resubmission — though in practice the Lock Edit Logic gate below already
 *     blocks the MR from reaching that point (see hasApprovalThisCycle above).
 *     Once locked, the owner can proactively ask the last approver to unlock
 *     it — see canRequestEdit/requestEdit — instead of just waiting for a
 *     spontaneous Reject/Cancel.
 * ASM/SM/NSM: any POA visible to them (already submitted + in their subtree),
 *     any time — not only while it's specifically their turn to review. The
 *     edit button is meant to always be there. Editing doesn't skip anyone:
 *     an ASM/SM's edit still needs their own atasan's approval next via the
 *     normal Approve step (see flagRevisionOnEdit in poaWorkflow.ts) — only
 *     the ACT of approving & forwarding is restricted to the current holder,
 *     which is what canApprove() below is for.
 *
 * Lock Edit Logic gate runs FIRST (ADMIN excepted): if someone above this
 * user's role level has already approved/edited this POA this cycle, this
 * user — owner included — is locked out until it cycles back to REVISI.
 * See getEditLockLevel above.
 */
export async function canEdit(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;
  // GM is deliberately excluded here — read-only oversight only (see canView).

  const userLevel = ROLE_LEVEL[user.role] ?? -1;
  if (userLevel >= 0) {
    const lockLevel = await getEditLockLevel(poa.id, poa.ownerId);
    if (userLevel < lockLevel) return false;
  }

  // The owner can always edit their own POA — normally an MR, but an ASM/SM/NSM
  // filling in for a vacant team owns theirs the same way (see canCreatePoa).
  if (poa.ownerId === user.nip) return true;

  if (([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role)) {
    return canView(user, poa);
  }

  return false;
}

/**
 * UI-friendly companion to the Lock Edit Logic gate above — used to show a
 * "terkunci karena X" message instead of silently hiding the edit button.
 * Returns null when nobody is locked (fresh cycle, or POA still DRAFT/REVISI).
 */
export async function getEditLockRoleLabel(poa: PoaForm): Promise<string | null> {
  const lockLevel = await getEditLockLevel(poa.id, poa.ownerId);
  const label = Object.entries(ROLE_LEVEL).find(([, level]) => level === lockLevel)?.[0];
  return label ?? null;
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
 * NSM-only: undo their own already-completed approval, sending the POA back
 * to REVISI (see cancelApprovedByNsm in poaWorkflow.ts). Deliberately gated to
 * APPROVED_BY_NSM only — unlike canFastTrackApprove (which covers the whole
 * pending chain), this reverses a decision already made, not a pending one.
 * Same subtree-ownership gate as canFastTrackApprove.
 */
export async function canCancelApproved(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role !== Role.NSM) return false;
  if (poa.status !== PoaStatus.APPROVED_BY_NSM) return false;
  return canView(user, poa);
}

/**
 * Can this user ask the last approver to unlock editing? Only the owner, and
 * only once locked out by an actual approval (someone above has approved
 * this cycle — while still waiting on the first review canEdit already lets
 * them straight through, no request needed). The extra hasApprovalThisCycle
 * check matters because getEditLockLevel can also lock on a non-owner's bare
 * UPDATE (an ASM editing before they've approved) — that has no "last
 * approver" to route a request to, so no request button in that case; the
 * owner just waits for that reviewer's own Approve/Reject. See requestEdit
 * in poaWorkflow.ts.
 */
export async function canRequestEdit(user: User, poa: PoaForm): Promise<boolean> {
  if (poa.ownerId !== user.nip) return false;
  if (await canEdit(user, poa)) return false;
  return hasApprovalThisCycle(poa.id);
}

/**
 * Can this user grant/decline a pending edit request? Only the specific
 * person who approved most recently this cycle (the one an "Ajukan Edit"
 * request is addressed to) — not just anyone at that role level, and not the
 * current holder (who may be a level higher and hasn't reviewed yet). See
 * grantEditRequest/declineEditRequest in poaWorkflow.ts.
 */
export async function canRespondEditRequest(user: User, poa: PoaForm): Promise<boolean> {
  const lastApprover = await getLastApprover(poa.id);
  return lastApprover?.actorId === user.nip;
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
