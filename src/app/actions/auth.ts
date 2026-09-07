"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyNip, createSession, destroySession } from "@/lib/auth";
import { STAGING_HOST, STAGING_REDIRECT_EXEMPT_NIPS } from "@/lib/stagingAccess";

// Real NIP accounts logging into staging get bounced to production instead —
// staging is meant for ADMIN/dummy test accounts only (2026-08-21 request),
// except STAGING_REDIRECT_EXEMPT_NIPS (2026-09-07 — same exempt set
// middleware.ts's page-navigation redirect uses, must stay in sync or an
// exempt nip passes this gate and gets caught by the other one).
// Host-based (not NODE_ENV/env var) since staging and production run the
// same build/env, differing only by domain — see STAGING_HOST in middleware.ts.
const PRODUCTION_APPROVALS_URL = "https://form-poa.chc.pharmalink.id/approvals";

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

  const host = (await headers()).get("host");
  const isRealAccount = !result.user.isDummy && result.user.role !== "ADMIN";
  if (host === STAGING_HOST && isRealAccount && !STAGING_REDIRECT_EXEMPT_NIPS.has(result.user.nip)) {
    redirect(PRODUCTION_APPROVALS_URL);
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
