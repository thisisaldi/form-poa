/**
 * Nexus API → PostgreSQL org-structure sync.
 *
 * Cutover 2026-08-20 (docs/org-nexus-migration/): source moved from MSSQL
 * `Struktur_Marketing_PI` to Nexus `get_employees`/`get_subordinates`, using
 * the closest-enclosing-ancestor inference in src/lib/sync/orgNexusInference.ts
 * (validated 96.5%+ match against the prior MSSQL-derived hierarchy across
 * two dry-run cycles — see the README's "Hasil run pertama"). That module
 * does the Nexus fetch + hierarchy inference; this file just upserts the
 * result into `User`, same shape as the MSSQL version it replaces.
 *
 * position → Role mapping (POSITION_TO_ROLE in orgNexusInference.ts):
 *   Field Force → MR,  Supervisor → MR,  Area Sales Manager → ASM,
 *   Sales Manager → SM,  National Sales Manager → NSM.
 * Both Field Force and Supervisor collapse to MR — same as MSSQL's SPV/FF —
 * and Supervisor is skipped in the reportsTo chain for Field Force (§3 step
 * 4 in orgNexusInference.ts), so the approval chain MR→ASM→SM→NSM is
 * unchanged in shape by the source switch.
 *
 * GM is explicitly OUT of scope (OQ-4) — `get_employees?project=ethical`
 * doesn't return GM at all, so GM rows are untouched by this sync (same as
 * before: the MSSQL query never selected GM either). GM stays manual via
 * scripts/importStrukturVerifiedKAM.ts.
 *
 * Employees whose `position` doesn't match any known mapping are skipped
 * (role: null from the inference) rather than upserted with a guessed role.
 */

import { prisma } from "@/lib/prisma";
import { inferOrgHierarchyFromNexus } from "@/lib/sync/orgNexusInference";
import type { Role } from "@prisma/client";

// ─── Source Schema Interface ──────────────────────────────────────────────────

export interface OrgRecord {
  nip: string;
  name: string;
  email: string | null;
  role: Role;
  reportsToNip: string | null;
  isActive: boolean;
}

async function fetchOrgFromNexus(): Promise<{ records: OrgRecord[]; failedManagerNips: string[] }> {
  const { records: inferred, failedManagerNips } = await inferOrgHierarchyFromNexus();

  const records: OrgRecord[] = inferred
    .filter((r) => r.role !== null)
    .map((r) => ({
      nip: r.nip,
      name: r.nama.trim(),
      email: null,
      role: r.role as Role,
      reportsToNip: r.inferredNipAtasan,
      isActive: true,
    }));

  return { records, failedManagerNips };
}

// ─── Sync Logic ───────────────────────────────────────────────────────────────

export interface SyncResult {
  upserted: number;
  deactivated: number;
  errors: string[];
}

/**
 * Run the full org sync. Safe to run repeatedly (idempotent upserts).
 * Deactivates users not present in the source by setting isActive = false.
 */
export async function runOrgSync(): Promise<SyncResult> {
  const now = new Date();
  const { records, failedManagerNips } = await fetchOrgFromNexus();

  // Defense-in-depth on top of fetchAllEmployees' own throw-on-empty (2026-08-21
  // incident: an empty/near-empty source must never reach the deactivate pass
  // below, which would read as "everyone left the company"). Compared against
  // the SAME in-scope subset the deactivate pass below targets (see its
  // comment) — comparing against ALL active users (including dummy/omega/
  // GM/ADMIN accounts this sync never touches) would make the ratio
  // meaningless. A real roster shrink of this size in one sync cycle is not
  // plausible.
  const existingActiveInScope = await prisma.user.count({
    where: { isActive: true, isDummy: false, role: { in: ["MR", "ASM", "SM", "NSM"] }, project: null },
  });
  if (records.length === 0 || (existingActiveInScope > 20 && records.length < existingActiveInScope * 0.5)) {
    throw new Error(
      `Refusing to sync: Nexus returned ${records.length} usable records vs ${existingActiveInScope} currently-active in-scope users (implausible drop) — aborting before the deactivate pass.`
    );
  }

  const errors: string[] = failedManagerNips.map(
    (nip) => `NIP ${nip}: get_subordinates fetch failed after retry (subtree ancestry incomplete this run)`
  );
  let upserted = 0;

  // Pass 1: upsert all users without atasan (IDs not yet known)
  for (const rec of records) {
    try {
      await prisma.user.upsert({
        where: { nip: rec.nip },
        create: {
          nip: rec.nip,
          name: rec.name,
          email: rec.email,
          role: rec.role,
          isActive: rec.isActive,
          syncedAt: now,
        },
        update: {
          name: rec.name,
          email: rec.email,
          role: rec.role,
          isActive: rec.isActive,
          syncedAt: now,
        },
      });
      upserted++;
    } catch (err) {
      errors.push(`NIP ${rec.nip}: ${String(err)}`);
    }
  }

  // Pass 2: wire up atasan (stores manager NIP directly, since nip is the PK)
  for (const rec of records) {
    if (!rec.reportsToNip) continue;
    try {
      const manager = await prisma.user.findUnique({
        where: { nip: rec.reportsToNip },
        select: { nip: true, name: true },
      });
      if (!manager) {
        errors.push(`NIP ${rec.nip}: manager NIP ${rec.reportsToNip} not found`);
        continue;
      }
      await prisma.user.update({
        where: { nip: rec.nip },
        data: { nipAtasan: manager.nip, namaAtasan: manager.name },
      });
    } catch (err) {
      errors.push(`NIP ${rec.nip} (hierarchy): ${String(err)}`);
    }
  }

  // Pass 3: deactivate users no longer in the source — scoped to exactly what
  // get_employees?project=ethical can plausibly return (2026-08-21 fix: the
  // unscoped version deactivated 1831 users in staging, including 1076
  // isDummy workshop accounts, 331 project="omega" Sales Counter users
  // — those are synced separately by omegaUserSync.ts, scoped the same way
  // — and GM/ADMIN/SFE/VIEWER, none of which this endpoint ever returns).
  const activeNips = records.map((r) => r.nip);
  const deactivated = await prisma.user.updateMany({
    where: {
      nip: { notIn: activeNips },
      isActive: true,
      isDummy: false,
      role: { in: ["MR", "ASM", "SM", "NSM"] },
      project: null,
    },
    data: { isActive: false },
  });

  return { upserted, deactivated: deactivated.count, errors };
}
