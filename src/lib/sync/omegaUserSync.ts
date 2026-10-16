import { prisma } from "@/lib/prisma";
import { nexusAuthHeaders } from "@/lib/nexusAuth";
import type { Role } from "@prisma/client";
import type { ChainUserOverride } from "@/lib/sync/scHolderReassign";

/**
 * Sync Users for project OMEGA (Sales Counter) from Nexus:
 * 1. GET /api/r/poa/get_employees?project=omega
 * 2. GET /api/r/poa/get_subordinates?nip=<NIP> for every NSM, SM, ASM
 *
 * Everything is computed in memory first (users, atasan, deactivations) and
 * only then written, so --dry-run reports exactly what a real run would do and
 * a failed guard writes nothing at all.
 *
 * Only field roles (MR/ASM/SM/NSM) are touched. A user whose stored role is
 * anything else (VIEWER, ADMIN, GM, SFE, SD, SALES SUPPORT) is skipped even if
 * Nexus lists them, so a viewer is never turned into an MR. Dummy accounts are
 * never deactivated.
 *
 * Pending SC forms are reassigned right after by scripts/syncOmegaUsers.ts
 * (src/lib/sync/scHolderReassign.ts); `userOverrides` lets its dry run see the
 * org as this sync leaves it.
 */

const NEXUS_BASE = "https://api-nexus.pharos.id/api/r/poa";
const FIELD_ROLES: Role[] = ["MR", "ASM", "SM", "NSM"];
const SUBORDINATE_BATCH = 10;

// A real run refuses to deactivate more than this many users in one go
// (unless allowMassDeactivate): a short employee list from Nexus must not lock
// half the Sales Counter team out.
const MASS_DEACTIVATE_MIN = 20;
const MASS_DEACTIVATE_RATIO = 0.1;

// Test copies of real users (TESTP230219, TESTL260410, ...) live in project
// OMEGA but are never in the Nexus roster. They stay as they are until they
// are switched off on purpose, so the sync never deactivates them.
export const TEST_NIP_PREFIX = "TEST";
export const isTestNip = (nip: string) => nip.toUpperCase().startsWith(TEST_NIP_PREFIX);

export interface OmegaEmployeeZone {
  code: string;
  name: string;
  type: string;
  project: string;
}

export interface OmegaEmployee {
  nip: string;
  nama: string;
  position: string;
  zones?: OmegaEmployeeZone[];
}

export interface OmegaSubordinate {
  nip: string;
  nama: string;
  project: string;
  position: string;
}

export type OmegaChangeKind = "CREATE" | "UPDATE" | "REACTIVATE" | "ATASAN" | "DEACTIVATE" | "SKIP_PROTECTED";

export interface OmegaChange {
  kind: OmegaChangeKind;
  nip: string;
  name: string;
  role: string;
  detail: string;
}

export interface OmegaSyncOptions {
  dryRun?: boolean;
  allowMassDeactivate?: boolean;
}

export interface OmegaSyncResult {
  employees: number;
  created: number;
  updated: number;
  reactivated: number;
  hierarchyUpdated: number;
  deactivated: number;
  skippedProtected: number;
  /** OMEGA users with a TEST nip, left untouched. */
  skippedTest: number;
  /** Set when the mass-deactivation guard tripped (dry run only; a real run throws). */
  blocked: string | null;
  changes: OmegaChange[];
  /** Every user this sync creates, changes or deactivates, as it leaves them. */
  userOverrides: ChainUserOverride[];
  errors: string[];
}

function mapPositionToRoleAndJabatan(position: string): { role: Role; jabatan: string | null } {
  const normalized = position.trim();
  switch (normalized) {
    case "National Sales Manager":
      return { role: "NSM", jabatan: "NSM" };
    case "Sales Manager":
      return { role: "SM", jabatan: "SM" };
    case "Area Sales Manager":
      return { role: "ASM", jabatan: "ASM" };
    case "Supervisor":
      return { role: "MR", jabatan: "SPV" };
    case "Field Force":
    default:
      return { role: "MR", jabatan: "Field Force" };
  }
}

async function fetchNexus<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${NEXUS_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

async function fetchSubordinates(nip: string, headers: Record<string, string>): Promise<OmegaSubordinate[]> {
  const path = `/get_subordinates?nip=${encodeURIComponent(nip)}`;
  let json: { data?: { subordinates?: OmegaSubordinate[] } };
  try {
    json = await fetchNexus(path, headers);
  } catch {
    json = await fetchNexus(path, headers); // one retry
  }
  return json.data?.subordinates || [];
}

type ExistingUser = {
  nip: string;
  name: string;
  role: Role;
  jabatan: string | null;
  project: string | null;
  kodeWilayah: string | null;
  namaWilayah: string | null;
  isActive: boolean;
  isDummy: boolean;
  nipAtasan: string | null;
};

export async function runOmegaUserSync({ dryRun = false, allowMassDeactivate = false }: OmegaSyncOptions = {}): Promise<OmegaSyncResult> {
  const headers = nexusAuthHeaders();
  if (!headers.Authorization) throw new Error("NEXUS_API_USERNAME / NEXUS_API_PASSWORD are not set.");

  const result: OmegaSyncResult = {
    employees: 0,
    created: 0,
    updated: 0,
    reactivated: 0,
    hierarchyUpdated: 0,
    deactivated: 0,
    skippedProtected: 0,
    skippedTest: 0,
    blocked: null,
    changes: [],
    userOverrides: [],
    errors: [],
  };

  // 1. Employees
  const empJson = await fetchNexus<{ data?: { employees?: OmegaEmployee[] } }>("/get_employees?project=omega", headers);
  const employeeByNip = new Map<string, OmegaEmployee>();
  for (const e of empJson.data?.employees || []) {
    const nip = e.nip?.trim();
    if (nip) employeeByNip.set(nip, { ...e, nip, nama: (e.nama || "").trim() });
  }
  const employees = [...employeeByNip.values()];
  result.employees = employees.length;
  if (employees.length === 0) throw new Error("Nexus returned no omega employees; refusing to sync.");

  const existing: ExistingUser[] = await prisma.user.findMany({
    where: { OR: [{ nip: { in: [...employeeByNip.keys()] } }, { project: "OMEGA" }] },
    select: {
      nip: true,
      name: true,
      role: true,
      jabatan: true,
      project: true,
      kodeWilayah: true,
      namaWilayah: true,
      isActive: true,
      isDummy: true,
      nipAtasan: true,
    },
  });
  const existingByNip = new Map(existing.map((u) => [u.nip, u]));

  // 2. Users to upsert (field roles only)
  type Desired = { nip: string; name: string; role: Role; jabatan: string | null; kodeWilayah: string | null; namaWilayah: string | null };
  const upserts: { desired: Desired; existing: ExistingUser | undefined }[] = [];
  for (const emp of employees) {
    const current = existingByNip.get(emp.nip);
    if (current && !FIELD_ROLES.includes(current.role)) {
      result.skippedProtected++;
      result.changes.push({ kind: "SKIP_PROTECTED", nip: emp.nip, name: current.name, role: current.role, detail: `role ${current.role} tidak diubah (Nexus: ${emp.position})` });
      continue;
    }
    const { role, jabatan } = mapPositionToRoleAndJabatan(emp.position || "");
    const zone = emp.zones?.find((z) => z.type === "territory") || emp.zones?.[0];
    const desired: Desired = { nip: emp.nip, name: emp.nama, role, jabatan, kodeWilayah: zone?.code || null, namaWilayah: zone?.name || null };
    upserts.push({ desired, existing: current });

    if (!current) {
      result.created++;
      result.changes.push({ kind: "CREATE", nip: emp.nip, name: emp.nama, role, detail: `user baru (${emp.position})` });
      continue;
    }
    const diffs: string[] = [];
    if (current.name !== desired.name) diffs.push(`nama ${current.name} → ${desired.name}`);
    if (current.role !== desired.role) diffs.push(`role ${current.role} → ${desired.role}`);
    if (current.jabatan !== desired.jabatan) diffs.push(`jabatan ${current.jabatan ?? "-"} → ${desired.jabatan ?? "-"}`);
    if (current.project !== "OMEGA") diffs.push(`project ${current.project ?? "-"} → OMEGA`);
    if (current.kodeWilayah !== desired.kodeWilayah) diffs.push(`wilayah ${current.kodeWilayah ?? "-"} → ${desired.kodeWilayah ?? "-"}`);
    if (!current.isActive) {
      result.reactivated++;
      result.changes.push({ kind: "REACTIVATE", nip: emp.nip, name: emp.nama, role, detail: ["diaktifkan lagi", ...diffs].join("; ") });
    } else if (diffs.length > 0) {
      result.updated++;
      result.changes.push({ kind: "UPDATE", nip: emp.nip, name: emp.nama, role, detail: diffs.join("; ") });
    }
  }
  const syncable = new Map(upserts.map((u) => [u.desired.nip, u.desired]));

  // 3. Atasan, strictly by tier: NSM sets its whole downline, SM overrides its
  // downline, ASM overrides its direct MRs. A failed fetch would leave part of
  // a tier unapplied (MRs of that ASM would end up under the SM), so on any
  // failure the whole hierarchy pass is skipped and existing atasan are kept.
  const desiredAtasan = new Map<string, { nip: string; name: string }>();
  let hierarchyFailed = false;
  for (const position of ["National Sales Manager", "Sales Manager", "Area Sales Manager"]) {
    const managers = employees.filter((e) => e.position === position);
    for (let i = 0; i < managers.length && !hierarchyFailed; i += SUBORDINATE_BATCH) {
      const batch = managers.slice(i, i + SUBORDINATE_BATCH);
      const fetched = await Promise.all(
        batch.map(async (mgr) => {
          try {
            return { mgr, subs: await fetchSubordinates(mgr.nip, headers) };
          } catch (err) {
            result.errors.push(`get_subordinates ${mgr.nip} (${mgr.nama}): ${err instanceof Error ? err.message : String(err)}`);
            hierarchyFailed = true;
            return null;
          }
        })
      );
      for (const f of fetched) {
        if (!f) continue;
        for (const sub of f.subs) {
          const nip = sub.nip?.trim();
          if (nip && nip !== f.mgr.nip && syncable.has(nip)) desiredAtasan.set(nip, { nip: f.mgr.nip, name: f.mgr.nama });
        }
      }
    }
    if (hierarchyFailed) break;
  }

  const atasanUpdates: { nip: string; atasan: { nip: string; name: string } }[] = [];
  if (hierarchyFailed) {
    result.errors.push("Hierarchy pass skipped: existing atasan kept because a get_subordinates call failed.");
  } else {
    for (const [nip, atasan] of desiredAtasan) {
      const current = existingByNip.get(nip);
      if (current?.nipAtasan === atasan.nip) continue;
      atasanUpdates.push({ nip, atasan });
      const desired = syncable.get(nip);
      result.changes.push({ kind: "ATASAN", nip, name: desired?.name ?? nip, role: desired?.role ?? "", detail: `atasan ${current?.nipAtasan ?? "-"} → ${atasan.nip} (${atasan.name})` });
    }
    result.hierarchyUpdated = atasanUpdates.length;
  }

  // 4. Deactivate OMEGA field users that Nexus no longer lists (never dummies,
  // TEST accounts or non-field roles such as VIEWER).
  const testAccounts = existing.filter((u) => u.project === "OMEGA" && isTestNip(u.nip));
  result.skippedTest = testAccounts.length;
  const inScopeActive = existing.filter(
    (u) => u.project === "OMEGA" && FIELD_ROLES.includes(u.role) && !u.isDummy && !isTestNip(u.nip) && u.isActive
  );
  const toDeactivate = inScopeActive.filter((u) => !employeeByNip.has(u.nip));
  for (const u of toDeactivate) {
    result.changes.push({ kind: "DEACTIVATE", nip: u.nip, name: u.name, role: u.role, detail: "tidak ada di get_employees?project=omega" });
  }
  result.deactivated = toDeactivate.length;

  const limit = Math.max(MASS_DEACTIVATE_MIN, Math.ceil(inScopeActive.length * MASS_DEACTIVATE_RATIO));
  if (toDeactivate.length > limit && !allowMassDeactivate) {
    const message =
      `Would deactivate ${toDeactivate.length} of ${inScopeActive.length} active OMEGA users (limit ${limit}). ` +
      `Check the list, then re-run with --allow-mass-deactivate if it is correct.`;
    if (!dryRun) throw new Error(`Refusing to sync, nothing was written. ${message}`);
    result.blocked = message;
  }

  const overrides = new Map<string, ChainUserOverride>();
  for (const { desired } of upserts) {
    overrides.set(desired.nip, { nip: desired.nip, name: desired.name, role: desired.role, isActive: true, project: "OMEGA" });
  }
  for (const { nip, atasan } of atasanUpdates) overrides.set(nip, { ...overrides.get(nip), nip, nipAtasan: atasan.nip });
  for (const u of toDeactivate) overrides.set(u.nip, { nip: u.nip, isActive: false });
  result.userOverrides = [...overrides.values()];

  if (dryRun) return result;

  // 5. Write
  const now = new Date();
  for (const { desired } of upserts) {
    const data = {
      name: desired.name,
      role: desired.role,
      jabatan: desired.jabatan,
      project: "OMEGA",
      kodeWilayah: desired.kodeWilayah,
      namaWilayah: desired.namaWilayah,
      isActive: true,
      syncedAt: now,
    };
    try {
      await prisma.user.upsert({ where: { nip: desired.nip }, create: { nip: desired.nip, ...data }, update: data });
    } catch (err) {
      result.errors.push(`Upsert NIP ${desired.nip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const { nip, atasan } of atasanUpdates) {
    try {
      await prisma.user.update({ where: { nip }, data: { nipAtasan: atasan.nip, namaAtasan: atasan.name } });
    } catch (err) {
      result.errors.push(`Atasan NIP ${nip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (toDeactivate.length > 0) {
    await prisma.user.updateMany({ where: { nip: { in: toDeactivate.map((u) => u.nip) }, isActive: true }, data: { isActive: false } });
  }

  return result;
}
