/**
 * Run: npx tsx scripts/syncOutletSalesValueMonthly.ts
 * Syncs DIR10001B outlet-level monthly Rupiah sales value (full previous
 * year through the current year's last completed month) into
 * OutletSalesValueMonthly. Feeds the Detail POA page's "Data Sales" card.
 */

import "dotenv/config";
import { runOutletSalesValueMonthlySync } from "../src/lib/sync/outletSalesValueMonthlySync";

const connectionString = process.env.MSSQL_CONNECTION_STRING;
if (!connectionString) {
  console.error("MSSQL_CONNECTION_STRING not set");
  process.exit(1);
}

console.log("Starting outlet sales value monthly sync...");
runOutletSalesValueMonthlySync(connectionString).then((result) => {
  console.log(`Done. Upserted: ${result.upserted} rows`);
  console.log(`Period: ${result.periodeFrom} – ${result.periodeTo}`);
  if (result.errors.length > 0) console.error("Errors:", result.errors);
  process.exit(0);
}).catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
