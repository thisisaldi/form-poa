/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * Used here to start the in-process daily schedulers for OutletSalesMonthly
 * sync (see salesHistoryMonthlyScheduler.ts), OutletSalesValueMonthly sync
 * (see outletSalesValueMonthlyScheduler.ts — added 2026-09-08 after its
 * external-cron trigger silently stopped firing), and the org-structure/
 * outlet sync pair (see orgAndOutletScheduler.ts) — no external cron needed
 * for any of these.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleSalesHistoryMonthlySync } = await import("./lib/sync/salesHistoryMonthlyScheduler");
    scheduleSalesHistoryMonthlySync();

    const { scheduleOutletSalesValueMonthlySync } = await import("./lib/sync/outletSalesValueMonthlyScheduler");
    scheduleOutletSalesValueMonthlySync();

    const { scheduleOrgAndOutletSync } = await import("./lib/sync/orgAndOutletScheduler");
    scheduleOrgAndOutletSync();
  }
}
