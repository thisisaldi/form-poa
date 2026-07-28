/**
 * POA Workflow Service — the ONLY place where PoaForm.status is mutated.
 *
 * All state transitions go through here. Never update status inline elsewhere.
 * Structured so REJECTED / revision-request states can be added without major refactor:
 * just extend TRANSITIONS and add a new exported function.
 */

import { prisma } from "@/lib/prisma";
import { canEdit, canApprove, canFastTrackApprove, canCancelApproved } from "@/lib/authz";
import { sendPoaStatusEmail } from "@/lib/notifications";
import { PoaStatus, AuditAction } from "@prisma/client";
import type { PoaForm, User } from "@prisma/client";

// ─── Transition Map ───────────────────────────────────────────────────────────

type TransitionTarget = {
  toStatus: PoaStatus;
  /** Role of the next holder. Null = fully approved, no further holder. */
  nextHolderRole: "ASM" | "SM" | "NSM" | null;
};

// Post-approval re-submit steps only — the DRAFT/REVISI → first-submit step is
// resolved dynamically by firstSubmitTransition() below, since its target
// depends on the OWNER's own role (normally MR → ASM, but see canCreatePoa
// for the vacant-team case where an ASM/SM owns the POA themselves).
const SUBMIT_TRANSITIONS: Partial<Record<PoaStatus, TransitionTarget>> = {
  [PoaStatus.APPROVED_BY_ASM]: { toStatus: PoaStatus.SUBMITTED_TO_SM, nextHolderRole: "SM" },
  [PoaStatus.APPROVED_BY_SM]: { toStatus: PoaStatus.SUBMITTED_TO_NSM, nextHolderRole: "NSM" },
};

const ROLE_LEVEL: Record<string, number> = { MR: 0, ASM: 1, SM: 2, NSM: 3 };
const APPROVAL_CHAIN: ("ASM" | "SM" | "NSM")[] = ["ASM", "SM", "NSM"];
const CHAIN_STATUS: Record<"ASM" | "SM" | "NSM", PoaStatus> = {
  ASM: PoaStatus.SUBMITTED_TO_ASM,
  SM: PoaStatus.SUBMITTED_TO_SM,
  NSM: PoaStatus.SUBMITTED_TO_NSM,
};

/**
 * First submit step for a DRAFT/REVISI POA — starts one level ABOVE the
 * owner's own role. For a normal MR-owned POA that's ASM, same as before.
 * For an ASM/SM who owns their own POA (vacant-team case, see canCreatePoa),
 * it starts one level higher still — they can't be both submitter and
 * approver of their own first step, so it skips straight to their own atasan.
 */
function firstSubmitTransition(ownerRole: string): TransitionTarget {
  const target = APPROVAL_CHAIN[ROLE_LEVEL[ownerRole] ?? 0];
  if (!target) {
    // Owner is already SM+ with no level between them and NSM — shouldn't
    // normally happen (NSM has nobody to submit "up" to), but resolve safely.
    return { toStatus: PoaStatus.APPROVED_BY_NSM, nextHolderRole: null };
  }
  return { toStatus: CHAIN_STATUS[target], nextHolderRole: target };
}

// Approve goes directly to the next level — no separate "submit upward" step.
const APPROVE_TRANSITIONS: Record<PoaStatus, TransitionTarget | null> = {
  [PoaStatus.SUBMITTED_TO_ASM]: { toStatus: PoaStatus.SUBMITTED_TO_SM,  nextHolderRole: "SM"  },
  [PoaStatus.SUBMITTED_TO_SM]:  { toStatus: PoaStatus.SUBMITTED_TO_NSM, nextHolderRole: "NSM" },
  [PoaStatus.SUBMITTED_TO_NSM]: { toStatus: PoaStatus.APPROVED_BY_NSM,  nextHolderRole: null  },
  // Intermediate statuses kept for backward compat but unreachable in normal flow
  [PoaStatus.DRAFT]: null,
  [PoaStatus.REVISI]: null,
  [PoaStatus.APPROVED_BY_ASM]: null,
  [PoaStatus.APPROVED_BY_SM]: null,
  [PoaStatus.APPROVED_BY_NSM]: null,
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

interface ReportsToChain extends User {
  reportsTo?: ReportsToChain | null;
}

/**
 * Walk up the owner's reportsTo chain and return the first user at or above
 * the target role level. Deliberately NOT a fixed number of hops — a vacant
 * intermediate level (e.g. ASM) has no User row at all, so whoever reports
 * "through" it already has their nipAtasan pointing past it, one level up.
 * Walking by role instead of by hop count means that gap just works, instead
 * of resolveNextHolder needing to know in advance how many levels were skipped.
 */
function resolveNextHolder(
  poa: PoaForm & { owner: ReportsToChain },
  nextHolderRole: "ASM" | "SM" | "NSM"
): string | null {
  const targetLevel = ROLE_LEVEL[nextHolderRole];
  let current: ReportsToChain | null = poa.owner.reportsTo ?? null;
  while (current) {
    if ((ROLE_LEVEL[current.role] ?? -1) >= targetLevel) return current.nip;
    current = current.reportsTo ?? null;
  }
  return null;
}

async function loadPoaWithHierarchy(poaId: string) {
  return prisma.poaForm.findUniqueOrThrow({
    where: { id: poaId },
    include: {
      owner: {
        include: {
          reportsTo: {
            include: {
              reportsTo: {
                include: {
                  reportsTo: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

async function applyTransition(
  poaId: string,
  actingUserId: string,
  transition: TransitionTarget,
  fromStatus: PoaStatus,
  action: AuditAction,
  notes?: string,
  snapshotExtra?: Record<string, unknown>
): Promise<PoaForm> {
  const poa = await loadPoaWithHierarchy(poaId);

  // Authorization is the caller's job (submitPoa/approvePoa/flagRevisionOnEdit
  // each use the right predicate — canEdit vs. the stricter canApprove).

  let nextHolderId: string | null = null;
  if (transition.nextHolderRole) {
    nextHolderId = resolveNextHolder(poa, transition.nextHolderRole);
    if (!nextHolderId) {
      throw new Error(
        `Cannot resolve next holder (${transition.nextHolderRole}) for POA ${poaId} — check org hierarchy data`
      );
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.poaForm.update({
      where: { id: poaId },
      data: {
        status: transition.toStatus,
        currentHolderId: nextHolderId,
        // Each re-entry into Revisi is a new "Version X" — bumped here, nowhere else.
        ...(transition.toStatus === PoaStatus.REVISI ? { version: { increment: 1 } } : {}),
      },
    }),
    prisma.poaAuditLog.create({
      data: {
        poaId,
        actorId: actingUserId,
        action,
        fromStatus,
        toStatus: transition.toStatus,
        snapshot: { ...(notes ? { notes } : {}), ...snapshotExtra },
      },
    }),
  ]);

  // Fire-and-forget notification (errors are logged, not thrown)
  sendPoaStatusEmail(updated, action, nextHolderId).catch((err) =>
    console.error("[notifications] sendPoaStatusEmail failed:", err)
  );

  return updated;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * MR submits their draft POA → moves to SUBMITTED_TO_ASM.
 * ASM approves → their "submit upward" also goes through here (after APPROVED_BY_ASM).
 * SM similarly.
 *
 * The very first submit (from DRAFT/REVISI) targets one level above the
 * OWNER's own role, not always "ASM" — see firstSubmitTransition().
 *
 * TODO: add pre-submit validation of poa.data fields once form schema is defined.
 */
export async function submitPoa(
  poaId: string,
  actingUserId: string,
  notes?: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId }, include: { owner: true } });

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canEdit(actingUser, poa))) {
    throw new Error(`User ${actingUserId} does not have edit rights on POA ${poaId}`);
  }

  const transition = poa.status === PoaStatus.DRAFT || poa.status === PoaStatus.REVISI
    ? firstSubmitTransition(poa.owner.role)
    : SUBMIT_TRANSITIONS[poa.status as PoaStatus];
  if (!transition) {
    throw new Error(
      `Cannot submit a POA in status ${poa.status}`
    );
  }

  return applyTransition(poaId, actingUserId, transition, poa.status, AuditAction.SUBMIT, notes);
}

/**
 * ASM/SM/NSM approves a submitted POA at their level. Stricter than canEdit —
 * only the current holder may complete this, so an edit-only visitor can't
 * skip ahead and approve on someone else's behalf.
 */
export async function approvePoa(
  poaId: string,
  actingUserId: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!canApprove(actingUser, poa)) {
    throw new Error(`User ${actingUserId} is not authorized to approve POA ${poaId}`);
  }

  const transition = APPROVE_TRANSITIONS[poa.status];
  if (!transition) {
    throw new Error(
      `Cannot approve a POA in status ${poa.status}`
    );
  }

  return applyTransition(poaId, actingUserId, transition, poa.status, AuditAction.APPROVE);
}

/**
 * NSM-only override — approve straight to APPROVED_BY_NSM regardless of the
 * POA's current status (SUBMITTED_TO_ASM/SM/NSM) or currentHolderId, skipping
 * ASM/SM review entirely. See canFastTrackApprove for the authorization rule.
 * Business owner, 2026-07-23: "NSM bisa langsung approve tanpa harus ke ASM
 * atau SM dulu".
 */
export async function fastTrackApprove(
  poaId: string,
  actingUserId: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canFastTrackApprove(actingUser, poa))) {
    throw new Error(`User ${actingUserId} is not authorized to fast-track approve POA ${poaId}`);
  }

  return applyTransition(
    poaId,
    actingUserId,
    { toStatus: PoaStatus.APPROVED_BY_NSM, nextHolderRole: null },
    poa.status,
    AuditAction.APPROVE,
    "Fast-track approval oleh NSM — melewati ASM/SM"
  );
}

/**
 * ASM/SM/NSM explicitly rejects a submitted POA at their level — distinct from
 * flagRevisionOnEdit's automatic bounce-back (which fires when the owning MR
 * edits a submitted POA). A reject always requires a reason, recorded on the
 * audit log so the MR sees why it was sent back when they reopen it.
 */
export async function rejectPoa(
  poaId: string,
  actingUserId: string,
  reason: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!canApprove(actingUser, poa)) {
    throw new Error(`User ${actingUserId} is not authorized to reject POA ${poaId}`);
  }

  return applyTransition(
    poaId,
    actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    poa.status,
    AuditAction.REJECT,
    reason
  );
}

/**
 * NSM undoes their own already-completed approval — sends the POA back to
 * REVISI (same target/consequences as a normal reject: owner must revise and
 * resubmit, version bumps) rather than inventing a separate "undo" state.
 * Deliberately its own function (not a reuse of rejectPoa) since the
 * authorization rule is different: canApprove is holder-gated, but
 * currentHolderId is already null once APPROVED_BY_NSM, so this checks
 * canCancelApproved instead (NSM + status must genuinely be APPROVED_BY_NSM).
 * Always requires a reason, same as rejectPoa, recorded on the audit log.
 */
export async function cancelApprovedByNsm(
  poaId: string,
  actingUserId: string,
  reason: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canCancelApproved(actingUser, poa))) {
    throw new Error(`User ${actingUserId} is not authorized to cancel approval on POA ${poaId}`);
  }

  return applyTransition(
    poaId,
    actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    poa.status,
    AuditAction.CANCEL,
    reason
  );
}

/**
 * Whether anyone above the owner has already approved this POA in its
 * current review cycle — walks the audit log newest-first and stops at the
 * last DRAFT/REVISI entry (a cycle reset point), same scan shape as
 * authz.ts's getEditLockLevel. Used by flagRevisionOnEdit below to tell
 * "submitted, still waiting on the first review" (nobody has approved yet —
 * free to keep editing in place) apart from "already approved at some level"
 * (an edit now must go through the Revisi/resubmit flow).
 */
export async function hasApprovalThisCycle(poaId: string): Promise<boolean> {
  const logs = await prisma.poaAuditLog.findMany({
    where: { poaId },
    orderBy: { createdAt: "desc" },
    select: { action: true, toStatus: true },
  });
  for (const log of logs) {
    if (log.toStatus === PoaStatus.DRAFT || log.toStatus === PoaStatus.REVISI) break;
    if (log.action === AuditAction.APPROVE) return true;
  }
  return false;
}

/**
 * Called whenever a line item is added/edited/deleted. Whoever edits an
 * already-submitted POA still needs their own atasan's approval afterward —
 * exactly the same principle as a normal approve, just re-triggered by a change:
 *
 *   - The owning MR edits BEFORE anyone above has approved this cycle (still
 *     sitting with the first reviewer, e.g. SUBMITTED_TO_ASM with no APPROVE
 *     yet) → status/holder are left untouched, no version bump, no resubmit
 *     needed — the MR can freely fix things while it's waiting on that first
 *     review (2026-07-27: "kalau sudah ajukan tapi belum diapprove, masih
 *     bisa edit").
 *   - The owning MR edits AFTER someone above has already approved this cycle
 *     → needs approval again from scratch, so status bounces all the way back
 *     to REVISI (holder cleared) and must be resubmitted (REVISI →
 *     SUBMITTED_TO_ASM). In practice canEdit's Lock Edit Logic already blocks
 *     the owner from reaching this once locked — they need it rejected /
 *     cancelled by whoever holds it before they can edit again — but the
 *     bounce still applies here as the source of truth if that ever changes.
 *   - An ASM edits while it's in their queue → still needs SM approval next,
 *     same as if they'd approved without editing. Status/holder are left
 *     untouched — they just save the change and click Approve & Teruskan as
 *     usual, which forwards it to SM.
 *   - Same for SM (→ needs NSM) and NSM (→ nothing above them).
 *
 * So only the owning MR's edit after an approval is a "real" revision reset
 * here; an approver's edit is a no-op on status, since the ordinary approve
 * step already routes it to their atasan. Status-wise it's a no-op either way
 * while already DRAFT or REVISI — but every edit, status-changing or not,
 * still gets its own PoaAuditLog(UPDATE) entry so Riwayat Aktivitas always
 * shows who edited what and when, not just the status transitions.
 *
 * `detail` carries which customer/product the edit touched (and what kind of
 * edit — add/update/delete a line item), so Riwayat Aktivitas can show that
 * instead of a bare "mengedit". Optional because some callers (e.g. bulk ops)
 * may not have a single customer/product to point at.
 */
export async function flagRevisionOnEdit(
  poaId: string,
  actingUserId: string,
  detail?: { customer?: string | null; product?: string | null; op?: "add" | "update" | "delete" }
): Promise<PoaForm | null> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;
  const snapshotExtra = detail ? { ...detail } : undefined;

  const stillPendingFirstApproval =
    poa.status !== PoaStatus.DRAFT && poa.status !== PoaStatus.REVISI &&
    !(await hasApprovalThisCycle(poaId));

  if (poa.status === PoaStatus.DRAFT || poa.status === PoaStatus.REVISI || stillPendingFirstApproval) {
    await prisma.poaAuditLog.create({
      data: {
        poaId,
        actorId: actingUserId,
        action: AuditAction.UPDATE,
        fromStatus: poa.status,
        toStatus: poa.status,
        snapshot: snapshotExtra ?? {},
      },
    });
    return null;
  }
  if (poa.ownerId !== actingUserId) return null;

  return applyTransition(
    poaId,
    actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    poa.status,
    AuditAction.REVISE,
    undefined,
    snapshotExtra
  );
}

/**
 * Create a new POA draft — normally for an MR, but also usable by an ASM/SM/NSM
 * whose own team is vacant (see canCreatePoa in authz.ts).
 */
export async function createPoaDraft(
  ownerId: string,
  period: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.create({
    data: {
      ownerId,
      period,
      status: PoaStatus.DRAFT,
    },
  });

  await prisma.poaAuditLog.create({
    data: {
      poaId: poa.id,
      actorId: ownerId,
      action: AuditAction.CREATE,
      fromStatus: null,
      toStatus: PoaStatus.DRAFT,
      snapshot: {},
    },
  });

  return poa;
}
