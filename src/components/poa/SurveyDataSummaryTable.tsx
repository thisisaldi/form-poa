import { Card } from "@/components/ui/Card";

export interface SurveyAsmRow {
  nip: string;
  name: string;
  totalOutlets: number;
  outletsWithSurvey: number;
  achieved: boolean;
}

/**
 * "Data Survey" tab — one row per ASM in scope: how many of their team's
 * outlets have SOME survey data (web upload OR existing reference data),
 * against a fixed target of `targetOutlets`, ALL-TIME (no quarter filter —
 * see summary/page.tsx's "Data Survey" tab comment for why). Computed
 * server-side in summary/page.tsx; this component only renders it.
 */
export function SurveyDataSummaryTable({ rows, targetOutlets }: { rows: SurveyAsmRow[]; targetOutlets: number }) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tidak ada ASM dalam scope kamu.
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
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>ASM</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Total Outlet</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Outlet dengan Data Survey</th>
              <th className="text-right py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Target</th>
              <th className="text-left py-2 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-2 px-3">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.totalOutlets}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{r.outletsWithSurvey}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>{targetOutlets}</td>
                <td className="py-2 px-3 whitespace-nowrap" style={{ color: r.achieved ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                  {r.achieved ? "Tercapai" : `Belum (${r.outletsWithSurvey}/${targetOutlets})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
