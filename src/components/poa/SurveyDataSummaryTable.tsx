import { Card } from "@/components/ui/Card";

export interface SurveyRow {
  nip: string;
  name: string;
  totalOutlets: number;
  outletsWithSurvey: number;
  /** Only set for ASM rows — target=3 outlets exists at ASM level only (user: "target ini cuma ada di ASM"). */
  target: number | null;
  /**
   * ASM rows: outletsWithSurvey / target × 100 (uncapped).
   * NSM/SM/Total rows: % of the ASMs under this row that individually hit
   * their own target — not a rescaled outlet count, since there's no target
   * at these levels. `null` when there are no ASMs under this row at all.
   */
  achievementPct: number | null;
}

function achievementColor(pct: number | null): string {
  if (pct == null) return "var(--color-text-faint)";
  if (pct >= 100) return "var(--color-success, #16a34a)";
  if (pct >= 50) return "var(--color-warning, #f59e0b)";
  return "var(--color-red)";
}

function SurveySectionTable({ title, rows }: { title: string; rows: SurveyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card padded={false}>
      <p className="text-sm font-semibold px-3 pt-3 pb-2" style={{ color: "var(--color-text)" }}>{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Personil</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Total Outlet</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Outlet dengan Data Survey</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Target</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Achievement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-2 px-3">
                  <p className="font-medium">{r.name}</p>
                  {r.nip !== "TOTAL" && <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.totalOutlets}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.outletsWithSurvey}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>{r.target ?? "-"}</td>
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
 * "Data Survey" tab — 4 stacked sections (Total / Per NSM / Per SM / Per
 * ASM), each row = how many of that personil's outlets have SOME survey
 * data (web upload OR existing reference data), ALL-TIME (no quarter
 * filter — see summary/page.tsx's "Data Survey" tab comment). Computed
 * server-side in summary/page.tsx; this component only renders it. A
 * section with zero rows in scope (e.g. an ASM viewer has no NSM/SM rows)
 * is simply omitted.
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
