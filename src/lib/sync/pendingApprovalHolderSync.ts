/**
 * Recomputes PoaDoctorApproval.currentHolderId LIVE from User.nipAtasan/isActive
 * for every doctor row still pending approval (SUBMITTED_TO_ASM/SM/NSM/ASD/SD),
 * instead of leaving it frozen at whoever resolveNextHolder (poaWorkflow.ts)
 * resolved at the moment of that row's last submit/approve transition.
 *
 * Root cause fixed (2026-09-11, bug report): currentHolderId is ONLY written
 * at transition time — nothing re-resolves it afterward. If the org
 * structure changes while a doctor sits pending (a new ASM takes over that
 * MR's team, the old ASM gets deactivated, etc.), currentHolderId keeps
 * pointing at the OLD person: canApproveDoctor (authz.ts) checks
 * `doctor.currentHolderId === user.nip` directly, so the person who's
 * ACTUALLY the ASM now never sees an approve button, and dashboard's
 * "pending for me" list (which filters by the same column) never surfaces
 * it to them either. Same class of staleness as outletCoverageSync.ts's
 * Outlet.coveredByNip fix (670c2cb) — same live-walk-the-chain approach,
 * just walking PoaForm.owner's reportsTo chain for a doctor's pending ROLE
 * LEVEL instead of walking for "any coverage role".
 *
 * Wired into orgAndOutletScheduler.ts as the step after org sync (needs
 * fresh User.nipAtasan/isActive) — org changes daily, so a stale holder
 * self-heals within one day without anyone noticing it was ever wrong.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, PoaStatus } from "@prisma/client";
import { ROLE_LEVEL, PENDING_STATUS_ROLE, CHAIN_LEVEL } from "@/lib/poaWorkflow";

const pendingSelect = {
  id: true,
  status: true,
  currentHolderId: true,
  poa: { select: { ownerId: true } },
} satisfies Prisma.PoaDoctorApprovalSelect;
type PendingRow = Prisma.PoaDoctorApprovalGetPayload<{ select: typeof pendingSelect }>;

interface UserLite {
  nip: string;
  role: string;
  isActive: boolean;
  nipAtasan: string | null;
}

/**
 * Walks up nipAtasan from `startNip` until an ACTIVE user at or above
 * `targetLevel` (ROLE_LEVEL scale) is found. Same "vacant level just gets
 * skipped" behavior as resolveNextHolder in poaWorkflow.ts, just driven by
 * an in-memory map instead of a Prisma-included nested object (batch-safe
 * for a company-wide run instead of one query per doctor row).
 */
export function resolveLivePendingHolder(
  startNip: string | null,
  targetLevel: number,
  userByNip: Map<string, UserLite>
): string | null {
  let curNip: string | null = startNip;
  const seen = new Set<string>();
  while (curNip && !seen.has(curNip)) {
    seen.add(curNip);
    const u = userByNip.get(curNip);
    if (!u) return null;
    if (u.isActive && (ROLE_LEVEL[u.role] ?? -1) >= targetLevel) return u.nip;
    curNip = u.nipAtasan;
  }
  return null;
}

export interface PendingApprovalHolderSyncResult {
  doctorsConsidered: number;
  doctorsUpdated: number;
  doctorsUnresolved: number;
}

const PENDING_STATUSES: PoaStatus[] = [
  PoaStatus.SUBMITTED_TO_ASM,
  PoaStatus.SUBMITTED_TO_SM,
  PoaStatus.SUBMITTED_TO_NSM,
  PoaStatus.SUBMITTED_TO_ASD,
  PoaStatus.SUBMITTED_TO_SD,
];

export async function runPendingApprovalHolderSync(): Promise<PendingApprovalHolderSyncResult> {
  // Two plain awaits, NOT Promise.all([...]) destructured directly — that
  // pattern has repeatedly lost element-type inference in this codebase
  // (both here and in outletCoverageSync.ts's identical TS7053), leaving
  // the array typed `any[]` even with an explicit callback param annotation.
  const usersPromise = prisma.user.findMany({ select: { nip: true, role: true, isActive: true, nipAtasan: true } });
  const pendingPromise: Promise<PendingRow[]> = prisma.poaDoctorApproval.findMany({
    where: { status: { in: PENDING_STATUSES } },
    select: pendingSelect,
  });
  const users = await usersPromise;
  const pending = await pendingPromise;
  const userByNip = new Map<string, UserLite>(users.map((u: UserLite) => [u.nip, u]));

  let updated = 0;
  let unresolved = 0;

  const CONCURRENCY = 20;
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const i = next++;
      const row: PendingRow = pending[i];
      const chainRole = PENDING_STATUS_ROLE[row.status];
      if (!chainRole) continue; // shouldn't happen — PENDING_STATUSES is exactly PENDING_STATUS_ROLE's keys

      const owner = userByNip.get(row.poa.ownerId);
      // Same starting point as resolveNextHolder (poaWorkflow.ts): ONE level
      // above the owner, not the owner themselves — the owner submits to
      // whoever's above them, never to themselves.
      const resolvedNip = resolveLivePendingHolder(owner?.nipAtasan ?? null, CHAIN_LEVEL[chainRole], userByNip);
      if (!resolvedNip) {
        unresolved++;
        continue;
      }
      if (resolvedNip === row.currentHolderId) continue; // already correct, skip the write

      try {
        await prisma.poaDoctorApproval.update({
          where: { id: row.id },
          data: { currentHolderId: resolvedNip },
        });
        updated++;
      } catch {
        // Row deleted concurrently (POA removed mid-run) — next run is a no-op for it.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  return { doctorsConsidered: pending.length, doctorsUpdated: updated, doctorsUnresolved: unresolved };
}
