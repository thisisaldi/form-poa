"use client";

import { useMemo, useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";
import { saveKpiManualInputAction, type KpiPersonnelRow } from "@/app/actions/kpi";

function scoreColor(score: number | null): string {
  if (score == null) return "var(--color-text-faint)";
  if (score >= 85) return "var(--color-success, #16a34a)";
  if (score >= 70) return "var(--color-blue)";
  if (score >= 55) return "var(--color-warning, #f59e0b)";
  return "var(--color-red)";
}

function recommendationColor(months: number | null): string {
  if (months == null) return "var(--color-text-faint)";
  if (months === 12) return "var(--color-success, #16a34a)";
  if (months === 9) return "var(--color-blue)";
  if (months === 6) return "var(--color-warning, #f59e0b)";
  return "var(--color-red)";
}

type SortKey = "name" | "salesAchievementPct" | "activityAchievementPct" | "customerAktifCount" | "absensiValue" | "totalScore";

/** Inline editor for the two manual-only indicators (Call Activity, Absensi) — see docs/kpi-monitoring/02-data-model.md §2. */
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
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs underline decoration-dotted hover:opacity-75"
        style={{ color: "var(--color-blue)" }}
      >
        {row.callActivityRealisasi != null || row.absensiValue != null ? "Edit input" : "Isi manual"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Kunjungan realisasi
        <input
          type="number"
          min={0}
          value={callActivity}
          onChange={(e) => setCallActivity(e.target.value)}
          className="w-16 rounded border px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--color-border)" }}
        />
        <span>/ {row.callActivityStandar}</span>
      </label>
      <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Absensi (jam telat)
        <input
          type="number"
          min={0}
          step={0.1}
          value={absensi}
          onChange={(e) => setAbsensi(e.target.value)}
          className="w-16 rounded border px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--color-border)" }}
        />
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={save} loading={isPending}>Simpan</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={isPending}>Batal</Button>
      </div>
    </div>
  );
}

/**
 * Listing table for /kpi-perpanjangan — 4 pillar scores + Total Score +
 * rekomendasi kontrak, one row per active MR/ASM/SM. Sales Achievement &
 * Customer Expansion are read-only (derived from real data); Call Activity is
 * always manual (no automated source yet); Absensi is normally filled
 * automatically by the SIPP sync (marked "(sinkron)" below) but stays
 * editable as an ADMIN override — see docs/kpi-monitoring/02-data-model.md §2
 * and src/lib/sync/kpiAbsensiSync.ts.
 */
export function KpiTable({ rows, period }: { rows: KpiPersonnelRow[]; period: string }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "asc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => compareSortValues(a[sortKey] as number | string | null, b[sortKey] as number | string | null, sortDir));
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada personil aktif (MR/ASM/SM).
        </p>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <SortableTh label="Personil" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" sticky />
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Role</th>
              <SortableTh label="Sales (50%)" sortKey="salesAchievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Business Result — Sales Achievement" />
              <SortableTh label="Activity (25%)" sortKey="activityAchievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Activity & Coverage — Call Activity" />
              <SortableTh label="Customer (15%)" sortKey="customerAktifCount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Market Development — Customer Expansion" />
              <SortableTh label="Absensi (10%)" sortKey="absensiValue" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} title="Attitude — Kepatuhan Absensi" />
              <SortableTh label="Total Score" sortKey="totalScore" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Rekomendasi</th>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Input Manual</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.nip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-2 px-3 sticky left-0 z-10" style={{ background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }}>
                  <p className="font-medium truncate max-w-[14rem]">{r.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>
                </td>
                <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{r.jabatan ?? r.role}</td>

                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: scoreColor(r.salesScore) }}>
                  {r.salesAchievementPct != null ? `${r.salesAchievementPct.toFixed(1)}%` : "-"}
                  {r.salesScore != null && <span className="ml-1" style={{ color: "var(--color-text-faint)" }}>({r.salesScore})</span>}
                </td>

                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: scoreColor(r.activityScore) }}>
                  {r.activityAchievementPct != null ? `${r.activityAchievementPct.toFixed(1)}%` : "Belum diisi"}
                  {r.activityScore != null && <span className="ml-1" style={{ color: "var(--color-text-faint)" }}>({r.activityScore})</span>}
                </td>

                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: scoreColor(r.customerScore) }}>
                  {r.customerAktifCount}
                  <span className="ml-1" style={{ color: "var(--color-text-faint)" }}>({r.customerScore})</span>
                </td>

                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: scoreColor(r.absensiScore) }}>
                  {r.absensiValue != null ? r.absensiValue.toFixed(1) : "Belum diisi"}
                  {r.absensiScore != null && <span className="ml-1" style={{ color: "var(--color-text-faint)" }}>({r.absensiScore})</span>}
                  {r.absensiSource === "SIPP_SYNC" && (
                    <span className="ml-1 text-[10px]" style={{ color: "var(--color-text-faint)" }} title="Disinkronkan otomatis dari SIPP (absensi HRIS)">
                      (sinkron)
                    </span>
                  )}
                </td>

                <td className="py-2 px-3 text-right whitespace-nowrap font-semibold" style={{ color: scoreColor(r.totalScore) }}>
                  {r.totalScore != null ? r.totalScore.toFixed(2) : "-"}
                </td>

                <td className="py-2 px-3 whitespace-nowrap" style={{ color: recommendationColor(r.recommendation?.months ?? null) }}>
                  {r.recommendation ? `${r.recommendation.months} bln — ${r.recommendation.label}` : "Data belum lengkap"}
                </td>

                <td className="py-2 px-3 whitespace-nowrap">
                  <ManualInputRow row={r} period={period} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
