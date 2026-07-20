/**
 * Identity-verification module.
 *
 * Kept separate from session.ts so this step can be swapped (e.g. OTP via SMS/email)
 * without touching session creation logic.
 */
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { User } from "@prisma/client";

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; error: "not_found" | "inactive" };

// TEMPORARY HARDCODE (2026-07-20): grants ADMIN at login time regardless of the
// DB's stored role, since the data migration granting this NIP ADMIN
// (prisma/migrations/20260720163533_grant_admin_p260054) couldn't be verified
// against the live DB this session. Remove once that's confirmed applied —
// the account's actual User.role in the DB is the real source of truth.
const HARDCODE_ADMIN_NIP = "P260054";

/**
 * Verify a NIP against the users table (or mock client in USE_MOCK_DB mode).
 * This is the only identity-check gate — once replaced with OTP, only this function changes.
 */
export async function verifyNip(nip: string): Promise<VerifyResult> {
  const user: User | null = await prisma.user.findFirst({
    where: { nip: { equals: nip, mode: "insensitive" } },
  });
  if (!user) return { ok: false, error: "not_found" };
  if (!user.isActive) return { ok: false, error: "inactive" };
  if (user.nip.toUpperCase() === HARDCODE_ADMIN_NIP && user.role !== "ADMIN") {
    return { ok: true, user: { ...user, role: "ADMIN" } };
  }
  return { ok: true, user };
}

/** Create a server-side session for a verified user. */
export async function createSession(user: User): Promise<void> {
  const session = await getSession();
  session.userId = user.nip;
  session.nip = user.nip;
  session.name = user.name;
  session.role = user.role;
  session.isLoggedIn = true;
  await session.save();
}

/** Destroy the current session (logout). */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
