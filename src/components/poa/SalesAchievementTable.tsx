"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

export interface AchievementRow {
  code: string;
  name: string;
  pic: string;
  /** Real target only — PoaForm.target (mr/area tabs) or ProductTargetAllocation
   * × HNA (produk tab). 0 means no target has actually been set at this
   * grouping (outlet tab always reads 0 — there is no per-outlet target
   * model at all), never a stand-in like planned rencana (2026-07-30: "jangan
   * pakai target dummy lagi"). */
  target: number;
  /** Real sales value sourced from DIR10001B (see monitoring/page.tsx for the
   * per-tab derivation — outlet/mr/area are a real observed Rupiah figure,
   * produk is qty × HNA). */
  salesActual: number;
  achievementPct: number | null;
  /** actual - target (2026-07-30 fix: was target - actual, backwards from
   * what "gap" should mean here — positive now means over-achieving). Null
   * when there's no target to gap against at all, rather than silently
   * computing against an assumed-zero target. */
  gap: number | null;
}

type SortKey = "name" | "target" | "salesActual" | "achievementPct" | "gap";

/**
 * Target vs Actual table for the Monitoring page — a focused view (just
 * target/actual/achievement/gap) distinct from Summary's much wider
 * TerritoryTable, which tracks program-execution metrics (PSSP, listing fee,
 * standarisasi, etc.) that don't belong here.
 *
 * Sortable column headers (2026-07-30) — click any header to sort by it,
 * click again to flip direction; starts unsorted (server's own default order,
 * worst achievement first — see monitoring/page.tsx).
 */
export function SalesAchievementTable({ rows, codeLabel }: {
  rows: AchievementRow[];
  codeLabel: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => compareSortValues(a[sortKey], b[sortKey], sortDir));
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada data.
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
              <SortableTh label={codeLabel} sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" sticky />

              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>PIC</th>
              <SortableTh label="Target" sortKey="target" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Sales Actual" sortKey="salesActual" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Achievement" sortKey="achievementPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Gap" sortKey="gap" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.code} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-2 px-3 sticky left-0 z-10"
                  style={{ color: "var(--color-text)", background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }}>
                  <p className="font-medium truncate max-w-[16rem]">{r.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.code}</p>
                </td>
                <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{r.pic}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                  {r.target > 0 ? formatRp(r.target) : "-"}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                  {r.salesActual > 0 ? formatRp(r.salesActual) : "-"}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap"
                  style={{ color: r.achievementPct == null ? "var(--color-text-faint)"
                    : r.achievementPct >= 100 ? "var(--color-success, #16a34a)"
                    : r.achievementPct >= 70 ? "var(--color-warning, #f59e0b)"
                    : "var(--color-red)" }}>
                  {r.achievementPct != null ? `${r.achievementPct.toFixed(1)}%` : "-"}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap"
                  style={{ color: r.gap == null ? "var(--color-text-faint)"
                    : r.gap < 0 ? "var(--color-danger, #dc2626)" : "var(--color-text-muted)" }}>
                  {r.gap != null ? (r.gap !== 0 ? formatRp(r.gap) : "0") : "Belum ada target"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
