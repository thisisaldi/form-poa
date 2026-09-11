/**
 * Standalone sync script — run via: npx tsx scripts/syncPendingApprovalHolders.ts
 *
 * Manually triggers runPendingApprovalHolderSync (see its own doc comment in
 * src/lib/sync/pendingApprovalHolderSync.ts) — fixes already-stale
 * PoaDoctorApproval.currentHolderId rows right now, instead of waiting for
 * the next scheduled midnight run (orgAndOutletScheduler.ts).
 */
import "dotenv/config";
import { runPendingApprovalHolderSync } from "../src/lib/sync/pendingApprovalHolderSync";
import { prisma } from "../src/lib/prisma";

async function main() {
  const result = await runPendingApprovalHolderSync();
  console.log(
    `Considered: ${result.doctorsConsidered}, updated: ${result.doctorsUpdated}, unresolved: ${result.doctorsUnresolved}`
  );
}

main()
  .catch((err) => {
    console.error("Sync script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
