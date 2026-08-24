/**
 * Run: npx tsx scripts/syncKpiAbsensi.ts [period]
 * Manual trigger for the KPI Monitoring Absensi sync (see
 * src/lib/sync/kpiAbsensiSync.ts) — normally runs automatically once daily
 * via src/lib/sync/kpiAbsensiScheduler.ts. `period` is optional, "YYYY-MM",
 * defaults to the current month.
 */

import "dotenv/config";
import { runKpiAbsensiSync } from "../src/lib/sync/kpiAbsensiSync";

const period = process.argv[2];

console.log(`Starting KPI absensi sync${period ? ` for ${period}` : " (current month)"}...`);
runKpiAbsensiSync(period).then((result) => {
  console.log(`Done. Period: ${result.period}`);
  console.log(`Scanned: ${result.scanned}, updated: ${result.updated}, skipped (manual): ${result.skippedManual}, no data: ${result.noData}`);
  if (result.errors.length > 0) console.error("Errors:", result.errors);
  process.exit(0);
}).catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
