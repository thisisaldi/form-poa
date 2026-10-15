"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getPoaStandarisasiActivityAction, type StandarisasiDashboardOutletRow, type StandarisasiDashboardPengajuan } from "@/app/actions/poaStandarisasi";
import type { ActivityRow } from "@/lib/poaStandarisasiActivity";
import { formatWib, formatWibShort } from "@/lib/formatWib";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

/** Urutan sama dengan MONITOR_STEPS di getStandarisasiDashboardAction + "Selesai". */
const STAGES = ["Planning", "Approval Atasan", "Approval Dokter", "Finalisasi", "SP Non Sales", "DPL/DPF", "Selesai"] as const;
/** Pengajuan yang belum selesai dan tidak ada aktivitas selama ini ditandai "macet". */
const STALE_DAYS = 14;

type Sort = "recent" | "stale" | "name" | "produk";

const DPL_FILTER_OPTIONS: ComboboxOption[] = [
  { value: "", label: "Semua status DPL/DPF" },
  { value: "APPROVED", label: "Ada DPL/DPF Approved", tag: "Approved", tagColor: "green" },
  { value: "PENDING", label: "Ada DPL/DPF Pending", tag: "Pending", tagColor: "yellow" },
  { value: "REJECTED", label: "Ada DPL/DPF Rejected", tag: "Rejected", tagColor: "red" },
];

const SORT_OPTIONS: ComboboxOption[] = [
  { value: "recent", label: "Aktivitas terbaru" },
  { value: "stale", label: "Paling lama tidak ada aktivitas" },
  { value: "name", label: "Nama outlet (A-Z)" },
  { value: "produk", label: "Jumlah produk terbanyak" },
];

const daysSince = (d: Date | string) => Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
const tanggal = (d: Date | string) => formatWibShort(d).replace(/,.*$/, "");

function relTime(d: Date | string): string {
  const n = daysSince(d);
  if (n <= 0) return "hari ini";
  if (n === 1) return "kemarin";
  if (n < 30) return `${n} hari lalu`;
  return tanggal(d);
}

function isStale(p: StandarisasiDashboardPengajuan): boolean {
  return p.stage !== "Selesai" && daysSince(p.lastActivity?.at ?? p.createdAt) >= STALE_DAYS;
}

const stageIdx = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);

const PRESS = "transition-transform active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2";

export function StandarisasiDashboardTable({ rows, canOpenDetail }: { rows: StandarisasiDashboardOutletRow[]; canOpenDetail: boolean }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<string>("");
  const [dplFilter, setDplFilter] = useState<"" | "APPROVED" | "PENDING" | "REJECTED">("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const p of r.pengajuan) m.set(p.stage, (m.get(p.stage) ?? 0) + 1);
    return m;
  }, [rows]);
  const totalPengajuan = rows.reduce((n, r) => n + r.pengajuan.length, 0);
  const staleCount = rows.reduce((n, r) => n + r.pengajuan.filter(isStale).length, 0);
  const hasFilter = !!(query || stage || dplFilter || onlyStale);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (!q || r.namaOutlet.toLowerCase().includes(q) || r.kodePI.toLowerCase().includes(q) || r.pengajuan.some((p) => p.ownerNama.toLowerCase().includes(q))) &&
        (!stage || r.pengajuan.some((p) => p.stage === stage)) &&
        (!dplFilter || r.dpl.some((d) => d.status === dplFilter)) &&
        (!onlyStale || r.pengajuan.some(isStale))
    );
    const lastAt = (r: StandarisasiDashboardOutletRow) => (r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : 0);
    const cmp: Record<Sort, (a: StandarisasiDashboardOutletRow, b: StandarisasiDashboardOutletRow) => number> = {
      recent: (a, b) => lastAt(b) - lastAt(a),
      stale: (a, b) => lastAt(a) - lastAt(b),
      name: (a, b) => a.namaOutlet.localeCompare(b.namaOutlet, "id"),
      produk: (a, b) => b.sudah.length + b.onProgress.length - (a.sudah.length + a.onProgress.length),
    };
    return out.sort((a, b) => cmp[sort](a, b) || a.namaOutlet.localeCompare(b.namaOutlet, "id"));
  }, [rows, query, stage, dplFilter, onlyStale, sort]);

  function toggle(kodePI: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kodePI)) next.delete(kodePI); else next.add(kodePI);
      return next;
    });
  }

  function resetFilter() {
    setQuery("");
    setStage("");
    setDplFilter("");
    setOnlyStale(false);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border px-6 py-10 text-center" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Belum ada pengajuan POA Standarisasi</p>
        <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>Pengajuan yang dibuat MR akan muncul di sini beserta tahapannya.</p>
      </div>
    );
  }


  return (
    <div className="space-y-4">
      {/* Posisi pengajuan per tahap; klik kotak untuk filter */}
      <Card>
        <CardHeader>
          <CardTitle>Posisi Pengajuan per Tahap</CardTitle>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{totalPengajuan} pengajuan, klik tahap untuk filter</span>
        </CardHeader>
        <div className="flex h-1.5 w-full overflow-hidden rounded-full mb-4" style={{ background: "var(--color-bg-subtle)" }} aria-hidden>
          {STAGES.map((s, i) => {
            const n = stageCounts.get(s) ?? 0;
            return n ? <div key={s} className="transition-opacity" style={{ width: `${(n / totalPengajuan) * 100}%`, background: stageTone(i).bar, opacity: stage && stage !== s ? 0.25 : 1 }} /> : null;
          })}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {STAGES.map((s, i) => {
            const n = stageCounts.get(s) ?? 0;
            const share = totalPengajuan ? Math.round((n / totalPengajuan) * 100) : 0;
            const active = stage === s;
            const t = TONE[stageTone(i).tone];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStage(active ? "" : s)}
                aria-pressed={active}
                disabled={n === 0 && !active}
                className={`rounded-md border p-3 text-left disabled:cursor-default ${PRESS}`}
                style={{
                  borderColor: active ? t.fg : "var(--color-border)",
                  background: active ? t.bg : "var(--color-surface)",
                }}
              >
                <p className="text-xs font-medium truncate" style={{ color: active ? t.fg : "var(--color-text-muted)" }}>{s}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color: n ? t.fg : "var(--color-text-faint)" }}>{n}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: stageTone(i).bar }} />
                </div>
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{n ? `${share}% pengajuan` : "Tidak ada"}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="std-search">Cari outlet</label>
        <input
          id="std-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari outlet, kode, atau nama MR"
          className="input-field !px-3 !py-2 sm:!max-w-xs"
        />
        <div className="w-full sm:w-56">
          <Combobox name="_dpl_filter" value={dplFilter} onChange={(v) => setDplFilter(v as typeof dplFilter)} placeholder="Semua status DPL/DPF" options={DPL_FILTER_OPTIONS} />
        </div>
        <div className="w-full sm:w-64">
          <Combobox name="_sort" value={sort} onChange={(v) => setSort((v || "recent") as Sort)} placeholder="Urutkan" options={SORT_OPTIONS} />
        </div>
        {staleCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none" style={{ color: "var(--color-text-muted)" }}>
            <input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} />
            Hanya yang macet ≥{STALE_DAYS} hari ({staleCount})
          </label>
        )}
        <span className="ml-auto text-xs" style={{ color: "var(--color-text-muted)" }}>{filtered.length} dari {rows.length} outlet</span>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-md border border-dashed px-6 py-8 text-center" style={{ borderColor: "var(--color-border-strong)" }}>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Tidak ada outlet yang cocok dengan filter ini.</p>
          {hasFilter && (
            <button type="button" onClick={resetFilter} className={`mt-2 text-sm font-medium ${PRESS}`} style={{ color: "var(--color-blue)" }}>
              Reset filter
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((r) => {
          const isOpen = open.has(r.kodePI);
          const stale = r.pengajuan.filter(isStale).length;
          const dplApproved = r.dpl.filter((d) => d.status === "APPROVED").length;
          const dplPending = r.dpl.filter((d) => d.status === "PENDING").length;
          const owners = [...new Set(r.pengajuan.map((p) => p.ownerNama))].join(", ");
          return (
            <div key={r.kodePI} className="rounded-md border overflow-hidden transition-colors" style={{ background: "var(--color-surface)", borderColor: isOpen ? "var(--color-border-strong)" : "var(--color-border)" }}>
              <button type="button" onClick={() => toggle(r.kodePI)} aria-expanded={isOpen} className="w-full px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>{r.namaOutlet}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "var(--color-text-muted)" }}>
                      {r.kodePI}, {r.pengajuan.length} pengajuan oleh {owners}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>Aktivitas terakhir</div>
                    <div className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }} title={r.lastActivityAt ? formatWib(r.lastActivityAt) : undefined} suppressHydrationWarning>
                      {r.lastActivityAt ? relTime(r.lastActivityAt) : "Belum ada"}
                    </div>
                  </div>
                  <span className="mt-1.5" style={{ color: "var(--color-text-faint)" }}><Chevron open={isOpen} /></span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[...new Set(r.pengajuan.map((p) => p.stage))].map((s) => (
                    <Pill key={s} tone={stageTone(stageIdx(s)).tone}>{s}</Pill>
                  ))}
                  <Pill tone="approved">{r.sudah.length} produk sudah</Pill>
                  {r.onProgress.length > 0 && <Pill tone="pending">{r.onProgress.length} on progress</Pill>}
                  {r.gagal > 0 && <Pill tone="error">{r.gagal} gagal</Pill>}
                  {dplApproved > 0 && <Pill tone="approved">{dplApproved} DPL/DPF approved</Pill>}
                  {dplPending > 0 && <Pill tone="pending">{dplPending} DPL/DPF pending</Pill>}
                  {stale > 0 && <Pill tone="error">{stale} macet ≥{STALE_DAYS} hari</Pill>}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-3 border-t space-y-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}>
                  <div className="space-y-3">
                    {r.pengajuan.map((p) => (
                      <PengajuanCard key={p.id} p={p} canOpenDetail={canOpenDetail} />
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ProdukList title="Sudah Standarisasi" color="var(--color-status-approved)" empty="Belum ada.">
                      {r.sudah.map((p) => (
                        <li key={p.kodeProduk} className="flex justify-between gap-2">
                          <span style={{ color: "var(--color-text)" }}>{p.namaProduk}</span>
                          <span className="whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{tanggal(p.submittedAt)}</span>
                        </li>
                      ))}
                    </ProdukList>
                    <ProdukList title="On Progress" color="var(--color-status-pending)" empty="Tidak ada.">
                      {r.onProgress.map((p) => (
                        <li key={`${p.pengajuanId}-${p.kodeProduk}`} className="flex justify-between gap-2">
                          <span style={{ color: "var(--color-text)" }}>{p.namaProduk}</span>
                          <span className="text-right" style={{ color: "var(--color-text-muted)" }}>{p.phaseLabel}, {p.ownerNama}</span>
                        </li>
                      ))}
                    </ProdukList>
                  </div>

                  {r.dpl.length > 0 && (
                    <ProdukList title="Request DPL/DPF ke Exodus" color="var(--color-blue)" empty="">
                      {r.dpl.map((d) => (
                        <li key={d.id} className="flex justify-between gap-2">
                          <span style={{ color: "var(--color-text)" }}>{d.tipe} {d.distributorKode}: {d.produk.join(", ") || "-"}</span>
                          <span className="text-right whitespace-nowrap" style={{ color: TONE[DPL_TONE[d.status]].fg }}>
                            {DPL_LABEL[d.status]}, {tanggal(d.submittedAt)}
                          </span>
                        </li>
                      ))}
                    </ProdukList>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PengajuanCard({ p, canOpenDetail }: { p: StandarisasiDashboardPengajuan; canOpenDetail: boolean }) {
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stale = isStale(p);

  async function loadLog() {
    setError(null);
    try {
      setLog(await getPoaStandarisasiActivityAction(p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat riwayat.");
    }
  }

  function toggleLog() {
    const next = !showLog;
    setShowLog(next);
    if (next && !log) void loadLog();
  }

  return (
    <div className="rounded-md border p-3" style={{ background: "var(--color-surface)", borderColor: stale ? "color-mix(in srgb, var(--color-error) 50%, var(--color-border))" : "var(--color-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{p.ownerNama}</div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {p.produkCount} produk, dibuat {tanggal(p.createdAt)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone={stageTone(stageIdx(p.stage)).tone}>{p.stage === "Selesai" ? "Selesai" : `Tahap: ${p.stage}`}</Pill>
          {canOpenDetail && (
            <Link href={`/poa-standarisasi/${p.id}`} className="text-xs font-medium underline-offset-2 hover:underline" style={{ color: "var(--color-blue)" }}>Buka detail</Link>
          )}
        </div>
      </div>

      <MiniStepper steps={p.steps} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p style={{ color: stale ? "var(--color-error)" : "var(--color-text-muted)" }} suppressHydrationWarning>
          {p.lastActivity ? (
            <>
              <span className="font-medium">Terakhir:</span> {p.lastActivity.label} oleh {p.lastActivity.actorNama},{" "}
              <span title={formatWib(p.lastActivity.at)}>{relTime(p.lastActivity.at)}</span>
            </>
          ) : (
            "Belum ada aktivitas tercatat."
          )}
          {stale && `. Tidak ada aktivitas ≥${STALE_DAYS} hari.`}
        </p>
        {p.activityCount > 0 && (
          <button type="button" onClick={toggleLog} aria-expanded={showLog} className={`inline-flex items-center gap-1.5 font-medium ${PRESS}`} style={{ color: "var(--color-blue)" }}>
            {showLog ? "Tutup riwayat" : `Lihat riwayat (${p.activityCount})`}
            <Chevron open={showLog} />
          </button>
        )}
      </div>

      {showLog && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--color-border)" }}>
          {error ? (
            <div className="flex flex-wrap items-center gap-2 text-xs" role="alert">
              <span style={{ color: "var(--color-error)" }}>{error}</span>
              <button type="button" onClick={loadLog} className={`font-medium ${PRESS}`} style={{ color: "var(--color-blue)" }}>Coba lagi</button>
            </div>
          ) : !log ? (
            <TimelineSkeleton rows={Math.min(p.activityCount, 4)} />
          ) : (
            <ol className="relative space-y-3 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
              {log.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[1.6rem] mt-1 h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-blue)", boxShadow: "0 0 0 2px var(--color-surface)" }} aria-hidden />
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>{formatWib(a.at)}</p>
                  <p className="text-xs" style={{ color: "var(--color-text)" }}>
                    <span className="font-semibold">{a.label}</span>
                    <span style={{ color: "var(--color-text-muted)" }}> oleh {a.actorNama}</span>
                  </p>
                  {a.detail && <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{a.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** Placeholder seukuran timeline asli selama riwayat dimuat. */
function TimelineSkeleton({ rows }: { rows: number }) {
  return (
    <ol className="space-y-3 pl-5 border-l animate-pulse motion-reduce:animate-none" style={{ borderColor: "var(--color-border)" }} aria-label="Memuat riwayat">
      {Array.from({ length: Math.max(rows, 1) }, (_, i) => (
        <li key={i} className="space-y-1.5">
          <div className="h-2.5 w-28 rounded" style={{ background: "var(--color-bg-subtle)" }} />
          <div className="h-3 w-56 max-w-full rounded" style={{ background: "var(--color-bg-subtle)" }} />
        </li>
      ))}
    </ol>
  );
}

function MiniStepper({ steps }: { steps: StandarisasiDashboardPengajuan["steps"] }) {
  const currentIdx = steps.findIndex((s) => s.state !== "done");
  return (
    <ol className="mt-3 grid grid-cols-6 gap-1" aria-label="Tahapan pengajuan">
      {steps.map((s, i) => {
        const color = s.state === "done" ? "var(--color-status-approved)" : s.state === "partial" ? "var(--color-status-pending)" : "var(--color-border-strong)";
        const isCurrent = i === currentIdx;
        const stateLabel = s.state === "done" ? "selesai" : s.state === "partial" ? "sedang berjalan" : "belum";
        return (
          <li key={s.label} className="flex flex-col items-center text-center min-w-0 relative" aria-label={`${s.label}: ${stateLabel}`} aria-current={isCurrent ? "step" : undefined}>
            {i > 0 && (
              <span className="absolute top-2.5 h-0.5" style={{ left: "-50%", right: "50%", background: steps[i - 1].state === "done" ? "var(--color-status-approved)" : "var(--color-border)" }} aria-hidden />
            )}
            <span
              className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold tabular-nums"
              style={{
                borderColor: color,
                background: s.state === "done" ? color : s.state === "partial" ? `color-mix(in srgb, ${color} 18%, var(--color-surface))` : "var(--color-surface)",
                color: s.state === "done" ? "var(--color-surface)" : s.state === "partial" ? color : "var(--color-text-faint)",
                boxShadow: isCurrent ? `0 0 0 3px color-mix(in srgb, ${s.state === "partial" ? color : "var(--color-blue)"} 22%, transparent)` : undefined,
              }}
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="mt-1 text-[10px] leading-tight" style={{ color: isCurrent ? "var(--color-text)" : "var(--color-text-muted)", fontWeight: isCurrent ? 600 : 400 }}>{s.label}</span>
            {s.at && s.state !== "todo" && (
              <span className="text-[10px] leading-tight tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                {new Date(s.at).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" })}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ProdukList({ title, color, empty, children }: { title: string; color: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold mb-1.5 pl-2 border-l-2" style={{ color: "var(--color-text)", borderColor: color }}>{title}</h3>
      {children.length === 0 ? <p className="text-xs pl-2" style={{ color: "var(--color-text-muted)" }}>{empty}</p> : <ul className="space-y-1 text-xs pl-2">{children}</ul>}
    </div>
  );
}

/** Tone badge, sama dengan StatusBadge / TONE di halaman POA lain (token --color-status-*). */
const TONE = {
  draft: { bg: "var(--color-status-draft-bg)", fg: "var(--color-status-draft)" },
  pending: { bg: "var(--color-status-pending-bg)", fg: "#9A6F1B" },
  blue: { bg: "var(--color-blue-light)", fg: "var(--color-blue)" },
  approved: { bg: "var(--color-status-approved-bg)", fg: "var(--color-status-approved)" },
  error: { bg: "var(--color-error-bg)", fg: "var(--color-error)" },
} as const;
type ToneKey = keyof typeof TONE;

/**
 * Per tahap: Planning = draft, approval s/d finalisasi = pending (kuning, seperti
 * "Butuh Approval" di POA), pasca-finalisasi = biru, Selesai = approved (hijau).
 * `bar` dibedakan pekatnya supaya segmen bersebelahan di bar ringkasan tetap terbaca.
 */
const STAGE_TONE: { tone: ToneKey; bar: string }[] = [
  { tone: "draft", bar: "var(--color-status-draft)" },
  { tone: "pending", bar: "color-mix(in srgb, var(--color-status-pending) 55%, var(--color-surface))" },
  { tone: "pending", bar: "color-mix(in srgb, var(--color-status-pending) 78%, var(--color-surface))" },
  { tone: "pending", bar: "var(--color-status-pending)" },
  { tone: "blue", bar: "color-mix(in srgb, var(--color-blue) 60%, var(--color-surface))" },
  { tone: "blue", bar: "var(--color-blue)" },
  { tone: "approved", bar: "var(--color-status-approved)" },
];
const stageTone = (i: number) => STAGE_TONE[i] ?? STAGE_TONE[0];

/** Chevron dari border CSS (tanpa glyph/emoji); `open` memutar ke atas. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 border-r-2 border-b-2 transition-transform duration-200 motion-reduce:transition-none"
      style={{ borderColor: "currentColor", transform: open ? "rotate(-135deg) translate(-1px, -1px)" : "rotate(45deg) translate(-1px, -1px)" }}
    />
  );
}

const DPL_LABEL = { APPROVED: "Approved", PENDING: "Pending", REJECTED: "Rejected" } as const;
const DPL_TONE = { APPROVED: "approved", PENDING: "pending", REJECTED: "error" } as const;

function Pill({ tone, children }: { tone: ToneKey; children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: TONE[tone].bg, color: TONE[tone].fg }}>
      {children}
    </span>
  );
}
