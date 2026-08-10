/**
 * Cross-replica mutex, backed by the SyncLock table (prisma/schema.prisma).
 * Multiple pods each run their own in-process scheduler (see
 * salesHistoryMonthlyScheduler.ts), so without this every replica would
 * re-run the same job at ~the same instant.
 *
 * Uses raw SQL rather than the generated Prisma model — the single
 * `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statement is what makes the
 * claim atomic (Postgres serializes concurrent upserts on the conflicting
 * row, so only one caller's WHERE clause can see the row as "stale"); a
 * separate read-then-write via prisma.syncLock.findUnique/upsert would
 * reopen the race this exists to close.
 */

import { prisma } from "@/lib/prisma";

/**
 * Tries to claim `key`. Returns true if this call acquired it (either the
 * key was unclaimed, or the existing claim is older than `staleAfterMs` —
 * self-healing if a replica died mid-run instead of holding the lock
 * forever). Returns false if another replica holds a fresh claim.
 */
export async function acquireSyncLock(key: string, staleAfterMs: number): Promise<boolean> {
  const rows = await prisma.$executeRaw`
    INSERT INTO "SyncLock" ("key", "lockedAt")
    VALUES (${key}, now())
    ON CONFLICT ("key") DO UPDATE
      SET "lockedAt" = now()
      WHERE "SyncLock"."lockedAt" < now() - (${staleAfterMs}::text || ' milliseconds')::interval
  `;
  return rows === 1;
}
