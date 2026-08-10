/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 * Used here to start the in-process daily scheduler for OutletSalesMonthly
 * sync (see salesHistoryMonthlyScheduler.ts) — no external cron needed.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleSalesHistoryMonthlySync } = await import("./lib/sync/salesHistoryMonthlyScheduler");
    scheduleSalesHistoryMonthlySync();
  }
}
