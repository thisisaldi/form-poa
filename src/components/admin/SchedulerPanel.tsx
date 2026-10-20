"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  getSchedulerJobsAction, getSchedulerHistoryAction, runSchedulerJobNowAction,
  type SchedulerJobRow, type SyncRunRow, type RunStatus,
} from "@/app/actions/scheduler";

/**
 * Admin → Scheduler (docs/scheduler-monitor/03-ui-and-access.md): status of
 * every in-process sync job (src/lib/sync/jobs.ts), run history, and a manual
 * "Jalankan sekarang". Polls every 10s only while some job is running.
 */

const POLL_MS = 10_000;

const STATUS_STYLE: Record<RunStatus, { label: string; bg: string; fg: string }> = {
  success: { label: "Berhasil", bg: "var(--color-green-light, #E6F5EC)", fg: "var(--color-green, #008f42)" },
  failed: { label: "Gagal", bg: "var(--color-red-light)", fg: "var(--color-red)" },
  running: { label: "Berjalan", bg: "var(--color-blue-light)", fg: "var(--color-blue)" },
  abandoned: { label: "Terputus", bg: "var(--color-warning-bg, #fef3c7)", fg: "var(--color-warning, #f59e0b)" },
};

function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS_STYLE[status];
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WIB";
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt ${s % 60} dtk`;
  return `${Math.floor(m / 60)} jam ${m % 60} mnt`;
}

function runText(r: SyncRunRow) {
  return r.error ?? r.summary ?? (r.status === "running" ? "Sedang berjalan…" : "-");
}

function HistoryList({ jobKey, refreshKey }: { jobKey: string; refreshKey: number }) {
  const [runs, setRuns] = useState<SyncRunRow[] | null>(null);
  useEffect(() => { getSchedulerHistoryAction(jobKey).then(setRuns).catch(() => setRuns([])); }, [jobKey, refreshKey]);

  if (runs === null) return <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat histori…</p>;
  if (runs.length === 0) return <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada run tercatat.</p>;
  return (
    <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
      {runs.map((r) => (
        <div key={r.id} className="py-2 text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={r.status} />
            <span style={{ color: "var(--color-text-muted)" }}>{fmtTime(r.startedAt)}</span>
            <span style={{ color: "var(--color-text-faint)" }}>{fmtDuration(r.durationMs)}</span>
            <span style={{ color: "var(--color-text-faint)" }}>
              {r.trigger === "manual" ? `Manual oleh ${r.triggeredByName ?? r.triggeredBy}` : "Jadwal"}
            </span>
          </div>
          <p className="break-words" style={{ color: r.error ? "var(--color-red)" : "var(--color-text-muted)" }}>{runText(r)}</p>
          {r.detail != null && (
            <details>
              <summary className="cursor-pointer" style={{ color: "var(--color-text-faint)" }}>Detail</summary>
              <pre className="mt-1 p-2 rounded overflow-x-auto text-[11px]" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                {JSON.stringify(r.detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export function SchedulerPanel() {
  const [jobs, setJobs] = useState<SchedulerJobRow[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const reload = useCallback(() => {
    getSchedulerJobsAction().then((j) => { setJobs(j); setRefreshKey((k) => k + 1); }).catch(() => setJobs([]));
  }, []);

  useEffect(reload, [reload]);

  const anyRunning = jobs?.some((j) => j.lastRun?.status === "running") ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [anyRunning, reload]);

  function runNow(job: SchedulerJobRow) {
    if (!window.confirm(`Jalankan "${job.label}" sekarang? Job ini menulis ke database, sama seperti run terjadwal.`)) return;
    setError(null);
    setStartingKey(job.key);
    startTransition(async () => {
      const res = await runSchedulerJobNowAction(job.key);
      setStartingKey(null);
      if (!res.ok) setError(res.error ?? "Gagal menjalankan job.");
      reload();
    });
  }

  if (jobs === null) return <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Memuat scheduler…</p>;

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}
      {jobs.map((job) => {
        const last = job.lastRun;
        const running = last?.status === "running";
        return (
          <div key={job.key} className="rounded-lg border p-4 space-y-2" style={{ borderColor: last?.status === "failed" ? "var(--color-red)" : "var(--color-border)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{job.label}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                  <span className="font-mono">{job.key}</span> · tiap hari {String(job.hourWib).padStart(2, "0")}:00 WIB · berikutnya {fmtTime(job.nextRunAt)}
                </p>
              </div>
              {last ? <StatusBadge status={last.status} /> : <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum pernah jalan</span>}
            </div>

            {last && (
              <div className="text-xs space-y-0.5">
                <p style={{ color: "var(--color-text-faint)" }}>
                  Terakhir {fmtTime(last.startedAt)} · {running ? "berjalan…" : fmtDuration(last.durationMs)} · {last.trigger === "manual" ? `manual oleh ${last.triggeredByName ?? last.triggeredBy}` : "jadwal"}
                </p>
                <p className="break-words" style={{ color: last.error ? "var(--color-red)" : "var(--color-text-muted)" }}>{runText(last)}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => runNow(job)} disabled={running || startingKey === job.key}>
                {running ? "Berjalan…" : startingKey === job.key ? "Memulai…" : "Jalankan sekarang"}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpenKey(openKey === job.key ? null : job.key)}>
                {openKey === job.key ? "Tutup histori" : "Histori"}
              </Button>
            </div>

            {openKey === job.key && (
              <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
                <HistoryList jobKey={job.key} refreshKey={refreshKey} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
