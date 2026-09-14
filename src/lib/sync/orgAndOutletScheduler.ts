/**
 * In-process daily scheduler for the org-structure → outlet → outlet-coverage
 * → vacant-territory-coverage → pending-approval-holder sync chain
 * (runOrgSync, then runOutletSync, then runOutletCoverageSync, then
 * runVacantTerritoryCoverageSync, then runPendingApprovalHolderSync — order
 * matters for the first three: outlet sync reads its NIP list from `User`,
 * which org sync populates/refreshes; outlet-coverage sync reads both `User`
 * and `MrOutletAssignment`, which the first two steps just refreshed.
 * vacant-territory-coverage (MSSQL-only, skipped rather than aborting the
 * chain if unconfigured) and pending-approval-holder sync don't depend on
 * each other or on being in this exact order, just kept sequential for
 * simplicity, same "sequential, skip rest on failure" chain as the others;
 * see each step's own module doc comment). The first two previously had only an
 * external-cron-triggered HTTP endpoint (/api/sync/org-structure,
 * /api/sync/outlet) whose actual schedule lives outside this repo — this
 * fires them automatically from inside the running server instead, same
 * self-contained pattern as salesHistoryMonthlyScheduler.ts (2026-09-02 user
 * request). Runs once at 00:00 WIB, then every 24h.
 *
 * If an earlier step fails, later steps are skipped this run (would read
 * stale/incomplete data otherwise) — next day's run tries all three again.
 *
 * globalThis guard prevents duplicate intervals if register() runs more than
 * once in the same process (e.g. dev-mode reloads). A SyncLock row (see
 * syncLock.ts) additionally guards across replicas.
 */

import { runOrgSync } from "./orgStructureSync";
import { runOutletSync } from "./outletSync";
import { runOutletCoverageSync } from "./outletCoverageSync";
import { runVacantTerritoryCoverageSync } from "./vacantTerritoryCoverageSync";
import { runPendingApprovalHolderSync } from "./pendingApprovalHolderSync";
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
    console.error("[scheduler] outlet sync failed, skipping outlet-coverage sync this run:", err);
    return;
  }

  try {
    const coverageResult = await runOutletCoverageSync();
    console.log(
      `[scheduler] outlet-coverage done — ${coverageResult.outletsConsidered} outlet(s) considered, ` +
      `${coverageResult.outletsUpdated} updated, ${coverageResult.outletsUnresolved} unresolved`
    );
  } catch (err) {
    console.error("[scheduler] outlet-coverage sync failed, skipping pending-approval-holder sync this run:", err);
    return;
  }

  // Optional (needs MSSQL, unlike the Postgres-only steps above) — skipped
  // rather than aborting the rest of the chain if unconfigured/failing, same
  // tolerant pattern as salesHistoryMonthlyScheduler.ts.
  const mssqlConnectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!mssqlConnectionString) {
    console.log("[scheduler] vacant-territory-coverage skipped: MSSQL_CONNECTION_STRING not configured");
  } else {
    try {
      const vacantResult = await runVacantTerritoryCoverageSync(mssqlConnectionString);
      console.log(
        `[scheduler] vacant-territory-coverage done — ${vacantResult.rowsConsidered} row(s) considered, ` +
        `${vacantResult.outletsUpdated} updated` +
        (vacantResult.errors.length > 0 ? `, errors: ${vacantResult.errors.join("; ")}` : "")
      );
    } catch (err) {
      console.error("[scheduler] vacant-territory-coverage sync failed:", err);
    }
  }

  try {
    const holderResult = await runPendingApprovalHolderSync();
    console.log(
      `[scheduler] pending-approval-holder done — ${holderResult.doctorsConsidered} doctor(s) considered, ` +
      `${holderResult.doctorsUpdated} updated, ${holderResult.doctorsUnresolved} unresolved`
    );
  } catch (err) {
    console.error("[scheduler] pending-approval-holder sync failed:", err);
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
