/**
 * In-process daily scheduler for runPsspLunasSync (PsspKontrak.totalLunas ←
 * Exodus settlements). Same pattern as omegaSalesValueMonthlyScheduler.ts:
 * once at 00:00 WIB, then every 24h, cross-replica mutex via acquireSyncLock.
 * One run takes ~20 min (348 nips × 12-20s, 5 in parallel). Added 2026-10-20.
 */

import { runPsspLunasSync } from "./psspLunasSync";
import { acquireSyncLock } from "./syncLock";
import { msUntilNextWibMidnight } from "./salesHistoryMonthlyScheduler";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "pssp-lunas";
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

async function runOnce() {
  const gotLock = await acquireSyncLock(LOCK_KEY, LOCK_STALE_AFTER_MS);
  if (!gotLock) {
    console.log("[scheduler] pssp-lunas skipped: another replica already holds the lock");
    return;
  }
  try {
    const r = await runPsspLunasSync({ apply: true });
    console.log(`[scheduler] pssp-lunas done — ${r.nips - r.failedNips}/${r.nips} nips answered, ${r.changedContracts}/${r.matchedContracts} contracts changed (${r.changedRows} rows)`);
  } catch (err) {
    console.error("[scheduler] pssp-lunas failed:", err);
  }
}

declare global {
  var __psspLunasSchedulerStarted: boolean | undefined;
}

export function schedulePsspLunasSync() {
  if (globalThis.__psspLunasSchedulerStarted) return;
  globalThis.__psspLunasSchedulerStarted = true;

  const delay = msUntilNextWibMidnight();
  console.log(`[scheduler] pssp-lunas: next run in ${Math.round(delay / 60000)} min (00:00 WIB)`);

  setTimeout(function fireAndReschedule() {
    void runOnce();
    setInterval(runOnce, ONE_DAY_MS);
  }, delay);
}
