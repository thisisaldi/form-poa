"use client";

import { useMemo, useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";
import { saveKpiManualInputAction, type KpiPersonnelRow } from "@/app/actions/kpi";
import { TONE_STYLE, recommendationTone, roleLabel, scoreTone, type Tone } from "./kpiUi";

type SortKey = "name" | "salesAchievementPct" | "activityAchievementPct" | "customerAktifCount" | "absensiValue" | "totalScore";
type RoleFilter = "ALL" | "MR" | "SPV" | "ASM" | "SM";
type StatusFilter = "ALL" | "COMPLETE" | "INCOMPLETE";

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "ALL", label: "Semua" },
  { value: "MR", label: "MR" },
  { value: "SPV", label: "SPV" },
  { value: "ASM", label: "ASM" },
  { value: "SM", label: "SM" },
];
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "Semua status" },
  { value: "COMPLETE", label: "Lengkap" },
  { value: "INCOMPLETE", label: "Belum lengkap" },
];

const TH_PLAIN = "text-left py-2.5 px-3 font-medium whitespace-nowrap";

/** Score 0-100 as a tinted pill; "Belum diisi" when there's no score yet. */
function ScorePill({ score, tone }: { score: number | null; tone?: Tone }) {
  const t = TONE_STYLE[tone ?? scoreTone(score)];
  return (
    <span
      className="inline-flex min-w-[2.75rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums"
      style={{ color: t.fg, background: t.bg }}
    >
      {score != null ? score : "–"}
    </span>
  );
}

function SyncBadge({ title }: { title: string }) {
  return (
    <span
      className="rounded px-1 text-[10px] font-medium"
      style={{ color: "var(--color-blue)", background: "var(--color-blue-light)" }}
      title={title}
    >
      sinkron
    </span>
  );
}

/** One pillar cell: score pill on top, the raw figure behind it underneath. */
function PillarCell({ score, detail, badge }: { score: number | null; detail: string; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <ScorePill score={score} />
      <span className="flex items-center gap-1 text-[11px] tabular-nums" style={{ color: "var(--color-text-faint)" }}>
        {detail}
        {badge}
      </span>
    </div>
  );
}

/** Inline editor for the two manual-override indicators (Call Activity, Absensi) — see docs/kpi-monitoring/02-data-model.md §2. */
function ManualInputRow({ row, period }: { row: KpiPersonnelRow; period: string }) {
  const [editing, setEditing] = useState(false);
  const [callActivity, setCallActivity] = useState(row.callActivityRealisasi?.toString() ?? "");
  const [absensi, setAbsensi] = useState(row.absensiValue?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await saveKpiManualInputAction({
        nip: row.nip,
        period,
        callActivityRealisasi: callActivity === "" ? null : Number(callActivity),
        absensiValue: absensi === "" ? null : Number(absensi),
      });
      setEditing(false);
    });
  }

  if (!editing) {
    const filled = row.callActivityRealisasi != null || row.absensiValue != null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${filled ? "Edit" : "Isi"} input manual ${row.name}`}
        className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
      >
        {filled ? "Edit" : "Isi manual"}
      </button>
    );
  }

  const inputCls = "w-20 rounded-md border px-2 py-1 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1";
  return (
    <div className="flex min-w-[13rem] flex-col items-start gap-2 rounded-md border p-2.5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}>
      <label className="flex w-full items-center justify-between gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <span>Kunjungan efektif</span>
        <span className="flex items-center gap-1">
          <input
            type="number" min={0} step="any" value={callActivity}
            onChange={(e) => setCallActivity(e.target.value)}
            className={inputCls} style={{ borderColor: "var(--color-border)" }}
          />
          <span className="tabular-nums">/ {row.callActivityStandar}</span>
        </span>
      </label>
      <label className="flex w-full items-center justify-between gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <span>Absensi (jam telat)</span>
        <input
          type="number" min={0} step={0.1} value={absensi}
          onChange={(e) => setAbsensi(e.target.value)}
          className={inputCls} style={{ borderColor: "var(--color-border)" }}
        />
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={save} loading={isPending}>Simpan</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={isPending}>Batal</Button>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        borderColor: active ? "var(--color-blue)" : "var(--color-border)",
        background: active ? "var(--color-blue-light)" : "var(--color-surface)",
        color: active ? "var(--color-blue)" : "var(--color-text-muted)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Listing table for /kpi-perpanjangan — 4 pillar scores + Total Score +
 * rekomendasi kontrak, one row per active person. Each pillar shows its 0-100
 * score as a colored pill with the raw figure underneath. Sales Achievement &
 * Customer Expansion are read-only (derived from real data); Call Activity and
 * Absensi are normally synced (marked "sinkron") but stay editable as an ADMIN
 * override — see docs/kpi-monitoring/02-data-model.md §2 and
 * src/lib/sync/kpiAbsensiSync.ts / kpiCallActivitySync.ts.
 */
export function KpiTable({ rows, period, canEdit = true }: { rows: KpiPersonnelRow[]; period: string; canEdit?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey | null>("totalScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.nip.toLowerCase().includes(q)) return false;
      if (roleFilter !== "ALL" && roleLabel(r.role, r.jabatan) !== roleFilter) return false;
      if (statusFilter === "COMPLETE" && r.totalScore == null) return false;
      if (statusFilter === "INCOMPLETE" && r.totalScore != null) return false;
      return true;
    });
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => compareSortValues(a[sortKey] as number | string | null, b[sortKey] as number | string | null, sortDir));
  }, [rows, query, roleFilter, statusFilter, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada personil aktif (MR/SPV/ASM/SM).
        </p>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama atau NIP…"
          aria-label="Cari personil"
          className="w-full rounded-md border px-3 py-1.5 text-sm sm:w-64 focus-visible:outline-2 focus-visible:outline-offset-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter role">
          {ROLE_FILTERS.map((f) => (
            <FilterChip key={f.value} active={roleFilter === f.value} onClick={() => setRoleFilter(f.value)}>{f.label}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter kelengkapan">
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.value} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)}>{f.label}</FilterChip>
          ))}
        </div>
        <p className="ml-auto text-xs tabular-nums" style={{ color: "var(--color-text-faint)" }} aria-live="polite">
          {visibleRows.length} dari {rows.length} personil
        </p>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p>Tidak ada personil yang cocok dengan filter.</p>
          <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setRoleFilter("ALL"); setStatusFilter("ALL"); }}>
            Reset filter
          </Button>
        </div>
      ) : (
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead className="sticky top-0 z-20" style={{ background: "var(--color-surface)", boxShadow: "0 1px 0 var(--color-border)" }}>
              <tr>
                <SortableTh label="Personil" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" sticky />
                <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Role</th>
                <SortableTh label="Sales (50%)" sortKey="salesAchievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Business Result — Sales Achievement" />
                <SortableTh label="Activity (25%)" sortKey="activityAchievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Activity & Coverage — Call Activity" />
                <SortableTh label="Customer (15%)" sortKey="customerAktifCount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Market Development — Customer Expansion" />
                <SortableTh label="Absensi (10%)" sortKey="absensiValue" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Attitude — Kepatuhan Absensi" />
                <SortableTh label="Total" sortKey="totalScore" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" />
                <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Rekomendasi</th>
                {canEdit && <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Input manual</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const totalTone = TONE_STYLE[scoreTone(r.totalScore)];
                const rec = r.recommendation ? TONE_STYLE[recommendationTone(r.recommendation.months)] : TONE_STYLE.none;
                return (
                  <tr key={r.nip} className="group hover:bg-[var(--color-bg-subtle)]">
                    <td
                      className="sticky left-0 z-10 px-3 py-2.5 group-hover:bg-[var(--color-bg-subtle)]"
                      style={{ background: "var(--color-surface)", borderRight: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}
                    >
                      <p className="max-w-[14rem] truncate text-[13px] font-medium">{r.name}</p>
                      <p className="tabular-nums" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                        {roleLabel(r.role, r.jabatan)}
                      </span>
                    </td>

                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <PillarCell
                        score={r.salesScore}
                        detail={r.salesAchievementPct != null ? `${r.salesAchievementPct.toFixed(1)}% dari target` : "Belum ada target"}
                      />
                    </td>

                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <PillarCell
                        score={r.activityScore}
                        detail={r.activityAchievementPct != null ? `${r.activityAchievementPct.toFixed(1)}% dari standar` : "Belum diisi"}
                        badge={r.callActivitySource === "EXODUS_SYNC" ? <SyncBadge title="Disinkronkan otomatis dari Exodus (kunjungan per jendela jam)" /> : undefined}
                      />
                    </td>

                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <PillarCell score={r.customerScore} detail={`${r.customerAktifCount} customer aktif`} />
                    </td>

                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <PillarCell
                        score={r.absensiScore}
                        detail={r.absensiValue != null ? `${r.absensiValue.toFixed(2)} jam telat` : "Belum diisi"}
                        badge={r.absensiSource === "SIPP_SYNC" ? <SyncBadge title="Disinkronkan otomatis dari SIPP (absensi HRIS)" /> : undefined}
                      />
                    </td>

                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      {r.totalScore != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, r.totalScore))}%`, background: totalTone.solid }} />
                          </div>
                          <span className="w-12 text-[13px] font-semibold tabular-nums" style={{ color: totalTone.fg }}>{r.totalScore.toFixed(2)}</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--color-text-faint)" }}>–</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      {r.recommendation ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium" style={{ color: rec.fg, background: rec.bg }}>
                          <span className="tabular-nums font-semibold">{r.recommendation.months} bln</span>
                          <span className="opacity-80">{r.recommendation.label}</span>
                        </span>
                      ) : (
                        <span className="rounded-full px-2.5 py-0.5" style={{ color: TONE_STYLE.none.fg, background: TONE_STYLE.none.bg }}>Data belum lengkap</span>
                      )}
                    </td>

                    {canEdit && (
                      <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <ManualInputRow row={r} period={period} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
