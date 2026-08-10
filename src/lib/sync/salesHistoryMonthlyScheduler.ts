/**
 * In-process daily scheduler for runSalesHistoryMonthlySync (OutletSalesMonthly,
 * feeds Summary's per-produk "Sales" column — see docs/summary-ringkasan/01-business-rules.md
 * and docs/form-poa/02-data-model.md §"Sync sources"). Unlike sales-history and
 * sales-value-monthly, this sync has no external-cron-triggered HTTP endpoint —
 * this fires it automatically from inside the running server instead, no ops
 * setup required. Runs once at 00:00 WIB, then every 24h.
 *
 * globalThis guard prevents duplicate intervals if register() runs more than
 * once in the same process (e.g. dev-mode reloads).
 */

import { runSalesHistoryMonthlySync } from "./salesHistoryMonthlySync";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function msUntilNextWibMidnight(): number {
  const now = new Date();
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  const nextMidnightWibClock = Date.UTC(
    wibNow.getUTCFullYear(),
    wibNow.getUTCMonth(),
    wibNow.getUTCDate() + 1,
    0, 0, 0, 0
  );
  const nextMidnightUtcInstant = nextMidnightWibClock - WIB_OFFSET_MS;
  return nextMidnightUtcInstant - now.getTime();
}

async function runOnce() {
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) {
    console.error("[scheduler] sales-history-monthly skipped: MSSQL_CONNECTION_STRING not configured");
    return;
  }
  try {
    const result = await runSalesHistoryMonthlySync(connectionString);
    console.log(
      `[scheduler] sales-history-monthly done — upserted ${result.upserted} rows (${result.periodeFrom}–${result.periodeTo})` +
      (result.errors.length > 0 ? `, errors: ${result.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error("[scheduler] sales-history-monthly failed:", err);
  }
}

declare global {
  var __salesHistoryMonthlySchedulerStarted: boolean | undefined;
}

export function scheduleSalesHistoryMonthlySync() {
  if (globalThis.__salesHistoryMonthlySchedulerStarted) return;
  globalThis.__salesHistoryMonthlySchedulerStarted = true;

  const delay = msUntilNextWibMidnight();
  console.log(`[scheduler] sales-history-monthly: next run in ${Math.round(delay / 60000)} min (00:00 WIB)`);

  setTimeout(function fireAndReschedule() {
    void runOnce();
    setInterval(runOnce, ONE_DAY_MS);
  }, delay);
}
