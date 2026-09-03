/**
 * In-process daily scheduler for the org-structure → outlet sync pair
 * (runOrgSync then runOutletSync — order matters, outlet sync reads its NIP
 * list from `User`, which org sync populates/refreshes; see outletSync.ts's
 * module doc comment). Both previously had only an external-cron-triggered
 * HTTP endpoint (/api/sync/org-structure, /api/sync/outlet) whose actual
 * schedule lives outside this repo — this fires them automatically from
 * inside the running server instead, same self-contained pattern as
 * salesHistoryMonthlyScheduler.ts (2026-09-02 user request). Runs once at
 * 00:00 WIB, then every 24h.
 *
 * If org-structure fails, outlet sync is skipped this run (would read a
 * stale/incomplete User list otherwise) — next day's run tries both again.
 *
 * globalThis guard prevents duplicate intervals if register() runs more than
 * once in the same process (e.g. dev-mode reloads). A SyncLock row (see
 * syncLock.ts) additionally guards across replicas.
 */

import { runOrgSync } from "./orgStructureSync";
import { runOutletSync } from "./outletSync";
import { acquireSyncLock } from "./syncLock";
import { msUntilNextWibMidnight } from "./salesHistoryMonthlyScheduler";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = "org-and-outlet-daily";
// Comfortably longer than one org+outlet run but short enough to self-heal
// same-day if a replica dies mid-run.
const LOCK_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

async function runOnce() {
  const gotLock = await acquireSyncLock(LOCK_KEY, LOCK_STALE_AFTER_MS);
  if (!gotLock) {
    console.log("[scheduler] org-and-outlet skipped: another replica already holds the lock");
    return;
  }

  try {
    const orgResult = await runOrgSync();
    console.log(
      `[scheduler] org-structure done — upserted ${orgResult.upserted}, deactivated ${orgResult.deactivated}` +
      (orgResult.errors.length > 0 ? `, errors: ${orgResult.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error("[scheduler] org-structure failed, skipping outlet sync this run:", err);
    return;
  }

  try {
    const outletResult = await runOutletSync();
    console.log(
      `[scheduler] outlet done — ${outletResult.nipsIterated} NIP(s) iterated, ${outletResult.nipsFailed} failed, ` +
      `${outletResult.nipsSkippedNoTerritory} skipped (no territory), ${outletResult.outletsUpserted} outlets upserted, ` +
      `${outletResult.assignmentsReplaced} assignments replaced` +
      (outletResult.errors.length > 0 ? `, errors: ${outletResult.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error("[scheduler] outlet sync failed:", err);
  }
}

declare global {
  var __orgAndOutletSchedulerStarted: boolean | undefined;
}

export function scheduleOrgAndOutletSync() {
  if (globalThis.__orgAndOutletSchedulerStarted) return;
  globalThis.__orgAndOutletSchedulerStarted = true;

  const delay = msUntilNextWibMidnight();
  console.log(`[scheduler] org-and-outlet: next run in ${Math.round(delay / 60000)} min (00:00 WIB)`);

  setTimeout(function fireAndReschedule() {
    void runOnce();
    setInterval(runOnce, ONE_DAY_MS);
  }, delay);
}
