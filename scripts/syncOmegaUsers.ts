/**
 * Standalone sync script — run via: npx tsx scripts/syncOmegaUsers.ts
 *
 * Syncs project 'omega' users and hierarchy from Nexus API endpoints:
 * 1. GET /api/r/poa/get_employees?project=omega
 * 2. GET /api/r/poa/get_subordinates?nip=<NIP>
 */

import "dotenv/config";
import { runOmegaUserSync } from "../src/lib/sync/omegaUserSync";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== Starting Sync for Project Omega Users ===");
  const result = await runOmegaUserSync();
  console.log(`✓ Upserted Users: ${result.upserted}`);
  console.log(`✓ Hierarchy Links Updated: ${result.hierarchyUpdated}`);
  console.log(`✓ Deactivated Users: ${result.deactivated}`);

  if (result.errors.length > 0) {
    console.warn(`⚠ Warnings/Errors (${result.errors.length}):`, result.errors.slice(0, 5));
  }

  console.log(result.errors.length > 0 ? "Sync completed with warnings." : "Sync completed successfully!");
}

main()
  .catch((err) => {
    console.error("Sync script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
