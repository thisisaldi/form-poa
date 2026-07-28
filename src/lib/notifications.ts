/**
 * Notification service — thin abstraction over the email provider.
 *
 * The actual provider (Resend, Nodemailer, etc.) is swapped in here.
 * Currently logs to console; replace the `sendEmail` implementation to go live.
 *
 * TODO: Replace mock sendEmail with a real provider integration.
 *   Option A — Resend: import { Resend } from "resend"; const resend = new Resend(env.RESEND_API_KEY);
 *   Option B — Nodemailer: configure an SMTP transport here.
 */

import { prisma } from "@/lib/prisma";
import { AuditAction, PoaStatus } from "@prisma/client";
import type { PoaForm } from "@prisma/client";

// ─── Provider Interface ───────────────────────────────────────────────────────

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  // TODO: Replace with real provider. e.g.:
  //   await resend.emails.send({ from: env.EMAIL_FROM, ...payload });
  console.log("[notifications][mock] Email would be sent:", {
    to: payload.to,
    subject: payload.subject,
  });
}

// ─── Status → Human Label ────────────────────────────────────────────────────

const STATUS_LABELS: Record<PoaStatus, string> = {
  [PoaStatus.DRAFT]: "Draft",
  [PoaStatus.SUBMITTED_TO_ASM]: "Submitted to ASM",
  [PoaStatus.APPROVED_BY_ASM]: "Approved by ASM",
  [PoaStatus.SUBMITTED_TO_SM]: "Submitted to SM",
  [PoaStatus.APPROVED_BY_SM]: "Approved by SM",
  [PoaStatus.SUBMITTED_TO_NSM]: "Submitted to NSM",
  [PoaStatus.APPROVED_BY_NSM]: "Approved by NSM",
  [PoaStatus.REVISI]: "Revisi — needs resubmission",
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send status-change email after every POA workflow transition.
 * Called fire-and-forget from poaWorkflow.ts — errors are logged, not thrown.
 */
export async function sendPoaStatusEmail(
  poa: PoaForm,
  action: AuditAction,
  nextHolderId: string | null
): Promise<void> {
  const owner = await prisma.user.findUnique({ where: { nip: poa.ownerId } });
  const statusLabel = STATUS_LABELS[poa.status];

  // Notify the MR of status change (if they have an email)
  if (owner?.email) {
    await sendEmail({
      to: owner.email,
      subject: `POA ${poa.period} — Status updated: ${statusLabel}`,
      html: `<p>Hi ${owner.name},</p><p>Your POA for period <strong>${poa.period}</strong> has been updated to: <strong>${statusLabel}</strong>.</p>`,
    });
  }

  // Notify the next holder
  if (nextHolderId) {
    const nextHolder = await prisma.user.findUnique({ where: { nip: nextHolderId } });
    if (nextHolder?.email) {
      await sendEmail({
        to: nextHolder.email,
        subject: `Action required: POA ${poa.period} awaiting your review`,
        html: `<p>Hi ${nextHolder.name},</p><p>A POA for period <strong>${poa.period}</strong> has been ${action === AuditAction.SUBMIT ? "submitted" : "approved"} and is now awaiting your action.</p>`,
      });
    }
  }
}

/**
 * Notify the last approver that the POA owner is asking to unlock editing —
 * fire-and-forget from poaWorkflow.ts's requestEdit, errors logged not thrown.
 */
export async function sendEditRequestEmail(poa: PoaForm, lastApproverId: string): Promise<void> {
  const [owner, lastApprover] = await Promise.all([
    prisma.user.findUnique({ where: { nip: poa.ownerId } }),
    prisma.user.findUnique({ where: { nip: lastApproverId } }),
  ]);
  if (!lastApprover?.email) return;

  await sendEmail({
    to: lastApprover.email,
    subject: `Permintaan edit: POA ${poa.period} dari ${owner?.name ?? poa.ownerId}`,
    html: `<p>Hi ${lastApprover.name},</p><p>${owner?.name ?? poa.ownerId} meminta izin untuk mengedit POA periode <strong>${poa.period}</strong> yang sudah Anda setujui. Buka POA ini untuk menyetujui atau menolak permintaan tersebut.</p>`,
  });
}
