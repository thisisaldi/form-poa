"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  createPoaDraft,
  submitDoctor, approveDoctor, rejectDoctor, fastTrackApproveDoctor, cancelApprovedByNsmDoctor, requestEditDoctor, grantEditRequestDoctor, declineEditRequestDoctor,
  resolvePoaRollup,
} from "@/lib/poaWorkflow";
import { prisma } from "@/lib/prisma";
import {
  canEdit, canCreatePoa,
  canApproveDoctor, canFastTrackApproveDoctor, canCancelApprovedDoctor, canRequestEditDoctor, canRespondEditRequestDoctor,
} from "@/lib/authz";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { PoaRejectCategory } from "@prisma/client";

// Every export in this file is a mutation, so the write-block check lives
// right here — single choke point instead of repeating it per action.
async function requireSession() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) redirect("/dashboard?error=" + encodeURIComponent(WRITE_BLOCKED_MESSAGE));
  return session;
}

export async function createPoaAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const period = (formData.get("period") as string | null)?.trim() ?? "";

  if (!period) redirect("/poa/new?error=" + encodeURIComponent("Period wajib diisi."));
  // No hardcoded role check here — canCreatePoa() is the single source of truth.
  // Normally only MR (leaf, has outlet assignments), but an ASM/SM/NSM whose own
  // team is vacant can create one too (see canCreatePoa's doc comment).
  if (!(await canCreatePoa(session.userId))) redirect("/dashboard?error=no_outlets");

  // Prevent duplicate drafts for the same quarter period
  const existing = await prisma.poaForm.findFirst({
    where: { ownerId: session.userId, period },
  });
  if (existing) {
    redirect(`/poa/${existing.id}/edit?notice=` + encodeURIComponent(`Draft ${period} sudah ada. Lanjutkan di sini.`));
  }

  const poa = await createPoaDraft(session.userId, period);
  redirect(`/poa/${poa.id}/edit`);
}

// MR submits ONE doctor within the draft (docs/poa-per-doctor-approval/,
// OQ-2) instead of the whole draft at once — the rest of the draft stays
// in DRAFT/REVISI untouched. Thin wrapper around submitDoctor, same
// canEdit gate as the whole-draft submit actions above.
export async function submitDoctorAction(
  poaId: string,
  kodePI: string,
  namaCust: string,
  notes?: string,
): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canEdit(actor, poa))) redirect(`/poa/${poaId}`);

  await submitDoctor(poaId, kodePI, namaCust, session.userId, notes?.trim() || undefined);
  revalidatePath(`/poa/${poaId}`);
}

// ─── Per-doctor approval actions (docs/poa-per-doctor-approval/) ──────────────
// approve/reject/fast-track/cancel/request-edit all target ONE doctor
// (kodePI + namaCust, same doctorKey used by DraftChecklist.tsx) within the
// draft — the whole-draft versions these were generalized from (approvePoaAction,
// rejectPoaAction, fastTrackApproveAction, cancelApprovedByNsmAction,
// requestEditAction, grantEditRequestAction, declineEditRequestAction,
// bulkApprovePoaAction, submitPoaAction) were removed entirely 2026-08-18 —
// every caller had already migrated, and there is no by-draft path left.

export async function approveDoctorAction(poaId: string, kodePI: string, namaCust: string): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa || !doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canApproveDoctor(actor, doctor))) redirect(`/poa/${poaId}`);

  await approveDoctor(poaId, kodePI, namaCust, session.userId);
  revalidatePath(`/poa/${poaId}`);
}

export async function fastTrackApproveDoctorAction(poaId: string, kodePI: string, namaCust: string): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa || !doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canFastTrackApproveDoctor(actor, poa, doctor))) redirect(`/poa/${poaId}`);

  await fastTrackApproveDoctor(poaId, kodePI, namaCust, session.userId);
  revalidatePath(`/poa/${poaId}`);
}

export async function rejectDoctorAction(poaId: string, kodePI: string, namaCust: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa || !doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canApproveDoctor(actor, doctor))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan reject wajib diisi."));

  // docs/poa-rejection-categories/ (2026-08-13) — single-select, required.
  // Validated against the enum whitelist here (not just trusted from the
  // client) — a forged/invalid value gets rejected, never silently stored.
  const categoryRaw = (formData.get("rejectCategory") as string | null) ?? "";
  if (!(Object.values(PoaRejectCategory) as string[]).includes(categoryRaw)) {
    redirect(`/poa/${poaId}?error=` + encodeURIComponent("Kategori reject wajib dipilih."));
  }

  await rejectDoctor(poaId, kodePI, namaCust, session.userId, reason, categoryRaw as PoaRejectCategory);
  redirect(`/poa/${poaId}`);
}

export async function cancelApprovedByNsmDoctorAction(poaId: string, kodePI: string, namaCust: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa || !doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canCancelApprovedDoctor(actor, poa, doctor))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan pembatalan wajib diisi."));

  await cancelApprovedByNsmDoctor(poaId, kodePI, namaCust, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

export async function requestEditDoctorAction(poaId: string, kodePI: string, namaCust: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRequestEditDoctor(actor, poa, doctor))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() || undefined;
  await requestEditDoctor(poaId, kodePI, namaCust, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

export async function grantEditRequestDoctorAction(poaId: string, kodePI: string, namaCust: string): Promise<void> {
  const session = await requireSession();

  const doctor = await prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } });
  if (!doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRespondEditRequestDoctor(actor, doctor))) redirect(`/poa/${poaId}`);

  await grantEditRequestDoctor(poaId, kodePI, namaCust, session.userId);
  redirect(`/poa/${poaId}`);
}

export async function declineEditRequestDoctorAction(poaId: string, kodePI: string, namaCust: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const doctor = await prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } });
  if (!doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRespondEditRequestDoctor(actor, doctor))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan menolak permintaan edit wajib diisi."));

  await declineEditRequestDoctor(poaId, kodePI, namaCust, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

// Owner MR can delete their own POA regardless of status/approval progress
// (2026-09-11 decision) — deliberately NOT gated by canEdit, since canEdit's
// Lock Edit Logic blocks the owner once anyone above them has approved; that
// lock is about editing content, not about the owner's ability to withdraw
// the whole POA. Ownership check is a direct poa.ownerId === actor.nip
// comparison for that reason (ADMIN also allowed, same as everywhere else).
export async function deletePoaAction(poaId: string): Promise<{ error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) return { error: WRITE_BLOCKED_MESSAGE };

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) return { error: "POA tidak ditemukan." };

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (poa.ownerId !== actor.nip && actor.role !== "ADMIN") return { error: "Tidak punya akses." };

  await prisma.$transaction([
    prisma.poaAuditLog.deleteMany({ where: { poaId } }),
    prisma.poaForm.delete({ where: { id: poaId } }),
  ]);

  revalidatePath("/dashboard");
  return {};
}

// Per-doctor delete (2026-09-11 request) — owner needed a way to remove ONE
// doctor from a POA without wiping every other doctor in it, which is what
// deletePoaAction above does (whole PoaForm, cascades every line item).
// Same ownership rule/reasoning as deletePoaAction: not gated by canEdit,
// works regardless of the doctor's own approval progress. If this was the
// LAST doctor in the POA, the now-empty PoaForm is deleted too (2026-09-11
// decision — an empty draft left behind would just be dashboard clutter).
export async function deleteDoctorAction(poaId: string, kodePI: string, namaCust: string): Promise<{ error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) return { error: WRITE_BLOCKED_MESSAGE };

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) return { error: "POA tidak ditemukan." };

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (poa.ownerId !== actor.nip && actor.role !== "ADMIN") return { error: "Tidak punya akses." };

  const approval = await prisma.poaDoctorApproval.findUnique({
    where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } },
  });

  await prisma.$transaction([
    ...(approval
      ? [
          prisma.poaAuditLog.deleteMany({ where: { doctorApprovalId: approval.id } }),
          prisma.poaDoctorApproval.delete({ where: { id: approval.id } }),
        ]
      : []),
    prisma.poaLineItem.deleteMany({ where: { poaId, kodePI, namaCust } }),
  ]);

  const remaining = await prisma.poaLineItem.count({ where: { poaId } });
  if (remaining === 0) {
    await prisma.$transaction([
      prisma.poaAuditLog.deleteMany({ where: { poaId } }),
      prisma.poaForm.delete({ where: { id: poaId } }),
    ]);
    revalidatePath("/dashboard");
    return {};
  }

  // Doctor set changed — PoaForm.status/currentHolderId (rollup over
  // PoaDoctorApproval rows) may need to shift to a different representative.
  await resolvePoaRollup(poaId);

  revalidatePath(`/poa/${poaId}`);
  revalidatePath("/dashboard");
  return {};
}

// Edit Quarter (2026-08-03, stakeholder item #10) — lets the owner change
// which quarter a draft belongs to after creation, instead of that only ever
// being fixed once at /poa/new. Restricted to DRAFT/REVISI (same as delete
// above) — once a POA has been submitted/approved at least once this cycle,
// its period is treated as locked, same spirit as the Lock Edit Logic gate
// in authz.ts (canEdit), just stricter: any submission history this cycle
// blocks it, not just an approval above the actor's own level. Deliberately
// does NOT touch any PoaLineItem.periodeAwal — those stay exactly as entered
// even if they now fall outside the new period's quarter months; re-aligning
// them is left to the MR, same as any other manual edit.
export async function updatePoaPeriodAction(poaId: string, newPeriod: string): Promise<{ error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) return { error: WRITE_BLOCKED_MESSAGE };

  const period = newPeriod.trim();
  if (!/^\d{4}-Q[1-4]$/.test(period)) return { error: "Format periode tidak valid." };

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) return { error: "POA tidak ditemukan." };

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canEdit(actor, poa))) return { error: "Tidak punya akses." };
  if (poa.status !== "DRAFT" && poa.status !== "REVISI") {
    return { error: "Periode hanya bisa diubah selama status Draft/Revisi." };
  }
  if (period === poa.period) return {};

  const duplicate = await prisma.poaForm.findFirst({
    where: { ownerId: poa.ownerId, period, id: { not: poaId } },
  });
  if (duplicate) return { error: `Draft ${period} untuk pemilik ini sudah ada.` };

  await prisma.poaForm.update({ where: { id: poaId }, data: { period } });

  revalidatePath(`/poa/${poaId}`);
  revalidatePath(`/poa/${poaId}/edit`);

  return {};
}

// ─── Temporary Stubs for Sales Counter (Draft-Wide / Doctor Stubs) ───────────

export async function requestEditAction(poaId: string, formData: FormData): Promise<void> {}
export async function grantEditRequestAction(poaId: string): Promise<void> {}
export async function declineEditRequestAction(poaId: string, formData: FormData): Promise<void> {}
