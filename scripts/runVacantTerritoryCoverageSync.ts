/**
 * Standalone sync script — run via: npx tsx scripts/runVacantTerritoryCoverageSync.ts
 *
 * Manually triggers runVacantTerritoryCoverageSync (see its own doc comment
 * in src/lib/sync/vacantTerritoryCoverageSync.ts) — fixes already-empty
 * Outlet.coveredByNip/coveredByRole for never-filled FF+SPV territories
 * right now, instead of waiting for the next scheduled midnight run
 * (orgAndOutletScheduler.ts).
 */
import "dotenv/config";
import { runVacantTerritoryCoverageSync } from "../src/lib/sync/vacantTerritoryCoverageSync";
import { prisma } from "../src/lib/prisma";

async function main() {
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) {
    console.error("MSSQL_CONNECTION_STRING not configured.");
    process.exit(1);
  }
  const result = await runVacantTerritoryCoverageSync(connectionString);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error("Sync script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
