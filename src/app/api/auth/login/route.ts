/**
 * POST /api/auth/login
 * Body: { "nip": "P250447" }
 *
 * JSON login for callers outside the app (e.g. Postman) — the in-app login
 * page uses loginAction (a Server Action posting to /login, which redirects
 * instead of returning JSON), not directly callable as a plain HTTP request.
 * Same identity check (verifyNip) and session (createSession) as that flow;
 * on success the Set-Cookie header carries the same `poa_session` cookie
 * every other API route in this app reads via getCurrentUser().
 *
 * Pair with POST /api/auth/logout to clear the session.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyNip, createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const nip = (body?.nip as string | undefined)?.trim();
  if (!nip) return NextResponse.json({ ok: false, error: "NIP wajib diisi." }, { status: 400 });

  const result = await verifyNip(nip);
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "NIP tidak ditemukan. Hubungi administrator.",
      inactive: "Akun tidak aktif. Hubungi administrator.",
      dummy: "Akun ini belum punya NIP resmi terverifikasi dan belum bisa login. Hubungi administrator.",
      staging_blocked: "Role MR/ASM/SM/NSM tidak bisa login di staging.",
    };
    const status = result.error === "not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: messages[result.error] ?? "Terjadi kesalahan." }, { status });
  }

  await createSession(result.user, result.isTestPsr);
  return NextResponse.json({
    ok: true,
    user: {
      nip: result.user.nip,
      name: result.isTestPsr ? `${result.user.name} (PSR)` : result.user.name,
      role: result.isTestPsr ? "MR" : result.user.role,
    },
  });
}
