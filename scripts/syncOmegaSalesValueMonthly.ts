/**
 * Run: npx tsx scripts/syncOmegaSalesValueMonthly.ts
 * Manual trigger for the Non-Hospital (OMG1) monthly sales sync — see
 * src/lib/sync/omegaSalesValueMonthlySync.ts. Also runs daily in-process (omegaSalesValueMonthlyScheduler.ts); this is for a manual catch-up.
 */
import "dotenv/config";
import { runOmegaSalesValueMonthlySync } from "../src/lib/sync/omegaSalesValueMonthlySync";

const cs = process.env.MSSQL_CONNECTION_STRING;
if (!cs) {
  console.error("MSSQL_CONNECTION_STRING not configured");
  process.exit(1);
}
console.log("Syncing OMG1 monthly sales (can take a few minutes)...");
runOmegaSalesValueMonthlySync(cs)
  .then((r) => {
    console.log(`Done. ${r.upserted} rows upserted (${r.periodeFrom}..${r.periodeTo}).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
