/**
 * Run: npx tsx scripts/syncSalesHistory.ts
 * Syncs DIR10001B sales history (last 12 months) into OutletSalesHistory table.
 */

import "dotenv/config";
import { runSalesHistorySync } from "../src/lib/sync/salesHistorySync";

const connectionString = process.env.MSSQL_CONNECTION_STRING;
if (!connectionString) {
  console.error("MSSQL_CONNECTION_STRING not set");
  process.exit(1);
}

console.log("Starting sales history sync...");
runSalesHistorySync(connectionString).then((result) => {
  console.log(`Done. Upserted: ${result.upserted} rows`);
  console.log(`Period: ${result.periodeFrom} – ${result.periodeTo}`);
  if (result.errors.length > 0) console.error("Errors:", result.errors);
  process.exit(0);
}).catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
