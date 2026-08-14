"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  createPoaDraft, approvePoa, rejectPoa, fastTrackApprove, cancelApprovedByNsm, requestEdit, grantEditRequest, declineEditRequest,
  submitAllDoctorsInDraft, approveDoctor, rejectDoctor, fastTrackApproveDoctor, cancelApprovedByNsmDoctor, requestEditDoctor, grantEditRequestDoctor, declineEditRequestDoctor,
} from "@/lib/poaWorkflow";
import { prisma } from "@/lib/prisma";
import {
  canEdit, canApprove, canCreatePoa, canFastTrackApprove, canCancelApproved, canRequestEdit, canRespondEditRequest,
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

export async function submitPoaAction(poaId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canEdit(actor, poa))) redirect(`/poa/${poaId}`);

  const notes = (formData.get("notes") as string | null)?.trim() || undefined;
  // Per-doctor submit (docs/poa-per-doctor-approval/, OQ-2) — one click still
  // submits every eligible doctor in the draft, but each gets its own
  // PoaDoctorApproval row so ASM/SM/NSM can approve/reject them independently
  // afterward. See submitAllDoctorsInDraft's doc comment in poaWorkflow.ts.
  await submitAllDoctorsInDraft(poaId, session.userId, notes);
  redirect(`/poa/${poaId}`);
}

// Called from DraftChecklist client component — submits only checked items.
export async function submitPoaWithSelectionAction(
  poaId: string,
  keepItemIds: string[],
  notes?: string,
): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canEdit(actor, poa))) redirect(`/poa/${poaId}`);

  if (keepItemIds.length > 0) {
    await prisma.poaLineItem.deleteMany({
      where: { poaId, id: { notIn: keepItemIds } },
    });
  }

  await submitAllDoctorsInDraft(poaId, session.userId, notes?.trim() || undefined);
  redirect(`/poa/${poaId}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function approvePoaAction(poaId: string, _formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!canApprove(actor, poa)) redirect(`/poa/${poaId}`);

  await approvePoa(poaId, session.userId);
  redirect(`/poa/${poaId}`);
}

// NSM-only override — approve straight to fully-approved, skipping ASM/SM
// review. See canFastTrackApprove/fastTrackApprove for the authorization
// rule and exact behavior.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fastTrackApproveAction(poaId: string, _formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canFastTrackApprove(actor, poa))) redirect(`/poa/${poaId}`);

  await fastTrackApprove(poaId, session.userId);
  redirect(`/poa/${poaId}`);
}

// Bulk approval for SM/NSM — approves each selected POA the same way approvePoaAction
// does, one at a time (each has its own next-holder resolution and audit row), and
// reports back which ones failed instead of throwing on the first bad one so a single
// stale/already-moved POA doesn't block approving the rest of the batch.
//
// DISABLED via the flag below (docs/TODO.md — daftar 13 task 2026-08-10, item #11
// "Fitur Bulk Approval (dimatikan)"). Logic kept intact, easy to re-enable by
// flipping the flag — see ApprovalsChecklist.tsx for the matching UI-side gate.
const BULK_APPROVE_ENABLED = false;

export async function bulkApprovePoaAction(
  poaIds: string[]
): Promise<{ approved: number; failed: { poaId: string; error: string }[] }> {
  const session = await requireSession();
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  if (!BULK_APPROVE_ENABLED) {
    throw new Error("Bulk approval sedang dimatikan.");
  }

  if (!(["SM", "NSM"] as string[]).includes(actor.role)) {
    throw new Error("Bulk approval hanya tersedia untuk SM dan NSM.");
  }

  let approved = 0;
  const failed: { poaId: string; error: string }[] = [];

  for (const poaId of poaIds) {
    try {
      const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
      if (!poa) throw new Error("POA tidak ditemukan.");
      if (!canApprove(actor, poa)) throw new Error("Tidak berwenang menyetujui POA ini.");
      await approvePoa(poaId, session.userId);
      approved++;
    } catch (err) {
      failed.push({ poaId, error: err instanceof Error ? err.message : "Gagal menyetujui." });
    }
  }

  revalidatePath("/approvals");
  return { approved, failed };
}

export async function rejectPoaAction(poaId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!canApprove(actor, poa)) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan reject wajib diisi."));

  await rejectPoa(poaId, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

// NSM-only — undo their own already-completed approval, sending the POA back
// to REVISI. See canCancelApproved/cancelApprovedByNsm for the authorization
// rule and exact behavior.
export async function cancelApprovedByNsmAction(poaId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canCancelApproved(actor, poa))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan pembatalan wajib diisi."));

  await cancelApprovedByNsm(poaId, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

// Owner asks the last approver to unlock editing — see canRequestEdit/requestEdit.
export async function requestEditAction(poaId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRequestEdit(actor, poa))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() || undefined;
  await requestEdit(poaId, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

// Last approver grants the owner's pending edit request — see
// canRespondEditRequest/grantEditRequest.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function grantEditRequestAction(poaId: string, _formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRespondEditRequest(actor, poa))) redirect(`/poa/${poaId}`);

  await grantEditRequest(poaId, session.userId);
  redirect(`/poa/${poaId}`);
}

// Last approver declines the owner's pending edit request — see
// canRespondEditRequest/declineEditRequest.
export async function declineEditRequestAction(poaId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canRespondEditRequest(actor, poa))) redirect(`/poa/${poaId}`);

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Alasan menolak permintaan edit wajib diisi."));

  await declineEditRequest(poaId, session.userId, reason);
  redirect(`/poa/${poaId}`);
}

// ─── Per-doctor approval actions (docs/poa-per-doctor-approval/) ──────────────
// Doctor-scoped twins of the whole-draft actions above — approve/reject/etc.
// target ONE doctor (kodePI + namaCust, same doctorKey used by
// DraftChecklist.tsx) within the draft instead of the entire draft. The
// whole-draft actions above are kept for any caller not yet migrated.

export async function approveDoctorAction(poaId: string, kodePI: string, namaCust: string): Promise<void> {
  const session = await requireSession();

  const [poa, doctor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI, namaCust } } }),
  ]);
  if (!poa || !doctor) redirect(`/poa/${poaId}`);

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!canApproveDoctor(actor, doctor)) redirect(`/poa/${poaId}`);

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
  if (!canApproveDoctor(actor, doctor)) redirect(`/poa/${poaId}`);

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

// Only DRAFT POAs — once submitted, deleting it would destroy approval/audit history.
// Restricted to the owning MR (same check submit/edit use), not just "someone who can view it".
export async function deletePoaAction(poaId: string): Promise<{ error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) return { error: WRITE_BLOCKED_MESSAGE };

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) return { error: "POA tidak ditemukan." };

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!(await canEdit(actor, poa))) return { error: "Tidak punya akses." };
  if (poa.status !== "DRAFT") return { error: "Hanya POA berstatus Draft yang bisa dihapus." };

  await prisma.$transaction([
    prisma.poaAuditLog.deleteMany({ where: { poaId } }),
    prisma.poaForm.delete({ where: { id: poaId } }),
  ]);

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
