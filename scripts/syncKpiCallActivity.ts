/**
 * Run: npx tsx scripts/syncKpiCallActivity.ts [period]
 * Manual trigger for the KPI Monitoring Call Activity sync (see
 * src/lib/sync/kpiCallActivitySync.ts) — no automatic schedule. `period` is
 * optional, "YYYY-MM", defaults to the current month.
 */

import "dotenv/config";
import { runKpiCallActivitySync } from "../src/lib/sync/kpiCallActivitySync";

const period = process.argv[2];

console.log(`Starting KPI call activity sync${period ? ` for ${period}` : " (current month)"}...`);
runKpiCallActivitySync(period).then((result) => {
  console.log(`Done. Period: ${result.period}`);
  console.log(`Scanned: ${result.scanned}, updated: ${result.updated}, skipped (manual): ${result.skippedManual}, no data: ${result.noData}`);
  if (result.errors.length > 0) console.error("Errors:", result.errors);
  process.exit(0);
}).catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
