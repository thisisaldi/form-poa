/**
 * Syncs project OMEGA users and hierarchy from Nexus (src/lib/sync/omegaUserSync.ts),
 * then re-points pending SC forms of OMEGA owners at their new atasan
 * (src/lib/sync/scHolderReassign.ts). The dry run resolves holders against the
 * org as the sync would leave it, so both reports match what a real run does.
 *
 * Run: npm run sync:omega -- [flags]
 *   --dry-run                 compute only, write nothing
 *   --allow-mass-deactivate   allow deactivating more than max(20, 10%) of active OMEGA users
 *   --out=<dir>               where the two CSVs go (default: ~/Downloads)
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isTestNip, runOmegaUserSync } from "../src/lib/sync/omegaUserSync";
import { runScHolderReassign } from "../src/lib/sync/scHolderReassign";
import { prisma } from "../src/lib/prisma";

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv<T>(path: string, columns: readonly (keyof T & string)[], rows: T[]): void {
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))];
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

async function main() {
  const dryRun = flag("dry-run") !== undefined;
  const allowMassDeactivate = flag("allow-mass-deactivate") !== undefined;
  const dir = flag("out") || join(homedir(), "Downloads");
  mkdirSync(dir, { recursive: true });
  const stamp = `${dryRun ? "dry-run-" : ""}${Date.now()}`;
  console.log(`=== Sync OMEGA users + SC holders${dryRun ? " [dry-run]" : ""} ===`);

  // 1. Users
  const sync = await runOmegaUserSync({ dryRun, allowMassDeactivate });
  const usersCsv = join(dir, `omega-users-${stamp}.csv`);
  writeCsv(usersCsv, ["kind", "nip", "name", "role", "detail"], sync.changes);

  console.log(`\nUsers`);
  console.log(`  Nexus employees:        ${sync.employees}`);
  console.log(`  New users:              ${sync.created}`);
  console.log(`  Updated users:          ${sync.updated}`);
  console.log(`  Reactivated:            ${sync.reactivated}`);
  console.log(`  Atasan changed:         ${sync.hierarchyUpdated}`);
  console.log(`  Deactivated:            ${sync.deactivated}`);
  console.log(`  Skipped (VIEWER/other): ${sync.skippedProtected}`);
  console.log(`  Skipped (TEST nip):     ${sync.skippedTest}`);
  console.log(`  CSV: ${usersCsv}`);
  if (sync.blocked) console.warn(`  ⚠ A real run would be refused: ${sync.blocked}`);
  if (sync.errors.length > 0) {
    console.warn(`  ⚠ ${sync.errors.length} error(s):`);
    for (const e of sync.errors.slice(0, 20)) console.warn(`    - ${e}`);
  }

  // 2. Pending SC forms of OMEGA owners
  const reassign = await runScHolderReassign({
    dryRun,
    project: "OMEGA",
    skipOwner: isTestNip,
    userOverrides: dryRun ? sync.userOverrides : undefined,
  });
  const formsCsv = join(dir, `omega-sc-holders-${stamp}.csv`);
  writeCsv(
    formsCsv,
    ["outcome", "formId", "period", "kodePI", "namaOutlet", "status", "ownerId", "ownerName", "ownerActive", "oldHolderId", "oldHolderName", "newHolderId", "newHolderName", "reason"],
    reassign.changes
  );

  console.log(`\nPending SC forms (OMEGA owners)`);
  console.log(`  Checked:                ${reassign.checked}`);
  console.log(`  Already correct:        ${reassign.unchanged}`);
  console.log(`  ${dryRun ? "Would move:  " : "Moved:       "}           ${reassign.moved}`);
  console.log(`    of which escalated:   ${reassign.escalated}`);
  console.log(`  Skipped (no target):    ${reassign.skipped}`);
  console.log(`  Skipped (TEST owner):   ${reassign.skippedOwners}`);
  console.log(`  CSV: ${formsCsv}`);

  console.log(dryRun ? "\nDry run: nothing written." : "\nDone.");
}

main()
  .catch((err) => {
    console.error("Sync failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
