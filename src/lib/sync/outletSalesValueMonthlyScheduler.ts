/**
 * In-process daily scheduler for runOutletSalesValueMonthlySync
 * (OutletSalesValueMonthly, feeds KPI Monitoring's Sales Achievement pillar
 * and the Detail POA "Data Sales" card) — same pattern as
 * salesHistoryMonthlyScheduler.ts, added 2026-09-08 because this sync
 * previously relied ONLY on an external cron hitting
 * POST /api/sync/sales-value-monthly, which had silently stopped firing
 * (data stuck at periode 202606). Runs once at 00:00 WIB, then every 24h —
 * does not replace the external-cron route, just adds a self-sufficient path
 * so the app doesn't depend on ops remembering to keep that cron alive.
 */

import { runOutletSalesValueMonthlySync } from "./outletSalesValueMonthlySync";
import { acquireSyncLock } from "./syncLock";
import { msUntilNextWibMidnight } from "./salesHistoryMonthlyScheduler";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "outlet-sales-value-monthly";
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

async function runOnce() {
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) {
    console.error("[scheduler] outlet-sales-value-monthly skipped: MSSQL_CONNECTION_STRING not configured");
    return;
  }
  const gotLock = await acquireSyncLock(LOCK_KEY, LOCK_STALE_AFTER_MS);
  if (!gotLock) {
    console.log("[scheduler] outlet-sales-value-monthly skipped: another replica already holds the lock");
    return;
  }
  try {
    const result = await runOutletSalesValueMonthlySync(connectionString);
    console.log(
      `[scheduler] outlet-sales-value-monthly done — upserted ${result.upserted} rows (${result.periodeFrom}–${result.periodeTo})` +
      (result.errors.length > 0 ? `, errors: ${result.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error("[scheduler] outlet-sales-value-monthly failed:", err);
  }
}

declare global {
  var __outletSalesValueMonthlySchedulerStarted: boolean | undefined;
}

export function scheduleOutletSalesValueMonthlySync() {
  if (globalThis.__outletSalesValueMonthlySchedulerStarted) return;
  globalThis.__outletSalesValueMonthlySchedulerStarted = true;

  const delay = msUntilNextWibMidnight();
  console.log(`[scheduler] outlet-sales-value-monthly: next run in ${Math.round(delay / 60000)} min (00:00 WIB)`);

  setTimeout(function fireAndReschedule() {
    void runOnce();
    setInterval(runOnce, ONE_DAY_MS);
  }, delay);
}
