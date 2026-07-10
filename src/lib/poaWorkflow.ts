/**
 * POA Workflow Service — the ONLY place where PoaForm.status is mutated.
 *
 * All state transitions go through here. Never update status inline elsewhere.
 * Structured so REJECTED / revision-request states can be added without major refactor:
 * just extend TRANSITIONS and add a new exported function.
 */

import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
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
  [PoaStatus.APPROVED_BY_ASM]: { toStatus: PoaStatus.SUBMITTED_TO_SM, nextHolderRole: "SM" },
  [PoaStatus.APPROVED_BY_SM]: { toStatus: PoaStatus.SUBMITTED_TO_NSM, nextHolderRole: "NSM" },
  // These statuses are not valid submit sources
  [PoaStatus.SUBMITTED_TO_ASM]: null,
  [PoaStatus.SUBMITTED_TO_SM]: null,
  [PoaStatus.SUBMITTED_TO_NSM]: null,
  [PoaStatus.APPROVED_BY_NSM]: null,
};

const APPROVE_TRANSITIONS: Record<PoaStatus, TransitionTarget | null> = {
  [PoaStatus.SUBMITTED_TO_ASM]: { toStatus: PoaStatus.APPROVED_BY_ASM, nextHolderRole: null },
  [PoaStatus.SUBMITTED_TO_SM]: { toStatus: PoaStatus.APPROVED_BY_SM, nextHolderRole: null },
  [PoaStatus.SUBMITTED_TO_NSM]: { toStatus: PoaStatus.APPROVED_BY_NSM, nextHolderRole: null },
  // Invalid approve sources
  [PoaStatus.DRAFT]: null,
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

  const actingUser = await prisma.user.findUniqueOrThrow({
    where: { nip: actingUserId },
  });

  if (!canEdit(actingUser, poa)) {
    throw new Error(
      `User ${actingUserId} does not have edit rights on POA ${poaId}`
    );
  }

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

  const transition = SUBMIT_TRANSITIONS[poa.status];
  if (!transition) {
    throw new Error(
      `Cannot submit a POA in status ${poa.status}`
    );
  }

  return applyTransition(poaId, actingUserId, transition, poa.status, AuditAction.SUBMIT);
}

/**
 * ASM/SM/NSM approves a submitted POA at their level.
 */
export async function approvePoa(
  poaId: string,
  actingUserId: string
): Promise<PoaForm> {
  const poa = await prisma.poaForm.findUniqueOrThrow({ where: { id: poaId } }) as PoaForm;

  const transition = APPROVE_TRANSITIONS[poa.status];
  if (!transition) {
    throw new Error(
      `Cannot approve a POA in status ${poa.status}`
    );
  }

  return applyTransition(poaId, actingUserId, transition, poa.status, AuditAction.APPROVE);
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
