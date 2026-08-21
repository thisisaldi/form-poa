/**
 * POA Workflow Service — the ONLY place where PoaForm.status is mutated.
 *
 * All state transitions go through here. Never update status inline elsewhere.
 * Structured so REJECTED / revision-request states can be added without major refactor:
 * just extend TRANSITIONS and add a new exported function.
 */

import { prisma } from "@/lib/prisma";
import { canEdit,
  canApproveDoctor, canFastTrackApproveDoctor, canCancelApprovedDoctor, getLastApproverForDoctor, hasApprovalThisCycleForDoctor } from "@/lib/authz";
import { sendEditRequestEmail, sendDoctorStatusEmail } from "@/lib/notifications";
import { PoaStatus, AuditAction } from "@prisma/client";
import type { PoaForm, PoaDoctorApproval, PoaRejectCategory, User } from "@prisma/client";

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
 * Walk up the owner's reportsTo chain and return the first ACTIVE user at or
 * above the target role level. Deliberately NOT a fixed number of hops — a
 * vacant intermediate level (e.g. ASM) with no User row at all has whoever
 * reports "through" it already pointing past it, one level up. Walking by
 * role instead of by hop count means that gap just works, instead of
 * resolveNextHolder needing to know in advance how many levels were skipped.
 *
 * `isActive` check added 2026-08-18 (bug report: "atasannya ga muncul tombol
 * Approval") — a deactivated ASM/SM can still be sitting in a subordinate's
 * reportsTo chain (deactivating a user doesn't rewire everyone below them the
 * way Outlet.coveredByNip/coveredByRole does for outlet-level vacancy), so
 * without this check currentHolderId could get assigned to someone inactive.
 * The person who's now ACTUALLY covering that role never matches
 * currentHolderId === user.nip, so canApproveDoctor/canApprove never let them
 * see the button at all — same class of gap getMrIdsUnder/getSubordinateIdsUnder
 * in authz.ts already guard against with `isActive: true` when walking the
 * hierarchy the other direction.
 */
function resolveNextHolder(
  poa: PoaForm & { owner: ReportsToChain },
  nextHolderRole: "ASM" | "SM" | "NSM"
): string | null {
  const targetLevel = ROLE_LEVEL[nextHolderRole];
  let current: ReportsToChain | null = poa.owner.reportsTo ?? null;
  while (current) {
    if (current.isActive && (ROLE_LEVEL[current.role] ?? -1) >= targetLevel) return current.nip;
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

// ─── Per-doctor approval (docs/poa-per-doctor-approval/) ──────────────────────
//
// 2026-08-13 decision: approve/reject moved from whole-draft to per-doctor
// granularity. 2026-08-18 cleanup: the original whole-draft functions this
// section was generalized from (applyTransition, submitPoa, approvePoa,
// fastTrackApprove, rejectPoa, cancelApprovedByNsm, requestEdit,
// grantEditRequest, declineEditRequest, flagRevisionOnEdit) were removed
// entirely — every caller had already migrated to the doctor-scoped twin
// below, so there is no by-draft approve/reject/request-edit/revisi path
// left anywhere in this codebase. PoaForm.status/currentHolderId are now
// PURELY a live-derived ROLLUP over PoaDoctorApproval rows, recomputed and
// written back after every doctor-level transition via resolvePoaRollup
// below — nothing writes them directly anymore.

/** Rank used to pick the "least advanced" doctor status for the PoaForm rollup — lower = needs more attention. */
const ROLLUP_RANK: Record<PoaStatus, number> = {
  [PoaStatus.DRAFT]: 0,
  [PoaStatus.REVISI]: 0,
  [PoaStatus.SUBMITTED_TO_ASM]: 1,
  [PoaStatus.APPROVED_BY_ASM]: 2,
  [PoaStatus.SUBMITTED_TO_SM]: 3,
  [PoaStatus.APPROVED_BY_SM]: 4,
  [PoaStatus.SUBMITTED_TO_NSM]: 5,
  [PoaStatus.APPROVED_BY_NSM]: 6,
};

/**
 * Recomputes PoaForm.status/currentHolderId as a rollup over this POA's
 * PoaDoctorApproval rows (docs/poa-per-doctor-approval/01-business-rules.md
 * §3a, OQ-1) and writes it back. Doctors with no PoaDoctorApproval row yet
 * (never submitted this cycle) count as rank 0 (same as DRAFT/REVISI) — they
 * still need the owner to act. Picks the lowest-rank doctor as representative
 * (a draft is only as "done" as its least-advanced doctor); ties are broken
 * by preferring an actual REVISI row over a same-rank never-submitted doctor,
 * since REVISI communicates "needs revision" more precisely than bare DRAFT.
 * This is a best-effort single-value approximation for legacy readers, NOT
 * the source of truth once a doctor has its own PoaDoctorApproval row — see
 * doc comment on PoaDoctorApproval in schema.prisma.
 */
async function resolvePoaRollup(poaId: string): Promise<void> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } });
  if (poa.status === PoaStatus.DRAFT) {
    // Never submitted at all yet (no doctor has been split out) — nothing to roll up.
    const anyApproval = await prisma.poaDoctorApproval.findFirst({ where: { poaId }, select: { id: true } });
    if (!anyApproval) return;
  }

  const [approvals, doctorKeys] = await Promise.all([
    prisma.poaDoctorApproval.findMany({ where: { poaId } }),
    prisma.poaLineItem.findMany({
      where: { poaId },
      distinct: ["kodePI", "namaCust"],
      select: { kodePI: true, namaCust: true },
    }),
  ]);
  const approvalByDoctor = new Map<string, PoaDoctorApproval>(
    approvals.map((a: PoaDoctorApproval) => [`${a.kodePI}|${a.namaCust}`, a])
  );

  let best: { rank: number; status: PoaStatus; currentHolderId: string | null; isRevisi: boolean } | null = null;
  for (const { kodePI, namaCust } of doctorKeys) {
    const approval = approvalByDoctor.get(`${kodePI ?? ""}|${namaCust}`);
    const status = approval?.status ?? PoaStatus.DRAFT;
    const rank = ROLLUP_RANK[status];
    const isRevisi = status === PoaStatus.REVISI;
    if (!best || rank < best.rank || (rank === best.rank && isRevisi && !best.isRevisi)) {
      best = { rank, status, currentHolderId: approval?.currentHolderId ?? null, isRevisi };
    }
  }
  if (!best) return; // no line items yet — leave PoaForm.status as-is

  await prisma.poaForm.update({
    where: { id: poaId },
    data: { status: best.status, currentHolderId: best.currentHolderId },
  });
}

async function loadDoctorApproval(poaId: string, kodePI: string, namaCust: string): Promise<PoaDoctorApproval | null> {
  return prisma.poaDoctorApproval.findUnique({
    where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } },
  });
}

/** Internal — mirrors applyTransition, but mutates a PoaDoctorApproval row (creating it if needed) instead of PoaForm. */
async function applyDoctorTransition(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  transition: TransitionTarget,
  fromStatus: PoaStatus,
  action: AuditAction,
  existing: PoaDoctorApproval | null,
  notes?: string,
  snapshotExtra?: Record<string, unknown>,
  rejectCategory?: PoaRejectCategory
): Promise<PoaDoctorApproval> {
  const poa = await loadPoaWithHierarchy(poaId);

  let nextHolderId: string | null = null;
  if (transition.nextHolderRole) {
    nextHolderId = resolveNextHolder(poa, transition.nextHolderRole);
    if (!nextHolderId) {
      throw new Error(
        `Cannot resolve next holder (${transition.nextHolderRole}) for POA ${poaId} doctor ${namaCust} — check org hierarchy data`
      );
    }
  }

  const [doctorApproval] = await prisma.$transaction([
    existing
      ? prisma.poaDoctorApproval.update({
          where: { id: existing.id },
          data: {
            status: transition.toStatus,
            currentHolderId: nextHolderId,
            ...(transition.toStatus === PoaStatus.REVISI ? { version: { increment: 1 } } : {}),
          },
        })
      : prisma.poaDoctorApproval.create({
          data: { poaId, kodePI, namaCust, status: transition.toStatus, currentHolderId: nextHolderId },
        }),
  ]);

  await prisma.poaAuditLog.create({
    data: {
      poaId,
      actorId: actingUserId,
      action,
      fromStatus,
      toStatus: transition.toStatus,
      doctorApprovalId: doctorApproval.id,
      snapshot: { namaCust, kodePI, ...(notes ? { notes } : {}), ...snapshotExtra },
      ...(rejectCategory ? { rejectCategory } : {}),
    },
  });

  await resolvePoaRollup(poaId);

  sendDoctorStatusEmail(poa, namaCust, transition.toStatus, action, nextHolderId).catch((err) =>
    console.error("[notifications] sendDoctorStatusEmail failed:", err)
  );

  return doctorApproval;
}

/**
 * MR submits ONE doctor within a draft (docs/poa-per-doctor-approval/
 * OQ-2: submit is per-doctor, not whole-draft). Creates the doctor's
 * PoaDoctorApproval row on first submit; on resubmit after REVISI, reuses it.
 */
export async function submitDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  notes?: string
): Promise<PoaDoctorApproval> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId }, include: { owner: true } });
  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canEdit(actingUser, poa))) {
    throw new Error(`User ${actingUserId} does not have edit rights on POA ${poaId}`);
  }

  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  const fromStatus = existing?.status ?? PoaStatus.DRAFT;

  const transition = !existing || existing.status === PoaStatus.REVISI
    ? firstSubmitTransition(poa.owner.role)
    : SUBMIT_TRANSITIONS[existing.status];
  if (!transition) {
    throw new Error(`Cannot submit doctor ${namaCust} in status ${fromStatus}`);
  }

  return applyDoctorTransition(poaId, kodePI, namaCust, actingUserId, transition, fromStatus, AuditAction.SUBMIT, existing, notes);
}

/** Doctor-scoped twin of approvePoa. */
export async function approveDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string
): Promise<PoaDoctorApproval> {
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No pending approval found for doctor ${namaCust} on POA ${poaId}`);

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canApproveDoctor(actingUser, existing))) {
    throw new Error(`User ${actingUserId} is not authorized to approve doctor ${namaCust} on POA ${poaId}`);
  }

  const transition = APPROVE_TRANSITIONS[existing.status];
  if (!transition) throw new Error(`Cannot approve doctor ${namaCust} in status ${existing.status}`);

  return applyDoctorTransition(poaId, kodePI, namaCust, actingUserId, transition, existing.status, AuditAction.APPROVE, existing);
}

/** Doctor-scoped twin of fastTrackApprove. */
export async function fastTrackApproveDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string
): Promise<PoaDoctorApproval> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } });
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No pending approval found for doctor ${namaCust} on POA ${poaId}`);

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canFastTrackApproveDoctor(actingUser, poa, existing))) {
    throw new Error(`User ${actingUserId} is not authorized to fast-track approve doctor ${namaCust} on POA ${poaId}`);
  }

  return applyDoctorTransition(
    poaId, kodePI, namaCust, actingUserId,
    { toStatus: PoaStatus.APPROVED_BY_NSM, nextHolderRole: null },
    existing.status, AuditAction.APPROVE, existing,
    "Fast-track approval oleh NSM — melewati ASM/SM"
  );
}

/**
 * Doctor-scoped twin of rejectPoa. `category` is required — docs/poa-rejection-categories/
 * (2026-08-13, single-select, main "Tolak" form only) — validated against the
 * PoaRejectCategory enum whitelist by the caller (rejectDoctorAction in
 * src/app/actions/poa.ts) before reaching here; Postgres's own enum
 * constraint is the final backstop against a forged/invalid value.
 */
export async function rejectDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  reason: string,
  category: PoaRejectCategory
): Promise<PoaDoctorApproval> {
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No pending approval found for doctor ${namaCust} on POA ${poaId}`);

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canApproveDoctor(actingUser, existing))) {
    throw new Error(`User ${actingUserId} is not authorized to reject doctor ${namaCust} on POA ${poaId}`);
  }

  return applyDoctorTransition(
    poaId, kodePI, namaCust, actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    existing.status, AuditAction.REJECT, existing, reason, undefined, category
  );
}

/** Doctor-scoped twin of cancelApprovedByNsm. */
export async function cancelApprovedByNsmDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  reason: string
): Promise<PoaDoctorApproval> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } });
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No approval found for doctor ${namaCust} on POA ${poaId}`);

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canCancelApprovedDoctor(actingUser, poa, existing))) {
    throw new Error(`User ${actingUserId} is not authorized to cancel approval for doctor ${namaCust} on POA ${poaId}`);
  }

  return applyDoctorTransition(
    poaId, kodePI, namaCust, actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    existing.status, AuditAction.CANCEL, existing, reason
  );
}

/** Doctor-scoped twin of requestEdit. */
export async function requestEditDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  reason?: string
): Promise<void> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } });
  if (poa.ownerId !== actingUserId) throw new Error(`User ${actingUserId} does not own POA ${poaId}`);

  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`Doctor ${namaCust} has no approval cycle on POA ${poaId} to request an edit against`);

  const lastApprover = await getLastApproverForDoctor(existing.id);
  if (!lastApprover) throw new Error(`Doctor ${namaCust} on POA ${poaId} has no approval this cycle to request an edit against`);

  await prisma.poaAuditLog.create({
    data: {
      poaId,
      actorId: actingUserId,
      action: AuditAction.REQUEST_EDIT,
      fromStatus: existing.status,
      toStatus: existing.status,
      doctorApprovalId: existing.id,
      snapshot: { namaCust, kodePI, ...(reason ? { notes: reason } : {}) },
    },
  });

  sendEditRequestEmail(poa, lastApprover.actorId).catch((err) =>
    console.error("[notifications] sendEditRequestEmail failed:", err)
  );
}

/** Doctor-scoped twin of grantEditRequest. */
export async function grantEditRequestDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string
): Promise<PoaDoctorApproval> {
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No approval found for doctor ${namaCust} on POA ${poaId}`);

  const lastApprover = await getLastApproverForDoctor(existing.id);
  if (!lastApprover || lastApprover.actorId !== actingUserId) {
    throw new Error(`User ${actingUserId} is not authorized to grant an edit request for doctor ${namaCust} on POA ${poaId}`);
  }

  return applyDoctorTransition(
    poaId, kodePI, namaCust, actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    existing.status, AuditAction.GRANT_EDIT, existing,
    "Menyetujui permintaan edit dari pemilik POA"
  );
}

/** Doctor-scoped twin of declineEditRequest. */
export async function declineEditRequestDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  reason: string
): Promise<void> {
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  if (!existing) throw new Error(`No approval found for doctor ${namaCust} on POA ${poaId}`);

  const lastApprover = await getLastApproverForDoctor(existing.id);
  if (!lastApprover || lastApprover.actorId !== actingUserId) {
    throw new Error(`User ${actingUserId} is not authorized to decline an edit request for doctor ${namaCust} on POA ${poaId}`);
  }

  await prisma.poaAuditLog.create({
    data: {
      poaId,
      actorId: actingUserId,
      action: AuditAction.DECLINE_EDIT,
      fromStatus: existing.status,
      toStatus: existing.status,
      doctorApprovalId: existing.id,
      snapshot: { namaCust, kodePI, notes: reason },
    },
  });
}

/**
 * Doctor-scoped twin of flagRevisionOnEdit — called whenever a line item
 * belonging to ONE doctor is added/edited/deleted. Same three-way logic as
 * the original (no-op while nobody's reviewed yet this cycle, bounce to
 * REVISI once the owner edits after an approval, no-op for a superior's own
 * edit), just scoped to that doctor's own PoaDoctorApproval row instead of
 * the whole draft — see docs/poa-per-doctor-approval/01-business-rules.md §5.
 */
export async function flagRevisionOnEditDoctor(
  poaId: string,
  kodePI: string,
  namaCust: string,
  actingUserId: string,
  detail?: { customer?: string | null; product?: string | null; op?: "add" | "update" | "delete" }
): Promise<PoaDoctorApproval | null> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } });
  const existing = await loadDoctorApproval(poaId, kodePI, namaCust);
  const snapshotExtra = { namaCust, kodePI, ...(detail ?? {}) };

  if (!existing) {
    // Doctor never submitted this cycle — plain UPDATE log, no status to touch.
    await prisma.poaAuditLog.create({
      data: {
        poaId,
        actorId: actingUserId,
        action: AuditAction.UPDATE,
        fromStatus: PoaStatus.DRAFT,
        toStatus: PoaStatus.DRAFT,
        snapshot: snapshotExtra,
      },
    });
    return null;
  }

  const stillPendingFirstApproval =
    existing.status !== PoaStatus.DRAFT && existing.status !== PoaStatus.REVISI &&
    !(await hasApprovalThisCycleForDoctor(existing.id));

  if (existing.status === PoaStatus.DRAFT || existing.status === PoaStatus.REVISI || stillPendingFirstApproval) {
    await prisma.poaAuditLog.create({
      data: {
        poaId,
        actorId: actingUserId,
        action: AuditAction.UPDATE,
        fromStatus: existing.status,
        toStatus: existing.status,
        doctorApprovalId: existing.id,
        snapshot: snapshotExtra,
      },
    });
    return null;
  }
  if (poa.ownerId !== actingUserId) return null;

  return applyDoctorTransition(
    poaId, kodePI, namaCust, actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    existing.status, AuditAction.REVISE, existing, undefined, snapshotExtra
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
