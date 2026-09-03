/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * Used here to start the in-process daily schedulers for OutletSalesMonthly
 * sync (see salesHistoryMonthlyScheduler.ts) and the org-structure/outlet
 * sync pair (see orgAndOutletScheduler.ts) — no external cron needed for
 * either.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleSalesHistoryMonthlySync } = await import("./lib/sync/salesHistoryMonthlyScheduler");
    scheduleSalesHistoryMonthlySync();

    const { scheduleOrgAndOutletSync } = await import("./lib/sync/orgAndOutletScheduler");
    scheduleOrgAndOutletSync();
  }
}
