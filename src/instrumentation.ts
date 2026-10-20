/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * Starts every in-process daily sync job (org-structure/outlet chain, sales
 * value Hospital + OMG1, sales history, PSSP pelunasan) — registry, runner and
 * scheduler live in src/lib/sync/jobs.ts; each run is recorded in SyncRun and
 * visible under Admin → Scheduler (docs/scheduler-monitor/). No external cron
 * needed for any of these.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleAllJobs } = await import("./lib/sync/jobs");
    scheduleAllJobs();
  }
}
