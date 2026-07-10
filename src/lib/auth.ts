/**
 * Identity-verification module.
 *
 * Kept separate from session.ts so this step can be swapped (e.g. OTP via SMS/email)
 * without touching session creation logic.
 */
import { prisma } from "@/lib/prisma";
import { MOCK_USERS } from "@/lib/mock/data";
import { getSession } from "@/lib/session";
import type { User } from "@prisma/client";

const USE_MOCK = process.env.USE_MOCK_DB === "true";

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; error: "not_found" | "inactive" };

/**
 * Verify a NIP against the users table.
 * This is the only identity-check gate — once replaced with OTP, only this function changes.
 */
export async function verifyNip(nip: string): Promise<VerifyResult> {
  const user: User | null = USE_MOCK
    ? (MOCK_USERS.find((u) => u.nip === nip) ?? null)
    : await prisma.user.findUnique({ where: { nip } });
  if (!user) return { ok: false, error: "not_found" };
  if (!user.isActive) return { ok: false, error: "inactive" };
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
