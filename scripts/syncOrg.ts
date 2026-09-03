/**
 * Standalone sync script — run via: npx tsx scripts/syncOrg.ts
 *
 * Syncs org structure (users + hierarchy) then outlet master data + MR assignments —
 * both from Nexus API now (docs/org-nexus-migration/, docs/outlet-nexus-migration/).
 * Reads env vars from .env file via dotenv.
 * Run order matters: outlet sync reads the NIP list from `User`, so org sync must run first.
 */

import "dotenv/config";
import { runOrgSync } from "../src/lib/sync/orgStructureSync";
import { runOutletSync } from "../src/lib/sync/outletSync";
import { prisma } from "../src/lib/prisma";

async function main() {
  // Step 1: org structure (users + hierarchy)
  console.log("\n[1/2] Syncing org structure...");
  const orgResult = await runOrgSync();
  console.log(`  ✓ Upserted: ${orgResult.upserted} users, deactivated: ${orgResult.deactivated}`);
  if (orgResult.errors.length > 0) {
    console.warn(`  ⚠ Errors (${orgResult.errors.length}):`, orgResult.errors.slice(0, 5));
  }

  // Step 2: outlets + MR assignments, from Nexus API (requires users to exist)
  console.log("\n[2/2] Syncing outlets + MR assignments from Nexus...");
  const outletResult = await runOutletSync();
  console.log(
    `  ✓ NIPs iterated: ${outletResult.nipsIterated} (${outletResult.nipsFailed} failed, ` +
      `${outletResult.nipsSkippedNoTerritory} skipped/no-territory), ` +
      `outlets upserted: ${outletResult.outletsUpserted}, assignments: ${outletResult.assignmentsReplaced}`
  );
  if (outletResult.errors.length > 0) {
    console.warn(`  ⚠ Errors (${outletResult.errors.length}):`, outletResult.errors.slice(0, 5));
  }

  const hasErrors = orgResult.errors.length > 0 || outletResult.errors.length > 0;
  console.log(hasErrors ? "\nSync completed with warnings." : "\nSync completed successfully.");
  process.exit(hasErrors ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("Sync script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
