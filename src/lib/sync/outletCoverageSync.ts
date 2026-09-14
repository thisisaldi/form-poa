/**
 * Recomputes Outlet.coveredByNip/coveredByRole LIVE from User + MrOutletAssignment
 * (both already kept fresh daily by orgStructureSync.ts/outletSync.ts) instead
 * of leaving those two columns as whatever scripts/importStrukturVerifiedKAM.ts
 * — a manual, KAM-division-only Excel import — last set them to.
 *
 * Root cause fixed (2026-09-11): canCreatePoa()'s vacant-outlet exception
 * (src/lib/authz.ts) reads coveredByNip/coveredByRole, but outletSync.ts
 * explicitly never touches them (see its own comment: "stays whatever
 * importStrukturVerifiedKAM.ts last set them to"). Two consequences: (a) any
 * outlet outside the KAM division never got a value at all (~27.6k of ~35k
 * Outlet rows, confirmed live), and (b) even a KAM outlet went stale the
 * moment its MR (or the ASM/SM above them) became inactive, since nothing
 * re-ran the Excel import for that. Confirmed live: MR P240150 went
 * isActive=false but her outlets' coveredByNip still pointed at her with role
 * "MR" — her ASM's canCreatePoa saw 0 covered outlets despite a genuinely
 * vacant MR directly under him.
 *
 * Same cascading-vacancy algorithm as importStrukturVerifiedKAM.ts's
 * resolveCoverage (walk up the reporting chain until an active person is
 * found), just driven by live User.nipAtasan/isActive instead of one Excel
 * row's asmNip/smNip/nsmNip columns — so it naturally covers every outlet
 * with a current MrOutletAssignment, not just KAM.
 *
 * Second root cause fixed (2026-09-14): the query below originally scoped
 * MrOutletAssignment to THIS CALENDAR MONTH's periode only. outletSync.ts
 * only ever syncs assignments for CURRENTLY ACTIVE MRs (see its own
 * `role: "MR", isActive: true` query) — so the moment an MR goes inactive,
 * their outlets stop getting a fresh row for the current month entirely.
 * That silently dropped those outlets out of THIS function's `assignments`
 * result from then on, so coveredByNip/coveredByRole for them was NEVER
 * recomputed again — stuck forever at whatever it was the last time that MR
 * was still active (typically the MR's own nip/role "MR", since they were
 * their own coverage back then). Confirmed live (2026-09-14 bug report): an
 * ASM whose one MR went vacant could open "create POA" (first bug, fixed
 * separately) but saw an EMPTY outlet dropdown — canCreatePoa's covered-outlet
 * check found rows, but getOutletsByUser's `coveredByRole: { not: "MR" }`
 * filter never matched because coveredByNip/coveredByRole were still frozen
 * on the vacant MR themselves. Fixed by taking each outlet's LATEST
 * assignment ever synced (any period), not "this month's", via a
 * `DISTINCT ON` query — same "most recent wins" idea getOutletsForMrSubtree
 * (masterData.ts) already uses per-MR, just per-outlet here instead.
 *
 * Wired into orgAndOutletScheduler.ts as the step after org+outlet sync
 * (needs both fresh — reads MrOutletAssignment's latest-per-outlet rows and
 * every User's nipAtasan/isActive).
 */
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

interface UserLite {
  nip: string;
  role: string;
  isActive: boolean;
  nipAtasan: string | null;
}

const COVERAGE_ROLES: readonly string[] = [Role.MR, Role.ASM, Role.SM, Role.NSM];

/**
 * Walks up nipAtasan from `startNip` until an active MR/ASM/SM/NSM is found.
 * Returns null if the chain dead-ends (unknown nip) or cycles back on itself
 * before finding anyone active. Pure/testable — see
 * scripts/testOutletCoverageSync.ts.
 */
export function resolveLiveCoverage(
  startNip: string,
  userByNip: Map<string, UserLite>
): { nip: string; role: string } | null {
  let curNip: string | null = startNip;
  const seen = new Set<string>();
  while (curNip && !seen.has(curNip)) {
    seen.add(curNip);
    const u: UserLite | undefined = userByNip.get(curNip);
    if (!u) return null;
    if (u.isActive && COVERAGE_ROLES.includes(u.role)) return { nip: u.nip, role: u.role };
    curNip = u.nipAtasan;
  }
  return null;
}

export interface OutletCoverageSyncResult {
  outletsConsidered: number;
  outletsUpdated: number;
  outletsUnresolved: number;
}

export async function runOutletCoverageSync(): Promise<OutletCoverageSyncResult> {
  const usersPromise = prisma.user.findMany({ select: { nip: true, role: true, isActive: true, nipAtasan: true } });
  // DISTINCT ON (kodePI) ... ORDER BY kodePI, periode DESC — the single
  // LATEST-synced assignment per outlet, regardless of which calendar month
  // it's from (see module doc comment's "second root cause"). Two plain
  // awaits, not Promise.all([...]) destructured directly, matching this
  // repo's established workaround for that pattern's TS7053 element-type
  // inference loss (see this function's own git history).
  const assignmentsPromise = prisma.$queryRaw<{ kodePI: string; nipMR: string }[]>`
    SELECT DISTINCT ON ("kodePI") "kodePI", "nipMR"
    FROM "MrOutletAssignment"
    ORDER BY "kodePI", "periode" DESC
  `;
  const users = await usersPromise;
  const assignments = await assignmentsPromise;
  const userByNip = new Map<string, UserLite>(users.map((u: UserLite) => [u.nip, u]));

  // One row per outlet already (DISTINCT ON above) — no further "first wins"
  // dedup needed here, unlike the old current-month-only query.
  const mrByOutlet = new Map<string, string>(assignments.map((a: { kodePI: string; nipMR: string }) => [a.kodePI, a.nipMR]));

  const entries = [...mrByOutlet.entries()];
  let updated = 0;
  let unresolved = 0;

  const CONCURRENCY = 20;
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const i = next++;
      const [kodePI, nipMR] = entries[i];
      const coverage = resolveLiveCoverage(nipMR, userByNip);
      if (!coverage) {
        unresolved++;
        continue;
      }
      try {
        await prisma.outlet.update({
          where: { kodePI },
          data: { coveredByNip: coverage.nip, coveredByRole: coverage.role },
        });
        updated++;
      } catch {
        // Outlet row doesn't exist yet (assignment synced ahead of the
        // outlet's own upsert this run) — next day's run picks it up.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  return { outletsConsidered: entries.length, outletsUpdated: updated, outletsUnresolved: unresolved };
}
