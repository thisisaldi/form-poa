/**
 * Re-points currentHolderId of pending SC forms at the owner's CURRENT chain,
 * for after a user sync changed someone's atasan. Run as the second half of
 * scripts/syncOmegaUsers.ts.
 *
 * The approvals inbox shows a form only to its currentHolderId
 * (getPendingActionScFilter), and that is resolved once at submit/approve. So
 * when an MR moves under a new ASM/SM/NSM, forms already waiting stay with the
 * old one. Rule (2026-10-15): the holder is the nearest ACTIVE user with the
 * role the status waits for, walking up from the owner's nipAtasan — e.g. an
 * MR now under a new SM sends their SUBMITTED_TO_SM forms to that SM, whoever
 * approved at ASM level.
 *
 * A vacant level escalates (2026-10-16): a SUBMITTED_TO_ASM form whose owner
 * has no active ASM in the chain goes to the nearest active SM, and on to
 * NSM if that is vacant too. The status stays SUBMITTED_TO_ASM; the SM can
 * approve it (buildApprovalWhereClause) and it moves on to SUBMITTED_TO_NSM,
 * the same as an SM fast-track.
 *
 * Only currentHolderId changes; status, approvals, version and updatedAt are
 * kept. A form with no active user at its level or above is skipped and
 * reported, never sent to an arbitrary user of that role (the findFirst
 * fallback at submit time does that).
 */

import { prisma } from "@/lib/prisma";
import { PoaStatus, type Role } from "@prisma/client";

// Levels tried in order: the one the status waits for, then each one above it.
const TARGET_LEVELS: Partial<Record<PoaStatus, Role[][]>> = {
  [PoaStatus.SUBMITTED_TO_ASM]: [["ASM"], ["SM"], ["NSM", "ADMIN"]],
  [PoaStatus.SUBMITTED_TO_SM]: [["SM"], ["NSM", "ADMIN"]],
  [PoaStatus.SUBMITTED_TO_NSM]: [["NSM", "ADMIN"]],
};

/** ESCALATE = MOVE to a higher level because the status's own level is vacant in the owner's chain. */
export type ScHolderOutcome = "MOVE" | "ESCALATE" | "SKIP_NO_TARGET" | "SKIP_CHANGED";

export interface ScHolderChange {
  outcome: ScHolderOutcome;
  formId: string;
  period: string;
  kodePI: string;
  namaOutlet: string | null;
  status: PoaStatus;
  ownerId: string;
  ownerName: string;
  ownerActive: boolean;
  oldHolderId: string | null;
  oldHolderName: string;
  newHolderId: string | null;
  newHolderName: string;
  reason: string;
}

/** A user as a sync is about to leave it, so a dry run can resolve holders against the planned org. */
export interface ChainUserOverride {
  nip: string;
  name?: string;
  role?: Role;
  nipAtasan?: string | null;
  isActive?: boolean;
  project?: string | null;
}

export interface ScHolderReassignOptions {
  dryRun?: boolean;
  /** "OMEGA" = owners with project OMEGA, "NONE" = owners without a project; omitted = all. */
  project?: string;
  period?: string;
  /** Applied on top of the User table before resolving; new nips are added. */
  userOverrides?: ChainUserOverride[];
  /** Owners whose forms are left alone (counted in `skippedOwners`), e.g. TEST accounts. */
  skipOwner?: (ownerId: string) => boolean;
}

export interface ScHolderReassignResult {
  checked: number;
  unchanged: number;
  moved: number;
  /** Part of `moved` that went to a higher level. */
  escalated: number;
  skipped: number;
  skippedOwners: number;
  changes: ScHolderChange[];
}

type ChainUser = { nip: string; name: string; role: Role; nipAtasan: string | null; isActive: boolean; project: string | null };

export async function runScHolderReassign({ dryRun = false, project, period, userOverrides = [], skipOwner }: ScHolderReassignOptions = {}): Promise<ScHolderReassignResult> {
  const result: ScHolderReassignResult = { checked: 0, unchanged: 0, moved: 0, escalated: 0, skipped: 0, skippedOwners: 0, changes: [] };

  // The whole User table is a few thousand rows; walking chains in memory
  // beats one query per hop per form.
  const users: ChainUser[] = await prisma.user.findMany({
    select: { nip: true, name: true, role: true, nipAtasan: true, isActive: true, project: true },
  });
  const userByNip = new Map(users.map((u) => [u.nip, u]));
  for (const o of userOverrides) {
    const base = userByNip.get(o.nip) ?? { nip: o.nip, name: o.nip, role: "MR" as Role, nipAtasan: null, isActive: true, project: null };
    userByNip.set(o.nip, { ...base, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) });
  }

  // Owner project is matched in memory so overrides (a user moving into OMEGA) count too.
  const wantProject = project === undefined ? undefined : project.toUpperCase() === "NONE" ? null : project.toUpperCase();

  const allForms: {
    id: string;
    period: string;
    kodePI: string;
    namaOutlet: string | null;
    status: PoaStatus;
    ownerId: string;
    currentHolderId: string | null;
    updatedAt: Date;
  }[] = await prisma.poaScForm.findMany({
    where: {
      status: { in: Object.keys(TARGET_LEVELS) as PoaStatus[] },
      ...(period ? { period } : {}),
    },
    select: { id: true, period: true, kodePI: true, namaOutlet: true, status: true, ownerId: true, currentHolderId: true, updatedAt: true },
    orderBy: [{ period: "asc" }, { id: "asc" }],
  });
  const inProject =
    wantProject === undefined ? allForms : allForms.filter((f) => (userByNip.get(f.ownerId)?.project ?? null) === wantProject);
  const forms = skipOwner ? inProject.filter((f) => !skipOwner(f.ownerId)) : inProject;
  result.skippedOwners = inProject.length - forms.length;
  result.checked = forms.length;
  if (forms.length === 0) return result;

  function resolveHolder(ownerId: string, roles: Role[]): ChainUser | null {
    const seen = new Set<string>([ownerId]);
    let nip = userByNip.get(ownerId)?.nipAtasan ?? null;
    while (nip && !seen.has(nip)) {
      seen.add(nip);
      const u = userByNip.get(nip);
      if (!u) return null;
      if (u.isActive && roles.includes(u.role)) return u;
      nip = u.nipAtasan;
    }
    return null;
  }

  for (const form of forms) {
    const levels = TARGET_LEVELS[form.status]!;
    const roles = levels[0];
    const owner = userByNip.get(form.ownerId);
    const oldHolder = form.currentHolderId ? userByNip.get(form.currentHolderId) : undefined;
    let target: ChainUser | null = null;
    let escalated = false;
    for (let i = 0; i < levels.length; i++) {
      target = resolveHolder(form.ownerId, levels[i]);
      if (target) {
        escalated = i > 0;
        break;
      }
    }
    if (target && target.nip === form.currentHolderId) {
      result.unchanged++;
      continue;
    }

    const change: ScHolderChange = {
      outcome: !target ? "SKIP_NO_TARGET" : escalated ? "ESCALATE" : "MOVE",
      formId: form.id,
      period: form.period,
      kodePI: form.kodePI,
      namaOutlet: form.namaOutlet,
      status: form.status,
      ownerId: form.ownerId,
      ownerName: owner?.name ?? "",
      ownerActive: owner?.isActive ?? false,
      oldHolderId: form.currentHolderId,
      oldHolderName: oldHolder?.name ?? "",
      newHolderId: target?.nip ?? null,
      newHolderName: target?.name ?? "",
      reason: "",
    };

    if (!target) {
      change.reason = `tidak ada ${levels.map((l) => l.join("/")).join(", ")} aktif di rantai atasan owner`;
      result.skipped++;
      result.changes.push(change);
      continue;
    }
    change.reason = escalated
      ? `${roles.join("/")} kosong di rantai atasan owner, naik ke ${target.role}`
      : !form.currentHolderId
      ? "holder kosong"
      : !oldHolder
        ? "holder lama tidak ada di tabel User"
        : !oldHolder.isActive
          ? "holder lama nonaktif"
          : !roles.includes(oldHolder.role)
            ? `role holder lama ${oldHolder.role}`
            : "atasan owner berubah";

    if (!dryRun) {
      // Guarded on status + old holder so a form approved meanwhile is left alone.
      const { count } = await prisma.poaScForm.updateMany({
        where: { id: form.id, status: form.status, currentHolderId: form.currentHolderId },
        data: { currentHolderId: target.nip, updatedAt: form.updatedAt },
      });
      if (count === 0) {
        change.outcome = "SKIP_CHANGED";
        change.reason = "form berubah saat command berjalan";
        result.skipped++;
        result.changes.push(change);
        continue;
      }
    }
    result.moved++;
    if (escalated) result.escalated++;
    result.changes.push(change);
  }

  return result;
}
