import { Card } from "@/components/ui/Card";

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

export interface AchievementRow {
  code: string;
  name: string;
  pic: string;
  /** Rencana/estimasi — sum of PoaLineItem.rencanaTotalBiaya at this grouping. */
  target: number;
  /** Only populated on the "mr" tab — PoaForm.target, the Rupiah quota an
   * atasan set for that MR/period, distinct from the MR's own rencana above. */
  targetAtasan: number | null;
  /** Real sales value sourced from DIR10001B (see monitoring/page.tsx for the
   * per-tab derivation — outlet/mr are a real observed Rupiah figure, produk
   * is qty × HNA). */
  salesActual: number;
  achievementPct: number | null;
  gap: number;
}

/**
 * Target vs Actual table for the Monitoring page — a focused view (just
 * target/actual/achievement/gap) distinct from Summary's much wider
 * TerritoryTable, which tracks program-execution metrics (PSSP, listing fee,
 * standarisasi, etc.) that don't belong here.
 */
export function SalesAchievementTable({ rows, codeLabel, showTargetAtasan = false }: {
  rows: AchievementRow[];
  codeLabel: string;
  showTargetAtasan?: boolean;
}) {
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
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap sticky left-0 z-10"
                style={{ color: "var(--color-text-faint)", background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }}>
                {codeLabel}
              </th>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>PIC</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Target (Rencana)</th>
              {showTargetAtasan && (
                <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Target Atasan</th>
              )}
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Sales Actual</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Achievement</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
                {showTargetAtasan && (
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {r.targetAtasan != null && r.targetAtasan > 0 ? formatRp(r.targetAtasan) : "-"}
                  </td>
                )}
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
                  style={{ color: r.gap > 0 ? "var(--color-danger, #dc2626)" : "var(--color-text-muted)" }}>
                  {r.gap !== 0 ? formatRp(r.gap) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
