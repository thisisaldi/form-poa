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

/**
 * Verify a NIP against the users table (or mock client in USE_MOCK_DB mode).
 * This is the only identity-check gate — once replaced with OTP, only this function changes.
 *
 * Dummy/workshop accounts (isDummy=true, e.g. "NSM973066") are allowed to log
 * in like any other account (2026-07-28 request) — isDummy's only remaining
 * effect is granting national/all-outlet access (see getOutletsByUser,
 * canCreatePoa), not restricting login.
 */
export async function verifyNip(nip: string): Promise<VerifyResult> {
  // Every real NIP in the DB is stored uppercase (see any User row) — case-
  // insensitive matching on the primary key (findFirst + mode: "insensitive")
  // can't use the PK index at all (confirmed via EXPLAIN: forces a full
  // Seq Scan on User), so login got slower with every user added. Normalizing
  // here and doing a plain findUnique keeps the same "type it in any case"
  // UX while hitting the PK index directly (2026-07-31 perf pass).
  const targetNip = nip.toUpperCase();
  const user: User | null = await prisma.user.findUnique({
    where: { nip: targetNip },
  });
  if (!user) {
    if (targetNip === "SCMR123456") {
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
      };
    }
    return { ok: false, error: "not_found" };
  }
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
  session.jabatan = user.jabatan;
  session.isLoggedIn = true;
  await session.save();
}

/** Destroy the current session (logout). */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
