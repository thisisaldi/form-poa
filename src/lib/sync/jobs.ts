/**
 * Every in-process scheduled job, one runner, one scheduler — docs/scheduler-monitor/.
 * Replaces the five per-job *Scheduler.ts files (2026-10-20); each job's sync
 * logic is unchanged, only the run bookkeeping moved here so every run lands
 * in SyncRun (Admin → Scheduler) instead of only console.log.
 *
 * Locks (01-business-rules.md §4):
 *  - "sched:<job>:<YYYY-MM-DD WIB>" — one replica per job per day runs the
 *    schedule; never released (the date makes it unique), purged after 90 days.
 *  - "<job>" — no two runs of the same job at once (schedule vs manual);
 *    released at the end of every run, stale after 2h if the process died.
 *
 * globalThis guard prevents duplicate timers if register() runs more than
 * once in the same process (e.g. dev-mode reloads).
 */

import { prisma } from "@/lib/prisma";
import { acquireSyncLock, releaseSyncLock } from "./syncLock";
import { runSalesHistoryMonthlySync } from "./salesHistoryMonthlySync";
import { runOutletSalesValueMonthlySync } from "./outletSalesValueMonthlySync";
import { runOmegaSalesValueMonthlySync } from "./omegaSalesValueMonthlySync";
import { runOrgSync } from "./orgStructureSync";
import { runOutletSync } from "./outletSync";
import { runOutletCoverageSync } from "./outletCoverageSync";
import { runVacantTerritoryCoverageSync } from "./vacantTerritoryCoverageSync";
import { runPendingApprovalHolderSync } from "./pendingApprovalHolderSync";
import { runOwnerHandoverSync } from "./ownerHandoverSync";
import { runPsspLunasSync } from "./psspLunasSync";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const RUN_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const RETENTION_MS = 90 * ONE_DAY_MS;

export interface JobResult { summary: string; detail?: unknown }

export interface JobDef {
  key: string;
  label: string;
  hourWib: number;
  run: () => Promise<JobResult>;
}

function mssql(): string {
  const cs = process.env.MSSQL_CONNECTION_STRING;
  if (!cs) throw new Error("MSSQL_CONNECTION_STRING not configured");
  return cs;
}

const withErrors = (s: string, errors: string[]) => (errors.length > 0 ? `${s}, ${errors.length} error: ${errors.join("; ")}` : s);

/**
 * org-structure → outlet → outlet-coverage → vacant-territory-coverage →
 * pending-approval-holder → owner-handover. Order matters for the first
 * three (outlet sync reads its NIP list from User, which org sync refreshes;
 * outlet-coverage reads both), so a failure there stops the chain. The last
 * three are independent: a failure is recorded and the chain continues, but
 * the run still ends as failed. vacant-territory is skipped without MSSQL.
 */
async function runOrgAndOutletChain(): Promise<JobResult> {
  const detail: Record<string, unknown> = {};
  const failures: string[] = [];
  const fail = (step: string, err: unknown) => `${step}: ${err instanceof Error ? err.message : String(err)}`;
  const stop = (step: string, err: unknown) => Object.assign(new Error(`${fail(step, err)} — langkah berikutnya dilewati`), { detail });

  try { detail["org-structure"] = await runOrgSync(); } catch (e) { throw stop("org-structure", e); }
  try { detail["outlet"] = await runOutletSync(); } catch (e) { throw stop("outlet", e); }
  try { detail["outlet-coverage"] = await runOutletCoverageSync(); } catch (e) { throw stop("outlet-coverage", e); }

  const cs = process.env.MSSQL_CONNECTION_STRING;
  if (!cs) detail["vacant-territory-coverage"] = "skipped: MSSQL_CONNECTION_STRING not configured";
  else try { detail["vacant-territory-coverage"] = await runVacantTerritoryCoverageSync(cs); } catch (e) { failures.push(fail("vacant-territory-coverage", e)); }
  try { detail["pending-approval-holder"] = await runPendingApprovalHolderSync(); } catch (e) { failures.push(fail("pending-approval-holder", e)); }
  try { detail["owner-handover"] = await runOwnerHandoverSync(); } catch (e) { failures.push(fail("owner-handover", e)); }

  if (failures.length > 0) throw Object.assign(new Error(failures.join("; ")), { detail });
  const org = detail["org-structure"] as Awaited<ReturnType<typeof runOrgSync>>;
  const outlet = detail["outlet"] as Awaited<ReturnType<typeof runOutletSync>>;
  return {
    summary: withErrors(`org upserted ${org.upserted}, deactivated ${org.deactivated}; outlet ${outlet.outletsUpserted} upserted, ${outlet.nipsFailed}/${outlet.nipsIterated} NIP gagal`, [...org.errors, ...outlet.errors]),
    detail,
  };
}

export const JOBS: JobDef[] = [
  { key: "org-and-outlet-daily", label: "Struktur organisasi & outlet", hourWib: 0, run: runOrgAndOutletChain },
  {
    key: "outlet-sales-value-monthly", label: "Sales value bulanan (Hospital)", hourWib: 0,
    run: async () => {
      const r = await runOutletSalesValueMonthlySync(mssql());
      return { summary: withErrors(`upserted ${r.upserted} rows (${r.periodeFrom}–${r.periodeTo})`, r.errors), detail: r };
    },
  },
  {
    key: "omega-sales-value-monthly", label: "Sales value bulanan (Non-Hospital OMG1)", hourWib: 0,
    run: async () => {
      const r = await runOmegaSalesValueMonthlySync(mssql());
      return { summary: `upserted ${r.upserted} rows (${r.periodeFrom}–${r.periodeTo})`, detail: r };
    },
  },
  {
    key: "sales-history-monthly", label: "Histori sales per produk", hourWib: 8,
    run: async () => {
      const r = await runSalesHistoryMonthlySync(mssql());
      return { summary: withErrors(`upserted ${r.upserted} rows (${r.periodeFrom}–${r.periodeTo})`, r.errors), detail: r };
    },
  },
  {
    key: "pssp-lunas", label: "Pelunasan PSSP (Exodus)", hourWib: 0,
    run: async () => {
      const r = await runPsspLunasSync({ apply: true });
      return { summary: `${r.nips - r.failedNips}/${r.nips} NIP dijawab Exodus, ${r.changedContracts}/${r.matchedContracts} kontrak berubah (${r.changedRows} baris)`, detail: r };
    },
  },
];

export function msUntilNextWib(hourWib: number, from = Date.now()): number {
  const wib = new Date(from + WIB_OFFSET_MS);
  let next = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), hourWib) - WIB_OFFSET_MS;
  if (next <= from) next += ONE_DAY_MS;
  return next - from;
}

const wibDate = () => new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);

async function execute(job: JobDef, runId: string) {
  const started = Date.now();
  try {
    const r = await job.run();
    await prisma.syncRun.update({
      where: { id: runId },
      data: { status: "success", finishedAt: new Date(), durationMs: Date.now() - started, summary: r.summary, detail: (r.detail ?? undefined) as object | undefined },
    });
    console.log(`[scheduler] ${job.key} done — ${r.summary}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = (err as { detail?: unknown })?.detail;
    await prisma.syncRun.update({
      where: { id: runId },
      data: { status: "failed", finishedAt: new Date(), durationMs: Date.now() - started, error: message.slice(0, 4000), detail: (detail ?? undefined) as object | undefined },
    }).catch((e: unknown) => console.error(`[scheduler] ${job.key}: could not record failure:`, e));
    console.error(`[scheduler] ${job.key} failed:`, err);
  } finally {
    await releaseSyncLock(job.key).catch(() => {});
  }
}

/**
 * Starts `job` if no other run of it is in progress. Returns the new SyncRun
 * id, or null when the job lock is held. The run itself is NOT awaited —
 * pssp-lunas takes ~1h, far longer than any request.
 */
export async function startJob(job: JobDef, trigger: "schedule" | "manual", triggeredBy?: string): Promise<string | null> {
  if (!(await acquireSyncLock(job.key, RUN_STALE_AFTER_MS))) return null;
  const run = await prisma.syncRun.create({ data: { job: job.key, trigger, triggeredBy: triggeredBy ?? null, status: "running" } });
  void execute(job, run.id);
  return run.id;
}

async function runScheduled(job: JobDef) {
  try {
    // 2 days: the key already carries the date, staleness never matters within it.
    if (!(await acquireSyncLock(`sched:${job.key}:${wibDate()}`, 2 * ONE_DAY_MS))) return; // another replica has today's run
    const runId = await startJob(job, "schedule");
    if (!runId) {
      await prisma.syncRun.create({ data: { job: job.key, trigger: "schedule", status: "failed", finishedAt: new Date(), durationMs: 0, error: "dilewati: run lain masih berjalan" } });
      console.log(`[scheduler] ${job.key} skipped: another run still in progress`);
    }
    const cutoff = new Date(Date.now() - RETENTION_MS);
    await prisma.syncRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: "running" } } });
    await prisma.syncLock.deleteMany({ where: { key: { startsWith: "sched:" }, lockedAt: { lt: cutoff } } });
  } catch (err) {
    console.error(`[scheduler] ${job.key} could not start:`, err);
  }
}

declare global {
  var __syncJobsSchedulerStarted: boolean | undefined;
}

export function scheduleAllJobs() {
  if (globalThis.__syncJobsSchedulerStarted) return;
  globalThis.__syncJobsSchedulerStarted = true;

  for (const job of JOBS) {
    const delay = msUntilNextWib(job.hourWib);
    console.log(`[scheduler] ${job.key}: next run in ${Math.round(delay / 60000)} min (${String(job.hourWib).padStart(2, "0")}:00 WIB)`);
    setTimeout(() => {
      void runScheduled(job);
      setInterval(() => void runScheduled(job), ONE_DAY_MS);
    }, delay);
  }
}
