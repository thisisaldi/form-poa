"use server";

/** Admin → Scheduler (docs/scheduler-monitor/). ADMIN only, same gate as the rest of /admin. */

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { JOBS, RUN_STALE_AFTER_MS, msUntilNextWib, startJob } from "@/lib/sync/jobs";

export type RunStatus = "running" | "success" | "failed" | "abandoned";

export interface SyncRunRow {
  id: string;
  trigger: string;
  triggeredBy: string | null;
  triggeredByName: string | null;
  status: RunStatus;
  startedAt: string;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  detail: unknown;
}

export interface SchedulerJobRow {
  key: string;
  label: string;
  hourWib: number;
  nextRunAt: string;
  lastRun: SyncRunRow | null;
}

type DbRun = {
  id: string; trigger: string; triggeredBy: string | null; status: string; startedAt: Date;
  durationMs: number | null; summary: string | null; error: string | null; detail: unknown;
};

async function isAdmin() {
  const session = await getCurrentUser();
  return session?.role === "ADMIN" ? session : null;
}

async function toRows(runs: DbRun[]): Promise<SyncRunRow[]> {
  const nips = [...new Set(runs.map((r) => r.triggeredBy).filter(Boolean))] as string[];
  const users = nips.length > 0
    ? await prisma.user.findMany({ where: { nip: { in: nips } }, select: { nip: true, name: true } }) as { nip: string; name: string }[]
    : [];
  const nameByNip = new Map(users.map((u) => [u.nip, u.name]));
  const staleBefore = Date.now() - RUN_STALE_AFTER_MS;
  return runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    triggeredBy: r.triggeredBy,
    triggeredByName: r.triggeredBy ? nameByNip.get(r.triggeredBy) ?? null : null,
    // A process that died mid-run can't write its own end state — derive it.
    status: (r.status === "running" && r.startedAt.getTime() < staleBefore ? "abandoned" : r.status) as RunStatus,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    summary: r.summary,
    error: r.error,
    detail: r.detail,
  }));
}

export async function getSchedulerJobsAction(): Promise<SchedulerJobRow[]> {
  if (!(await isAdmin())) return [];
  const lastRuns = await Promise.all(JOBS.map((j) => prisma.syncRun.findFirst({ where: { job: j.key }, orderBy: { startedAt: "desc" } }) as Promise<DbRun | null>));
  const rows = await toRows(lastRuns.filter((r): r is DbRun => r != null));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();
  return JOBS.map((j, i) => ({
    key: j.key,
    label: j.label,
    hourWib: j.hourWib,
    nextRunAt: new Date(now + msUntilNextWib(j.hourWib, now)).toISOString(),
    lastRun: lastRuns[i] ? byId.get(lastRuns[i]!.id) ?? null : null,
  }));
}

export async function getSchedulerHistoryAction(jobKey: string): Promise<SyncRunRow[]> {
  if (!(await isAdmin())) return [];
  const runs = await prisma.syncRun.findMany({ where: { job: jobKey }, orderBy: { startedAt: "desc" }, take: 50 }) as DbRun[];
  return toRows(runs);
}

export async function runSchedulerJobNowAction(jobKey: string): Promise<{ ok: boolean; error?: string }> {
  const session = await isAdmin();
  if (!session) return { ok: false, error: "Hanya admin yang bisa melakukan ini." };
  const job = JOBS.find((j) => j.key === jobKey);
  if (!job) return { ok: false, error: "Job tidak dikenal." };
  const runId = await startJob(job, "manual", session.nip);
  return runId ? { ok: true } : { ok: false, error: "Job ini masih berjalan." };
}
