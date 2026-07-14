"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { createPoaDraft, submitPoa, approvePoa } from "@/lib/poaWorkflow";
import { prisma } from "@/lib/prisma";
import { canEdit, canCreatePoa } from "@/lib/authz";

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
  if (session.role !== "MR") redirect("/dashboard");
  if (!(await canCreatePoa(session.userId))) redirect("/dashboard?error=no_outlets");

  const poa = await createPoaDraft(session.userId, period);
  redirect(`/poa/${poa.id}/edit`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function submitPoaAction(poaId: string, _formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!canEdit(actor, poa)) redirect(`/poa/${poaId}`);

  await submitPoa(poaId, session.userId);
  redirect(`/poa/${poaId}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function approvePoaAction(poaId: string, _formData: FormData): Promise<void> {
  const session = await requireSession();

  const poa = await prisma.poaForm.findUnique({ where: { id: poaId } });
  if (!poa) redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  if (!canEdit(actor, poa)) redirect(`/poa/${poaId}`);

  await approvePoa(poaId, session.userId);
  redirect(`/poa/${poaId}`);
}
