/**
 * Diagnostic (read-only, writes nothing): compares the Nexus-inferred org
 * hierarchy (src/lib/sync/orgNexusInference.ts) against the CURRENT
 * `User` table — still 100% MSSQL-sourced via orgStructureSync.ts.
 *
 * This is the "jalan paralel/dry-run dulu" step confirmed by the user
 * 2026-08-20 (OQ-5, docs/org-nexus-migration/01-business-rules.md §5) —
 * run this each sync cycle and watch the diff shrink/stabilize BEFORE
 * `orgStructureSync.ts` itself is ever pointed at Nexus. Nothing here writes
 * to Postgres.
 *
 * Run: npx tsx scripts/compareOrgNexusVsMssql.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { inferOrgHierarchyFromNexus, type InferredOrgRecord } from "../src/lib/sync/orgNexusInference";

const MANAGED_ROLES = ["MR", "ASM", "SM", "NSM"] as const;

async function main() {
  console.log("Fetching + inferring org hierarchy from Nexus (get_employees + get_subordinates)...");
  const { records, failedManagerNips } = await inferOrgHierarchyFromNexus();
  console.log(`  ${records.length} employees from Nexus, ${failedManagerNips.length} get_subordinates calls failed after retry.`);
  if (failedManagerNips.length > 0) {
    console.log(`  Failed manager NIPs (their subtree's ancestry is incomplete this run): ${failedManagerNips.join(", ")}`);
  }

  const unmappedPosition = records.filter((r) => r.role === null);
  if (unmappedPosition.length > 0) {
    console.log(`  ⚠ ${unmappedPosition.length} employee(s) have a position with no known Role mapping:`);
    for (const r of unmappedPosition.slice(0, 10)) console.log(`    ${r.nip} ${r.nama} — "${r.position}"`);
  }

  console.log("\nLoading current MSSQL-derived User table from Postgres...");
  const mssqlUsers = await prisma.user.findMany({
    where: { role: { in: MANAGED_ROLES }, isDummy: false },
    select: { nip: true, name: true, role: true, nipAtasan: true, isActive: true },
  });
  const mssqlByNip = new Map(mssqlUsers.map((u: (typeof mssqlUsers)[number]) => [u.nip, u]));
  console.log(`  ${mssqlUsers.length} users (MR/ASM/SM/NSM, non-dummy) in Postgres today.\n`);

  // ── Nexus vs Postgres, keyed by NIP present in Nexus's inference ──────────
  const nexusByNip = new Map(records.map((r) => [r.nip, r]));
  const nexusNips = new Set(records.map((r) => r.nip));

  let roleMatch = 0, roleMismatch = 0;
  let atasanMatch = 0, atasanMismatch = 0;
  const roleMismatches: { nip: string; nama: string; mssqlRole: string; nexusRole: string | null }[] = [];
  const atasanMismatches: { nip: string; nama: string; mssqlAtasan: string | null; nexusAtasan: string | null }[] = [];
  let nexusOnly = 0; // NIP known to Nexus, not yet in Postgres (candidate new hire)

  for (const rec of records) {
    if (!rec.role) continue; // already reported above as unmapped position
    const mssqlUser = mssqlByNip.get(rec.nip);
    if (!mssqlUser) { nexusOnly++; continue; }

    if (mssqlUser.role === rec.role) roleMatch++;
    else {
      roleMismatch++;
      roleMismatches.push({ nip: rec.nip, nama: rec.nama, mssqlRole: mssqlUser.role, nexusRole: rec.role });
    }

    const mssqlAtasan = mssqlUser.nipAtasan ?? null;
    const nexusAtasan = rec.inferredNipAtasan;
    if (mssqlAtasan === nexusAtasan) atasanMatch++;
    else {
      atasanMismatch++;
      atasanMismatches.push({ nip: rec.nip, nama: rec.nama, mssqlAtasan, nexusAtasan });
    }
  }

  // Active in Postgres (MSSQL) but absent from Nexus's "ethical" list entirely.
  const mssqlOnlyActive = mssqlUsers.filter((u: (typeof mssqlUsers)[number]) => u.isActive && !nexusNips.has(u.nip));

  console.log("── Role comparison (only NIPs present in BOTH Nexus and Postgres) ──");
  console.log(`  Match    : ${roleMatch}`);
  console.log(`  Mismatch : ${roleMismatch}`);
  if (roleMismatches.length > 0) {
    console.log("  Sample mismatches:");
    for (const m of roleMismatches.slice(0, 15)) {
      console.log(`    ${m.nip} ${m.nama} — MSSQL=${m.mssqlRole} Nexus=${m.nexusRole}`);
    }
  }

  console.log("\n── nipAtasan comparison (only NIPs present in BOTH Nexus and Postgres) ──");
  const atasanTotal = atasanMatch + atasanMismatch;
  console.log(`  Match    : ${atasanMatch}${atasanTotal > 0 ? ` (${(atasanMatch / atasanTotal * 100).toFixed(1)}%)` : ""}`);
  console.log(`  Mismatch : ${atasanMismatch}`);
  if (atasanMismatches.length > 0) {
    console.log("  Sample mismatches:");
    for (const m of atasanMismatches.slice(0, 20)) {
      console.log(`    ${m.nip} ${m.nama} — MSSQL atasan=${m.mssqlAtasan ?? "(none)"} Nexus atasan=${m.nexusAtasan ?? "(none)"}`);
    }
    if (atasanMismatches.length > 20) console.log(`    ...and ${atasanMismatches.length - 20} more`);
  }

  console.log("\n── Coverage gaps ──");
  console.log(`  In Nexus but not yet in Postgres (candidate new hire / not synced yet) : ${nexusOnly}`);
  console.log(`  Active in Postgres but absent from Nexus "ethical" list entirely       : ${mssqlOnlyActive.length}`);
  if (mssqlOnlyActive.length > 20) {
    // A large number here is expected once a non-"ethical" Nexus project (e.g.
    // Sales Counter/"omega", see POA_SC_CREATE) has real users in this table —
    // `User.project` isn't part of THIS branch's schema yet, so it can't be
    // queried here to break the count down further. Don't read a big number
    // as "the org sync is broken" without checking that first.
    console.log(`    (list suppressed — see this script's own comment: a large count here is`);
    console.log(`     expected if project-scoped users like Sales Counter are mixed into this table)`);
  } else if (mssqlOnlyActive.length > 0) {
    for (const u of mssqlOnlyActive as { nip: string; name: string; role: string }[]) {
      console.log(`    ${u.nip} ${u.name} (${u.role})`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
