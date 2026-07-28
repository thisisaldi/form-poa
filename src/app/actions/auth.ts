"use server";

import { redirect } from "next/navigation";
import { verifyNip, createSession, destroySession } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<void> {
  const nip = (formData.get("nip") as string | null)?.trim() ?? "";

  const encodeError = (msg: string) =>
    redirect(`/login?error=${encodeURIComponent(msg)}`);

  if (!nip) return encodeError("Masukkan NIP Anda.");

  const result = await verifyNip(nip);

  if (!result.ok) {
    if (result.error === "not_found")
      return encodeError("NIP tidak ditemukan. Hubungi administrator.");
    if (result.error === "inactive")
      return encodeError("Akun tidak aktif. Hubungi administrator.");
    return encodeError("Terjadi kesalahan. Coba lagi.");
  }

  await createSession(result.user);
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
