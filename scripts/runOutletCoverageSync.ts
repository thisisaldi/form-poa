/**
 * One-off manual trigger for runOutletCoverageSync — same function the daily
 * scheduler (orgAndOutletScheduler.ts) calls automatically after org+outlet
 * sync. Run this directly when you don't want to wait for the next 00:00 WIB
 * cycle (e.g. right after deploying the fix, to unblock affected ASMs today).
 * Run: npx tsx scripts/runOutletCoverageSync.ts
 */
import { prisma } from "../src/lib/prisma";
import { runOutletCoverageSync } from "../src/lib/sync/outletCoverageSync";

async function main() {
  const result = await runOutletCoverageSync();
  console.log(result);
  await prisma.$disconnect();
}
main();
