"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { createPoaDraft, submitPoa, approvePoa, rejectPoa, fastTrackApprove, cancelApprovedByNsm, requestEdit, grantEditRequest, declineEditRequest } from "@/lib/poaWorkflow";
import { prisma } from "@/lib/prisma";
import { canEdit, canApprove, canCreatePoa, canFastTrackApprove, canCancelApproved, canRequestEdit, canRespondEditRequest } from "@/lib/authz";

function requireSession() {
  return getCurrentUser().then((session) => {
    if (!session) redirect("/login");
    return session;
  });
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
  await submitPoa(poaId, session.userId, notes);
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

  await submitPoa(poaId, session.userId, notes?.trim() || undefined);
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
export async function bulkApprovePoaAction(
  poaIds: string[]
): Promise<{ approved: number; failed: { poaId: string; error: string }[] }> {
  const session = await requireSession();
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

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

// Only DRAFT POAs — once submitted, deleting it would destroy approval/audit history.
// Restricted to the owning MR (same check submit/edit use), not just "someone who can view it".
export async function deletePoaAction(poaId: string): Promise<{ error?: string }> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

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
