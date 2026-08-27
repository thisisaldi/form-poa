"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";

export interface SurveyRow {
  nip: string;
  name: string;
  totalOutlets: number;
  outletsWithSurvey: number;
  /** SURVEY_TARGET_OUTLETS (3) at ASM level; SUM of that across the ASMs under this row at NSM/SM/Total level. */
  target: number;
  /** outletsWithSurvey / target × 100, uncapped (same "can exceed 100%" convention as Sales Achievement elsewhere). `null` only when target is 0 (no ASMs under this row). */
  achievementPct: number | null;
}

function achievementColor(pct: number | null): string {
  if (pct == null) return "var(--color-text-faint)";
  if (pct >= 100) return "var(--color-success, #16a34a)";
  if (pct >= 50) return "var(--color-warning, #f59e0b)";
  return "var(--color-red)";
}

type SortKey = "name" | "totalOutlets" | "outletsWithSurvey" | "target" | "achievementPct";

function SurveySectionTable({ title, rows }: { title: string; rows: SurveyRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => compareSortValues(a[sortKey] as number | string | null, b[sortKey] as number | string | null, sortDir));
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) return null;
  return (
    <Card padded={false}>
      <p className="text-sm font-semibold px-3 pt-3 pb-2" style={{ color: "var(--color-text)" }}>{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <SortableTh label="Personil" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" />
              <SortableTh label="Total Outlet" sortKey="totalOutlets" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Outlet dengan Data Survey" sortKey="outletsWithSurvey" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Target" sortKey="target" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Achievement" sortKey="achievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.nip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-2 px-3">
                  <p className="font-medium">{r.name}</p>
                  {r.nip !== "TOTAL" && <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.totalOutlets}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.outletsWithSurvey}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>{r.target}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap font-medium" style={{ color: achievementColor(r.achievementPct) }}>
                  {r.achievementPct != null ? `${r.achievementPct.toFixed(0)}%` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * "Data Survey" tab — 4 stacked, independently sortable sections (Total /
 * Per NSM / Per SM / Per ASM), each row = how many of that personil's
 * outlets have SOME survey data (web upload OR existing reference data),
 * ALL-TIME (no quarter filter — see summary/page.tsx's "Data Survey" tab
 * comment). Computed server-side in summary/page.tsx; this component only
 * renders + sorts it. A section with zero rows in scope (e.g. an ASM viewer
 * has no NSM/SM rows) is simply omitted.
 */
export function SurveyDataSummaryTable({ sections }: { sections: { title: string; rows: SurveyRow[] }[] }) {
  const allEmpty = sections.every((s) => s.rows.length === 0);
  if (allEmpty) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tidak ada data dalam scope kamu.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((s) => <SurveySectionTable key={s.title} title={s.title} rows={s.rows} />)}
    </div>
  );
}
