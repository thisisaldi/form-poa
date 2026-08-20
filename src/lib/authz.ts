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

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { PoaStatus, Role, AuditAction } from "@prisma/client";
import type { Prisma, PoaForm, PoaDoctorApproval, User } from "@prisma/client";

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
 *
 * Wrapped in React's `cache()` (2026-08-03 perf fix): canView/canEdit each
 * re-derive this same subtree independently, so a page that runs canEdit
 * per-row over a list (e.g. dashboard, up to pageSize rows) was re-running
 * this BFS from scratch for every single row with IDENTICAL (managerId,
 * depth) args. cache() dedupes repeat calls within one request/render —
 * same result, ≤3 DB round-trips per request instead of ≤3 × N rows.
 */
const getMrIdsUnder = cache(async function getMrIdsUnder(managerId: string, depth: number): Promise<string[]> {
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
});

/**
 * Resolve IDs of EVERY subordinate (any role, not just MR) within `depth`
 * hops — unlike getMrIdsUnder, this includes intermediate managers themselves.
 * Needed by getVisiblePoaFilter/canView: an ASM/SM/NSM can own a POA directly
 * when their team is vacant (see canCreatePoa), and getMrIdsUnder alone would
 * never surface that owner's NIP to their own superior (2026-07-22 fix — an
 * SM couldn't open an ASM's self-owned, already-submitted POA at all, since
 * the old MR-only subtree check never matched the ASM's own NIP as owner).
 *
 * Same level-by-level BFS as getMrIdsUnder above, same reason. Also wrapped
 * in `cache()` — same repeat-call story as getMrIdsUnder above, this one is
 * the one actually hit by canView's per-row re-derivation on pages like
 * dashboard (see canView below).
 */
const getSubordinateIdsUnder = cache(async function getSubordinateIdsUnder(managerId: string, depth: number): Promise<string[]> {
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
});

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
 * Can this user edit this specific POA right now? Still whole-draft-level —
 * legitimately so, since it only gates draft-wide structural actions that
 * have no per-doctor analog (deleting the whole draft, changing its quarter,
 * showing the "+ Tambah User" entry point) — NOT approval/edit-request/
 * revisi, which are per-doctor-only now (canEditDoctor and its siblings
 * below; see docs/poa-per-doctor-approval/, 2026-08-18 cleanup removed the
 * whole-draft canApprove/canRequestEdit/canRespondEditRequest and their
 * poaWorkflow.ts/poa.ts counterparts entirely — there is no by-draft
 * approve/reject/request-edit path left in this codebase).
 *
 * MR: their own POA, any status/time — editing it while still waiting on its
 *     first review (submitted, nobody above has approved yet this cycle) just
 *     saves in place, no bounce. Only once someone above has already approved
 *     does an edit bounce it back to REVISI via flagRevisionOnEditDoctor and
 *     require resubmission — though in practice the Lock Edit Logic gate below
 *     already blocks the MR from reaching that point.
 * ASM/SM/NSM: any POA visible to them (already submitted + in their subtree),
 *     any time — not only while it's specifically their turn to review. The
 *     edit button is meant to always be there.
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
 * Can this user add a BRAND-NEW doctor to this POA right now? Deliberately
 * NOT gated by getEditLockLevel the way canEdit above is (2026-08-20 bug fix:
 * "kalau sudah fully approve semua barisnya, si MR tetep bisa buat baris baru
 * ... tidak terikat by draft lagi") — that lock exists to stop the owner from
 * silently mutating an EXISTING doctor's data after someone approved it, but
 * a brand-new doctor has no approval history to protect. It has no per-doctor
 * analog to gate against (canEditDoctor already lets addLineItemAction through
 * for a doctor with no PoaDoctorApproval row yet — see assertCanEditDoctor in
 * lineItem.ts), so the entry points (the "+ Tambah User" link, `/poa/[id]/edit`)
 * shouldn't be blocked by it either. Same ownership/subtree rule as canEdit,
 * just without the lock check.
 */
export async function canAddNewDoctor(user: User, poa: PoaForm): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;
  if (poa.ownerId === user.nip) return true;
  if (([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role)) {
    return canView(user, poa);
  }
  return false;
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
  // For managers: POAs with AT LEAST ONE doctor currently sitting with them.
  // PoaForm.currentHolderId (the whole-draft rollup) only reflects the LEAST
  // advanced doctor — e.g. ASM approved 2 of 3 doctors (now with SM) but the
  // 3rd is still pending ASM: the rollup's currentHolderId stays the ASM, so
  // filtering on it hid this draft from the SM's inbox entirely until ALL
  // doctors caught up (bug report 2026-08-19: "kalau semua poa line ... sudah
  // diapprove" baru muncul). Checking the PoaDoctorApproval rows directly
  // instead surfaces the draft to SM as soon as ANY doctor reaches them.
  return { doctorApprovals: { some: { currentHolderId: user.nip } } };
}

// ─── Per-doctor approval (docs/poa-per-doctor-approval/) ──────────────────────
//
// 2026-08-13 decision: approve/reject moved from whole-draft to per-doctor
// granularity — see docs/poa-per-doctor-approval/. Every predicate below is
// the doctor-scoped twin of its PoaForm-level counterpart above, reusing the
// exact same rules (role level, current holder, subtree ownership via
// canView) but reading from a specific PoaDoctorApproval row instead of the
// PoaForm itself. The PoaForm-level predicates above are UNCHANGED and still
// govern viewing/creating a draft and any doctor that hasn't been split into
// its own PoaDoctorApproval row yet (still sitting in the owner's DRAFT/REVISI
// bucket — see PoaDoctorApproval's doc comment in schema.prisma).

/**
 * Same rule as getEditLockLevel above, scoped to ONE doctor's own audit trail
 * (doctorApprovalId = this doctor) instead of the whole draft — so Doctor A
 * being approved/edited by a superior does not lock Doctor B in the same
 * draft (docs/poa-per-doctor-approval/01-business-rules.md §5).
 */
async function getEditLockLevelForDoctor(doctorApprovalId: string, ownerId: string): Promise<number> {
  const logs = await prisma.poaAuditLog.findMany({
    where: { doctorApprovalId },
    orderBy: { createdAt: "desc" },
    select: { action: true, actorId: true, toStatus: true, actor: { select: { role: true } } },
  });

  let lockLevel = -1;
  for (const log of logs) {
    if (log.toStatus === PoaStatus.DRAFT || log.toStatus === PoaStatus.REVISI) break;
    if ((log.action === AuditAction.APPROVE || log.action === AuditAction.UPDATE) && log.actorId !== ownerId) {
      const level = ROLE_LEVEL[log.actor.role] ?? -1;
      if (level > lockLevel) lockLevel = level;
    }
  }
  return lockLevel;
}

/** Doctor-scoped twin of getLastApprover — most recent approver for THIS doctor's current cycle. */
export async function getLastApproverForDoctor(doctorApprovalId: string): Promise<{ actorId: string; role: string } | null> {
  const logs = await prisma.poaAuditLog.findMany({
    where: { doctorApprovalId },
    orderBy: { createdAt: "desc" },
    select: { action: true, toStatus: true, actorId: true, actor: { select: { role: true } } },
  });
  for (const log of logs) {
    if (log.toStatus === PoaStatus.DRAFT || log.toStatus === PoaStatus.REVISI) break;
    if (log.action === AuditAction.APPROVE) return { actorId: log.actorId, role: log.actor.role };
  }
  return null;
}

/** Doctor-scoped twin of hasApprovalThisCycle. */
export async function hasApprovalThisCycleForDoctor(doctorApprovalId: string): Promise<boolean> {
  return (await getLastApproverForDoctor(doctorApprovalId)) !== null;
}

/**
 * Can this user edit this doctor's line items right now?
 *
 * `doctor` is null when this doctor hasn't been submitted yet this cycle (no
 * PoaDoctorApproval row exists) — in that case it behaves exactly like the
 * PoaForm-level canEdit (owner always can; managers can if they can view the
 * draft at all), since there's no per-doctor lock to check yet. Once a row
 * exists, the lock is scoped to that row's own audit trail via
 * getEditLockLevelForDoctor — a superior approving/editing Doctor A never
 * locks Doctor B.
 */
export async function canEditDoctor(user: User, poa: PoaForm, doctor: PoaDoctorApproval | null): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;

  const userLevel = ROLE_LEVEL[user.role] ?? -1;
  if (userLevel >= 0 && doctor) {
    const lockLevel = await getEditLockLevelForDoctor(doctor.id, poa.ownerId);
    if (userLevel < lockLevel) return false;
  }

  if (poa.ownerId === user.nip) return true;

  if (([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role)) {
    return canView(user, poa);
  }

  return false;
}

/** Doctor-scoped twin of getEditLockRoleLabel. Null when this doctor isn't locked (or not yet split). */
export async function getEditLockRoleLabelForDoctor(poa: PoaForm, doctor: PoaDoctorApproval | null): Promise<string | null> {
  if (!doctor) return null;
  const lockLevel = await getEditLockLevelForDoctor(doctor.id, poa.ownerId);
  const label = Object.entries(ROLE_LEVEL).find(([, level]) => level === lockLevel)?.[0];
  return label ?? null;
}

/**
 * Can this user approve/reject & forward THIS doctor right now? Stricter than
 * canEditDoctor — only the doctor's own current holder may complete the
 * action, same rule as canApprove but read from PoaDoctorApproval.currentHolderId
 * instead of PoaForm.currentHolderId.
 */
export function canApproveDoctor(user: User, doctor: PoaDoctorApproval): boolean {
  if (user.role === Role.ADMIN) return true;
  return (
    ([Role.ASM, Role.SM, Role.NSM] as string[]).includes(user.role) &&
    doctor.currentHolderId === user.nip
  );
}

/** Statuses where a doctor is genuinely still awaiting someone's approval. */
const PENDING_APPROVAL_STATUSES: PoaStatus[] = [
  PoaStatus.SUBMITTED_TO_ASM,
  PoaStatus.SUBMITTED_TO_SM,
  PoaStatus.SUBMITTED_TO_NSM,
];

/** NSM-only, skips ASM/SM review for THIS doctor only — same "NSM bisa langsung approve" business rule as the (removed) whole-draft version. */
export async function canFastTrackApproveDoctor(user: User, poa: PoaForm, doctor: PoaDoctorApproval): Promise<boolean> {
  if (user.role !== Role.NSM) return false;
  if (!PENDING_APPROVAL_STATUSES.includes(doctor.status)) return false;
  return canView(user, poa);
}

/** Doctor-scoped twin of canCancelApproved — NSM undoes their own approval on THIS doctor only. */
export async function canCancelApprovedDoctor(user: User, poa: PoaForm, doctor: PoaDoctorApproval): Promise<boolean> {
  if (user.role !== Role.NSM) return false;
  if (doctor.status !== PoaStatus.APPROVED_BY_NSM) return false;
  return canView(user, poa);
}

/** Doctor-scoped twin of canRequestEdit. */
export async function canRequestEditDoctor(user: User, poa: PoaForm, doctor: PoaDoctorApproval | null): Promise<boolean> {
  if (poa.ownerId !== user.nip) return false;
  if (!doctor) return false;
  if (await canEditDoctor(user, poa, doctor)) return false;
  return hasApprovalThisCycleForDoctor(doctor.id);
}

/** Doctor-scoped twin of canRespondEditRequest. */
export async function canRespondEditRequestDoctor(user: User, doctor: PoaDoctorApproval): Promise<boolean> {
  const lastApprover = await getLastApproverForDoctor(doctor.id);
  return lastApprover?.actorId === user.nip;
}

// ─── POA Standarisasi (docs/poa-standarisasi/) ─────────────────────────────────
// Approval Phase 2 ("Approval Atasan") follows the SAME nipAtasan chain as the
// rest of the app (resolved Q3, 01-business-rules.md §7) — the pengajuan
// owner's direct atasan is the ASM approver, that ASM's own atasan is the SM
// approver. No separate RBAC table. Falls back to Outlet.coveredByNip/
// coveredByRole (same vacant-team mechanism canCreatePoa uses) when a level
// in that chain is missing.

interface PoaStandarisasiApprovers {
  asmNip: string | null;
  smNip: string | null;
}

async function getPoaStandarisasiApprovers(ownerNip: string, kodePI: string): Promise<PoaStandarisasiApprovers> {
  const owner = await prisma.user.findUnique({ where: { nip: ownerNip }, select: { nipAtasan: true } });
  let asmNip = owner?.nipAtasan ?? null;
  let smNip: string | null = null;

  if (asmNip) {
    const asm = await prisma.user.findUnique({ where: { nip: asmNip }, select: { role: true, nipAtasan: true } });
    // Chain may skip straight from MR to SM (vacant ASM) — only trust asmNip
    // as the real ASM approver if that person actually holds the ASM role.
    if (asm?.role !== Role.ASM) asmNip = null;
    smNip = asm?.nipAtasan ?? null;
  }

  if (!asmNip || !smNip) {
    const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { coveredByNip: true, coveredByRole: true } });
    if (!asmNip && outlet?.coveredByRole === Role.ASM) asmNip = outlet.coveredByNip;
    if (!smNip && outlet?.coveredByRole === Role.SM) smNip = outlet.coveredByNip;
  }

  return { asmNip, smNip };
}

/** Can this user see this pengajuan at all? Owner, resolved ASM/SM approver, or company-wide read-only roles. */
export async function canViewPoaStandarisasi(
  user: User,
  pengajuan: { ownerId: string; kodePI: string }
): Promise<boolean> {
  if (user.role === Role.ADMIN || user.role === Role.GM || user.role === Role.SFE || user.role === Role.VIEWER) return true;
  if (pengajuan.ownerId === user.nip) return true;
  if (user.role === Role.ASM || user.role === Role.SM) {
    const { asmNip, smNip } = await getPoaStandarisasiApprovers(pengajuan.ownerId, pengajuan.kodePI);
    return user.nip === asmNip || user.nip === smNip;
  }
  return false;
}

/** Only the owner can edit Phase 1/3/4 content, and only before final submit. */
export function canEditPoaStandarisasi(user: User, pengajuan: { ownerId: string; submittedAt: Date | null }): boolean {
  return pengajuan.ownerId === user.nip && !pengajuan.submittedAt;
}

/**
 * Can this user approve/reject the given Phase 2 level right now? Sequential —
 * SM can only act after ASM has already approved (resolved Q2: blocking,
 * stops at SM, no NSM escalation).
 */
export async function canApprovePoaStandarisasiAtasan(
  user: User,
  pengajuan: { ownerId: string; kodePI: string; statusApprovalAsm: string },
  level: "ASM" | "SM"
): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;
  const { asmNip, smNip } = await getPoaStandarisasiApprovers(pengajuan.ownerId, pengajuan.kodePI);
  if (level === "ASM") return user.role === Role.ASM && user.nip === asmNip;
  return user.role === Role.SM && user.nip === smNip && pengajuan.statusApprovalAsm === "DISETUJUI";
}
