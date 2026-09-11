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
 * Wired into orgAndOutletScheduler.ts as the step after org+outlet sync
 * (needs both fresh — reads MrOutletAssignment's CURRENT periode and every
 * User's nipAtasan/isActive).
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
  const now = new Date();
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);

  const [users, assignments] = await Promise.all([
    prisma.user.findMany({ select: { nip: true, role: true, isActive: true, nipAtasan: true } }),
    prisma.mrOutletAssignment.findMany({ where: { periode }, select: { kodePI: true, nipMR: true } }),
  ]);
  const userByNip = new Map<string, UserLite>(users.map((u: UserLite) => [u.nip, u]));

  // Outlet.coveredByNip is singular — first assignment per outlet wins, same
  // "representative holder" convention as importStrukturVerifiedKAM.ts's
  // effectiveMrNip (a SHADOW-pair outlet still gets one representative here).
  const mrByOutlet = new Map<string, string>();
  for (const a of assignments) {
    if (!mrByOutlet.has(a.kodePI)) mrByOutlet.set(a.kodePI, a.nipMR);
  }

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
