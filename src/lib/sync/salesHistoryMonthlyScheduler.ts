/**
 * In-process daily scheduler for runSalesHistoryMonthlySync (OutletSalesMonthly,
 * feeds Summary's per-produk "Sales" column — see docs/summary-ringkasan/01-business-rules.md
 * and docs/form-poa/02-data-model.md §"Sync sources"). Unlike sales-history and
 * sales-value-monthly, this sync has no external-cron-triggered HTTP endpoint —
 * this fires it automatically from inside the running server instead, no ops
 * setup required. Runs once at 00:00 WIB, then every 24h.
 *
 * globalThis guard prevents duplicate intervals if register() runs more than
 * once in the same process (e.g. dev-mode reloads). A SyncLock row (see
 * syncLock.ts) additionally guards across replicas — if this app is ever
 * deployed with >1 pod, every pod's scheduler fires at ~the same instant,
 * and only one of them should actually run the sync.
 */

import { runSalesHistoryMonthlySync } from "./salesHistoryMonthlySync";
import { acquireSyncLock } from "./syncLock";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "sales-history-monthly";
// Comfortably longer than one sync run (recordset upserted in 500-row
// chunks) but short enough to self-heal same-day if a replica dies mid-run.
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// Exported for reuse by other in-process daily-at-00:00-WIB schedulers
// (see orgAndOutletScheduler.ts) — same "one instant, shared by all
// schedulers" clock math, no reason to duplicate it per scheduler.
export function msUntilNextWibMidnight(): number {
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
  const gotLock = await acquireSyncLock(LOCK_KEY, LOCK_STALE_AFTER_MS);
  if (!gotLock) {
    console.log("[scheduler] sales-history-monthly skipped: another replica already holds the lock");
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
