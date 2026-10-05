/**
 * In-process daily scheduler for runOmegaSalesValueMonthlySync
 * (OutletSalesValueMonthlyOmega — Non-Hospital sales, DIR10001B DIVISI 'OMG1').
 * Same pattern as outletSalesValueMonthlyScheduler.ts (Hospital twin): once at
 * 00:00 WIB, then every 24h, cross-replica mutex via acquireSyncLock. Added
 * 2026-10-05 — until then this sync was manual-only
 * (scripts/syncOmegaSalesValueMonthly.ts) and the table stopped at the last
 * month someone ran it.
 */

import { runOmegaSalesValueMonthlySync } from "./omegaSalesValueMonthlySync";
import { acquireSyncLock } from "./syncLock";
import { msUntilNextWibMidnight } from "./salesHistoryMonthlyScheduler";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "omega-sales-value-monthly";
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

async function runOnce() {
  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) {
    console.error("[scheduler] omega-sales-value-monthly skipped: MSSQL_CONNECTION_STRING not configured");
    return;
  }
  const gotLock = await acquireSyncLock(LOCK_KEY, LOCK_STALE_AFTER_MS);
  if (!gotLock) {
    console.log("[scheduler] omega-sales-value-monthly skipped: another replica already holds the lock");
    return;
  }
  try {
    const result = await runOmegaSalesValueMonthlySync(connectionString);
    console.log(`[scheduler] omega-sales-value-monthly done — upserted ${result.upserted} rows (${result.periodeFrom}–${result.periodeTo})`);
  } catch (err) {
    console.error("[scheduler] omega-sales-value-monthly failed:", err);
  }
}

declare global {
  var __omegaSalesValueMonthlySchedulerStarted: boolean | undefined;
}

export function scheduleOmegaSalesValueMonthlySync() {
  if (globalThis.__omegaSalesValueMonthlySchedulerStarted) return;
  globalThis.__omegaSalesValueMonthlySchedulerStarted = true;

  const delay = msUntilNextWibMidnight();
  console.log(`[scheduler] omega-sales-value-monthly: next run in ${Math.round(delay / 60000)} min (00:00 WIB)`);

  setTimeout(function fireAndReschedule() {
    void runOnce();
    setInterval(runOnce, ONE_DAY_MS);
  }, delay);
}
