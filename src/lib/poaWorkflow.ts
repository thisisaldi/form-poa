/**
 * POA Workflow Service — the ONLY place where PoaForm.status is mutated.
 *
 * All state transitions go through here. Never update status inline elsewhere.
 * Structured so REJECTED / revision-request states can be added without major refactor:
 * just extend TRANSITIONS and add a new exported function.
 */

import { prisma } from "@/lib/prisma";
import { canEdit, canApprove } from "@/lib/authz";
import { sendPoaStatusEmail } from "@/lib/notifications";
import { PoaStatus, AuditAction } from "@prisma/client";
import type { PoaForm, User } from "@prisma/client";

// ─── Transition Map ───────────────────────────────────────────────────────────

type TransitionTarget = {
  toStatus: PoaStatus;
  /** Role of the next holder. Null = fully approved, no further holder. */
  nextHolderRole: "ASM" | "SM" | "NSM" | null;
};

const SUBMIT_TRANSITIONS: Record<PoaStatus, TransitionTarget | null> = {
  [PoaStatus.DRAFT]: { toStatus: PoaStatus.SUBMITTED_TO_ASM, nextHolderRole: "ASM" },
  [PoaStatus.REVISI]: { toStatus: PoaStatus.SUBMITTED_TO_ASM, nextHolderRole: "ASM" },
  [PoaStatus.APPROVED_BY_ASM]: { toStatus: PoaStatus.SUBMITTED_TO_SM, nextHolderRole: "SM" },
  [PoaStatus.APPROVED_BY_SM]: { toStatus: PoaStatus.SUBMITTED_TO_NSM, nextHolderRole: "NSM" },
  // These statuses are not valid submit sources
  [PoaStatus.SUBMITTED_TO_ASM]: null,
  [PoaStatus.SUBMITTED_TO_SM]: null,
  [PoaStatus.SUBMITTED_TO_NSM]: null,
  [PoaStatus.APPROVED_BY_NSM]: null,
};

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

async function resolveNextHolder(
  poa: PoaForm & { owner: User & { reportsTo: (User & { reportsTo: (User & { reportsTo: User | null }) | null }) | null } },
  nextHolderRole: "ASM" | "SM" | "NSM"
): Promise<string | null> {
  // Walk up the org chain from the MR to find the holder with the right role
  const owner = poa.owner;
  switch (nextHolderRole) {
    case "ASM":
      return owner.reportsTo?.nip ?? null;
    case "SM":
      return owner.reportsTo?.reportsTo?.nip ?? null;
    case "NSM":
      return owner.reportsTo?.reportsTo?.reportsTo?.nip ?? null;
  }
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
  action: AuditAction
): Promise<PoaForm> {
  const poa = await loadPoaWithHierarchy(poaId);

  // Authorization is the caller's job (submitPoa/approvePoa/flagRevisionOnEdit
  // each use the right predicate — canEdit vs. the stricter canApprove).

  let nextHolderId: string | null = null;
  if (transition.nextHolderRole) {
    nextHolderId = await resolveNextHolder(poa, transition.nextHolderRole);
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
        snapshot: {},
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
 * TODO: add pre-submit validation of poa.data fields once form schema is defined.
 */
export async function submitPoa(
  poaId: string,
  actingUserId: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const actingUser = await prisma.user.findUniqueOrThrow({ where: { nip: actingUserId } });
  if (!(await canEdit(actingUser, poa))) {
    throw new Error(`User ${actingUserId} does not have edit rights on POA ${poaId}`);
  }

  const transition = SUBMIT_TRANSITIONS[poa.status];
  if (!transition) {
    throw new Error(
      `Cannot submit a POA in status ${poa.status}`
    );
  }

  return applyTransition(poaId, actingUserId, transition, poa.status, AuditAction.SUBMIT);
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
 * Called whenever a line item is added/edited/deleted. Whoever edits an
 * already-submitted POA still needs their own atasan's approval afterward —
 * exactly the same principle as a normal approve, just re-triggered by a change:
 *
 *   - The owning MR edits → needs ASM approval again from scratch, so status
 *     bounces all the way back to REVISI (holder cleared) and must be
 *     resubmitted (REVISI → SUBMITTED_TO_ASM).
 *   - An ASM edits while it's in their queue → still needs SM approval next,
 *     same as if they'd approved without editing. Status/holder are left
 *     untouched — they just save the change and click Approve & Teruskan as
 *     usual, which forwards it to SM.
 *   - Same for SM (→ needs NSM) and NSM (→ nothing above them).
 *
 * So only the owning MR's edit is a "real" revision reset here; an approver's
 * edit is a no-op on status, since the ordinary approve step already routes it
 * to their atasan. No-op either way while already DRAFT or REVISI.
 */
export async function flagRevisionOnEdit(
  poaId: string,
  actingUserId: string
): Promise<PoaForm | null> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  if (poa.status === PoaStatus.DRAFT || poa.status === PoaStatus.REVISI) return null;
  if (poa.ownerId !== actingUserId) return null;

  return applyTransition(
    poaId,
    actingUserId,
    { toStatus: PoaStatus.REVISI, nextHolderRole: null },
    poa.status,
    AuditAction.REVISE
  );
}

/**
 * Create a new POA draft for an MR.
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
