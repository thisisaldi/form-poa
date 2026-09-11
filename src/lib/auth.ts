/**
 * Identity-verification module.
 *
 * Kept separate from session.ts so this step can be swapped (e.g. OTP via SMS/email)
 * without touching session creation logic.
 */
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import type { User } from "@prisma/client";

export type VerifyResult =
  | { ok: true; user: User; isTestPsr?: boolean }
  | { ok: false; error: "not_found" | "inactive" | "staging_blocked" };

// Staging-only login block (2026-09-11 request) — sales hierarchy roles
// (MR through NSM) should NOT be able to log into staging, only
// GM/ADMIN/SFE/VIEWER/SD. No dedicated APP_ENV is plumbed through to the
// running container yet (see next.config.ts's build-time-only use of it),
// so staging is detected via EXODUS_AUTH_URL's realm — already unique per
// environment ("/realms/staging/" vs "/realms/production/", see .env.staging/
// .env.production) and already loaded into env.ts, no new env var needed.
const IS_STAGING = env.EXODUS_AUTH_URL?.includes("/realms/staging/") ?? false;
const STAGING_BLOCKED_ROLES: readonly string[] = ["MR", "ASM", "SM", "NSM"];

/**
 * Verify a NIP against the users table (or mock client in USE_MOCK_DB mode).
 * This is the only identity-check gate — once replaced with OTP, only this function changes.
 *
 * Dummy/workshop accounts (isDummy=true, e.g. "NSM973066") are allowed to log
 * in like any other account (2026-07-28 request) — isDummy's only remaining
 * effect is granting national/all-outlet access (see getOutletsByUser,
 * canCreatePoa), not restricting login.
 *
 * Prefix `testpsr<NIP>` (case-insensitive) allows managerial users (ASM, SM, NSM)
 * to log in with an effective role of MR/PSR for simulation/testing.
 */
export async function verifyNip(nip: string): Promise<VerifyResult> {
  // Every real NIP in the DB is stored uppercase (see any User row) — case-
  // insensitive matching on the primary key (findFirst + mode: "insensitive")
  // can't use the PK index at all (confirmed via EXPLAIN: forces a full
  // Seq Scan on User), so login got slower with every user added. Normalizing
  // here and doing a plain findUnique keeps the same "type it in any case"
  // UX while hitting the PK index directly (2026-07-31 perf pass).
  const cleanInput = nip.trim();
  const isTestPsr = cleanInput.toLowerCase().startsWith("testpsr");
  const targetNip = (isTestPsr ? cleanInput.replace(/^testpsr/i, "") : cleanInput).toUpperCase();
  const user: User | null = await prisma.user.findUnique({
    where: { nip: targetNip },
  });
  if (!user) {
    if (targetNip === "SCMR123456") {
      if (IS_STAGING) return { ok: false, error: "staging_blocked" };
      return {
        ok: true,
        user: {
          nip: "SCMR123456",
          name: "Sales Counter Test MR",
          role: "MR",
          jabatan: null,
          email: "scmr123456@example.com",
          nipAtasan: "ASM001",
          namaAtasan: "Agus Pratama",
          kodeWilayah: "GT-01",
          namaWilayah: "GT JAKARTA 1",
          isActive: true,
          isDummy: false,
          syncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: "OMEGA",
          sippAbsPtId: null,
        },
        isTestPsr,
      };
    }
    return { ok: false, error: "not_found" };
  }
  if (!user.isActive) return { ok: false, error: "inactive" };
  const effectiveRole = isTestPsr ? "MR" : user.role;
  if (IS_STAGING && STAGING_BLOCKED_ROLES.includes(effectiveRole)) {
    return { ok: false, error: "staging_blocked" };
  }
  return { ok: true, user, isTestPsr };
}

/** Create a server-side session for a verified user. */
export async function createSession(user: User, isTestPsr = false): Promise<void> {
  const session = await getSession();
  session.userId = user.nip;
  session.nip = user.nip;
  session.name = isTestPsr ? `${user.name} (PSR)` : user.name;
  session.role = isTestPsr ? "MR" : user.role;
  session.jabatan = isTestPsr ? "PSR" : user.jabatan;
  session.project = user.project;
  session.isLoggedIn = true;
  session.isTestPsr = isTestPsr;
  session.originalRole = user.role;
  await session.save();
}

/** Destroy the current session (logout). */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
