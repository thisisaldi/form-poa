"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { PoaStatus, AuditAction } from "@prisma/client";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) redirect("/dashboard?error=" + encodeURIComponent(WRITE_BLOCKED_MESSAGE));
  return session;
}

async function resolveHolderForRole(
  tx: any,
  mrUser: { nip: string; nipAtasan: string | null },
  targetRole: "ASM" | "SM" | "NSM"
): Promise<string | null> {
  let currentNip: string | null = mrUser.nipAtasan;
  while (currentNip) {
    const parent: { nip: string; role: string; nipAtasan: string | null; isActive: boolean } | null =
      await tx.user.findUnique({
        where: { nip: currentNip },
        select: { nip: true, role: true, nipAtasan: true, isActive: true },
      });
    if (!parent) break;
    if (parent.role === targetRole && parent.isActive) {
      return parent.nip;
    }
    currentNip = parent.nipAtasan;
  }

  const fallback = await tx.user.findFirst({
    where: { isActive: true, role: targetRole === "NSM" ? { in: ["NSM", "ADMIN"] } : targetRole },
    select: { nip: true },
  });
  return fallback?.nip || null;
}

export async function submitSalesCounterFormAction(
  poaScIds: string[],
  notes?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk diajukan." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true, nipAtasan: true },
    });

    if (!actor) return { ok: false, error: "User tidak ditemukan." };

    let nextHolderId: string | null = actor.nipAtasan;
    if (!nextHolderId) {
      const manager = await prisma.user.findFirst({
        where: {
          isActive: true,
          role: { in: ["ASM", "SM", "NSM"] },
        },
        select: { nip: true },
      });
      nextHolderId = manager?.nip || null;
    }

    await prisma.$transaction(async (tx: any) => {
      const forms = await tx.poaScForm.findMany({
        where: {
          id: { in: poaScIds },
          ownerId: session.userId,
          status: { in: [PoaStatus.DRAFT, PoaStatus.REVISI] },
        },
      });

      if (forms.length === 0) {
        throw new Error("Pengajuan DRAFT hanya dapat dilakukan oleh MR pemilik dokumen. Atasan (ASM/SM/NSM) tidak dapat mengajukan DRAFT milik bawahan.");
      }

      for (const form of forms) {
        let targetStatus: PoaStatus = PoaStatus.SUBMITTED_TO_ASM;
        let targetHolderId: string | null = nextHolderId;

        // Jika form dalam status REVISI, periksa siapa atasan terakhir yang meminta revisi / tolak / setujui edit
        if (form.status === PoaStatus.REVISI) {
          const lastRevLog = await tx.poaScAuditLog.findFirst({
            where: {
              poaScId: form.id,
              OR: [
                { action: AuditAction.REVISE },
                { action: AuditAction.REJECT },
                { action: AuditAction.GRANT_EDIT },
                { toStatus: PoaStatus.REVISI },
              ],
            },
            orderBy: { createdAt: "desc" },
            include: { actor: true },
          });

          if (lastRevLog) {
            const reviserRole = lastRevLog.actor?.role;
            const fromStatus = lastRevLog.fromStatus;

            if (
              reviserRole === "NSM" ||
              fromStatus === PoaStatus.SUBMITTED_TO_NSM ||
              fromStatus === PoaStatus.APPROVED_BY_SM
            ) {
              targetStatus = PoaStatus.SUBMITTED_TO_NSM;
              targetHolderId = (lastRevLog.actor?.role === "NSM" && lastRevLog.actor.isActive)
                ? lastRevLog.actorId
                : await resolveHolderForRole(tx, actor, "NSM");
            } else if (
              reviserRole === "SM" ||
              fromStatus === PoaStatus.SUBMITTED_TO_SM ||
              fromStatus === PoaStatus.APPROVED_BY_ASM
            ) {
              targetStatus = PoaStatus.SUBMITTED_TO_SM;
              targetHolderId = (lastRevLog.actor?.role === "SM" && lastRevLog.actor.isActive)
                ? lastRevLog.actorId
                : await resolveHolderForRole(tx, actor, "SM");
            } else {
              targetStatus = PoaStatus.SUBMITTED_TO_ASM;
              targetHolderId = (lastRevLog.actor?.role === "ASM" && lastRevLog.actor.isActive)
                ? lastRevLog.actorId
                : (nextHolderId || await resolveHolderForRole(tx, actor, "ASM"));
            }
          }
        }

        await tx.poaScForm.update({
          where: { id: form.id },
          data: {
            status: targetStatus,
            currentHolderId: targetHolderId,
          },
        });

        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.SUBMIT,
            fromStatus: form.status,
            toStatus: targetStatus,
            snapshot: { notes: notes || "" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to submit Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal mengajukan POA Sales Counter." };
  }
}

const POA_STATUS_RANK: Record<PoaStatus, number> = {
  DRAFT: 0,
  REVISI: 0,
  SUBMITTED_TO_ASM: 1,
  APPROVED_BY_ASM: 2,
  SUBMITTED_TO_SM: 2,
  APPROVED_BY_SM: 3,
  SUBMITTED_TO_NSM: 3,
  APPROVED_BY_NSM: 4,
  // ASD/SD (2026-09-09, docs/exodus-poa-usage/01-business-rules.md §11) —
  // per-doctor POA escalation levels, not used by POA-SC's own workflow
  // (unreachable here); present only so this Record stays exhaustive over
  // PoaStatus (TypeScript requirement).
  SUBMITTED_TO_ASD: 4,
  APPROVED_BY_ASD: 4,
  SUBMITTED_TO_SD: 4,
  APPROVED_BY_SD: 4,
};

function buildApprovalWhereClause(actorRole: string, actorNip: string, poaScIds: string[]) {
  const baseWhere: any = { id: { in: poaScIds } };

  if (actorRole === "NSM" || actorRole === "ADMIN") {
    baseWhere.status = {
      in: [
        PoaStatus.SUBMITTED_TO_ASM,
        PoaStatus.SUBMITTED_TO_SM,
        PoaStatus.SUBMITTED_TO_NSM,
      ],
    };
  } else if (actorRole === "SM") {
    baseWhere.status = {
      in: [
        PoaStatus.SUBMITTED_TO_ASM,
        PoaStatus.SUBMITTED_TO_SM,
      ],
    };
  } else if (actorRole === "ASM") {
    baseWhere.status = PoaStatus.SUBMITTED_TO_ASM;
  } else {
    baseWhere.status = {
      in: [
        PoaStatus.SUBMITTED_TO_ASM,
        PoaStatus.SUBMITTED_TO_SM,
        PoaStatus.SUBMITTED_TO_NSM,
      ],
    };
  }

  return baseWhere;
}

export async function approveSalesCounterFormAction(
  poaScIds: string[],
  notes?: string
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk disetujui." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true, nipAtasan: true },
    });

    if (!actor) return { ok: false, error: "User tidak ditemukan." };

    let totalApproved = 0;

    await prisma.$transaction(async (tx: any) => {
      const whereClause = buildApprovalWhereClause(actor.role, session.userId, poaScIds);
      const forms = await tx.poaScForm.findMany({ where: whereClause });

      if (forms.length === 0) {
        throw new Error("Tidak ada POA Sales Counter yang dapat Anda setujui.");
      }

      for (const form of forms) {
        let nextStatus: PoaStatus = PoaStatus.APPROVED_BY_NSM;
        let nextHolderId: string | null = null;

        if (actor.role === "ASM") {
          let smNip = actor.nipAtasan;
          if (!smNip) {
            const sm = await tx.user.findFirst({
              where: { isActive: true, role: { in: ["SM", "NSM"] } },
              select: { nip: true },
            });
            smNip = sm?.nip || null;
          }
          nextStatus = smNip ? PoaStatus.SUBMITTED_TO_SM : PoaStatus.APPROVED_BY_ASM;
          nextHolderId = smNip;
        } else if (actor.role === "SM") {
          let nsmNip = actor.nipAtasan;
          if (!nsmNip) {
            const nsm = await tx.user.findFirst({
              where: { isActive: true, role: { in: ["NSM", "ADMIN"] } },
              select: { nip: true },
            });
            nsmNip = nsm?.nip || null;
          }
          nextStatus = nsmNip ? PoaStatus.SUBMITTED_TO_NSM : PoaStatus.APPROVED_BY_SM;
          nextHolderId = nsmNip;
        } else {
          nextStatus = PoaStatus.APPROVED_BY_NSM;
          nextHolderId = null;
        }

        // STRICT MONOTONIC CHECK:
        // 1. Next status rank must be strictly higher than current status rank (no status downgrade)
        if (POA_STATUS_RANK[nextStatus] <= POA_STATUS_RANK[form.status as PoaStatus]) {
          continue;
        }

        // 2. Invariant guard: Never approve forms in DRAFT, REVISI, or already APPROVED_BY_NSM
        if (
          form.status === PoaStatus.DRAFT ||
          form.status === PoaStatus.REVISI ||
          form.status === PoaStatus.APPROVED_BY_NSM
        ) {
          continue;
        }

        await tx.poaScForm.update({
          where: { id: form.id },
          data: {
            status: nextStatus,
            currentHolderId: nextHolderId,
          },
        });

        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.APPROVE,
            fromStatus: form.status,
            toStatus: nextStatus,
            snapshot: { notes: notes || "" },
          },
        });

        totalApproved++;
      }

      if (totalApproved === 0) {
        throw new Error("Tidak ada outlet yang valid untuk disetujui pada tingkat wewenang Anda.");
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true, count: totalApproved };
  } catch (error: any) {
    console.error("Failed to approve Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menyetujui POA Sales Counter." };
  }
}

export async function reviseSalesCounterFormAction(
  poaScIds: string[],
  notes?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk minta revisi." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true },
    });

    await prisma.$transaction(async (tx: any) => {
      const whereClause = buildApprovalWhereClause(actor?.role || "MR", session.userId, poaScIds);
      const forms = await tx.poaScForm.findMany({ where: whereClause });

      if (forms.length === 0) {
        throw new Error("Tidak ada POA Sales Counter yang dapat Anda minta revisi.");
      }

      for (const form of forms) {
        await tx.poaScForm.update({
          where: { id: form.id },
          data: {
            status: PoaStatus.REVISI,
            currentHolderId: null,
            version: form.version + 1,
          },
        });

        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.REVISE,
            fromStatus: form.status,
            toStatus: PoaStatus.REVISI,
            snapshot: { notes: notes || "" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to revise Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal meminta revisi POA Sales Counter." };
  }
}

export async function rejectSalesCounterFormAction(
  poaScIds: string[],
  notes?: string,
  category?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk ditolak." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true },
    });

    await prisma.$transaction(async (tx: any) => {
      const whereClause = buildApprovalWhereClause(actor?.role || "MR", session.userId, poaScIds);
      const forms = await tx.poaScForm.findMany({ where: whereClause });

      if (forms.length === 0) {
        throw new Error("Tidak ada POA Sales Counter yang dapat Anda tolak.");
      }

      for (const form of forms) {
        await tx.poaScForm.update({
          where: { id: form.id },
          data: {
            status: PoaStatus.REVISI,
            currentHolderId: null,
            version: form.version + 1,
          },
        });

        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.REJECT,
            fromStatus: form.status,
            toStatus: PoaStatus.REVISI,
            snapshot: { notes: notes || "", category: category || "" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to reject Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menolak POA Sales Counter." };
  }
}

export async function requestEditSalesCounterFormAction(
  poaScIds: string[],
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk diajukan revisi." };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      const APPROVED_STATUSES = [
        PoaStatus.APPROVED_BY_ASM,
        PoaStatus.SUBMITTED_TO_SM,
        PoaStatus.APPROVED_BY_SM,
        PoaStatus.SUBMITTED_TO_NSM,
        PoaStatus.APPROVED_BY_NSM,
      ];

      const forms = await tx.poaScForm.findMany({
        where: {
          id: { in: poaScIds },
          ownerId: session.userId,
          status: { in: APPROVED_STATUSES },
        },
      });

      if (forms.length === 0) {
        throw new Error("Pengajuan edit hanya dapat dilakukan apabila dokumen sudah disetujui (minimal oleh ASM).");
      }

      for (const form of forms) {
        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.REQUEST_EDIT,
            fromStatus: form.status,
            toStatus: form.status,
            snapshot: { notes: reason || "" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to request edit for Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal mengajukan permohonan edit." };
  }
}

export async function grantEditSalesCounterFormAction(
  poaScIds: string[],
  notes?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk disetujui izin editnya." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true },
    });

    if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
      return { ok: false, error: "Hanya Atasan (ASM/SM/NSM/ADMIN) yang dapat menyetujui izin edit." };
    }

    await prisma.$transaction(async (tx: any) => {
      const forms = await tx.poaScForm.findMany({
        where: { id: { in: poaScIds } },
      });

      if (forms.length === 0) {
        throw new Error("Dokumen Sales Counter tidak ditemukan.");
      }

      for (const form of forms) {
        await tx.poaScForm.update({
          where: { id: form.id },
          data: {
            status: PoaStatus.REVISI,
            currentHolderId: null,
            version: form.version + 1,
          },
        });

        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.GRANT_EDIT,
            fromStatus: form.status,
            toStatus: PoaStatus.REVISI,
            snapshot: { notes: notes || "Menyetujui permohonan edit dari pemilik POA" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to grant edit request for Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menyetujui izin edit." };
  }
}

export async function declineEditSalesCounterFormAction(
  poaScIds: string[],
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  if (!poaScIds || poaScIds.length === 0) {
    return { ok: false, error: "Pilih minimal 1 Sales Counter POA untuk ditolak izin editnya." };
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { nip: session.userId },
      select: { nip: true, role: true },
    });

    if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
      return { ok: false, error: "Hanya Atasan (ASM/SM/NSM/ADMIN) yang dapat menolak izin edit." };
    }

    await prisma.$transaction(async (tx: any) => {
      const forms = await tx.poaScForm.findMany({
        where: { id: { in: poaScIds } },
      });

      if (forms.length === 0) {
        throw new Error("Dokumen Sales Counter tidak ditemukan.");
      }

      for (const form of forms) {
        await tx.poaScAuditLog.create({
          data: {
            poaScId: form.id,
            actorId: session.userId,
            action: AuditAction.DECLINE_EDIT,
            fromStatus: form.status,
            toStatus: form.status,
            snapshot: { notes: reason || "Menolak permohonan edit" },
          },
        });
      }
    });

    revalidatePath("/sc/dashboard");
    revalidatePath("/sc/approvals");
    return { ok: true };
  } catch (error: any) {
    console.error("Failed to decline edit request for Sales Counter POA:", error);
    return { ok: false, error: error?.message || "Gagal menolak izin edit." };
  }
}
