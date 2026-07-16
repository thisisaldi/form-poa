/**
 * Run: npx tsx scripts/syncSalesHistoryMonthly.ts
 * Syncs DIR10001B monthly sales (last 12 completed months) into OutletSalesMonthly.
 * Feeds the quarterly target calculation engine (src/lib/targetCalculation.ts).
 */

import "dotenv/config";
import { runSalesHistoryMonthlySync } from "../src/lib/sync/salesHistoryMonthlySync";

const connectionString = process.env.MSSQL_CONNECTION_STRING;
if (!connectionString) {
  console.error("MSSQL_CONNECTION_STRING not set");
  process.exit(1);
}

console.log("Starting monthly sales history sync...");
runSalesHistoryMonthlySync(connectionString).then((result) => {
  console.log(`Done. Upserted: ${result.upserted} rows`);
  console.log(`Period: ${result.periodeFrom} – ${result.periodeTo}`);
  if (result.errors.length > 0) console.error("Errors:", result.errors);
  process.exit(0);
}).catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
