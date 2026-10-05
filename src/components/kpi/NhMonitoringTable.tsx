import { Card } from "@/components/ui/Card";
import type { NhMonitoringRow } from "@/lib/nonHospitalEvaluation";
import { TONE_STYLE, roleLabel, scoreTone } from "./kpiUi";

const rp = (v: number | null) => (v == null ? "–" : `Rp${Math.round(v).toLocaleString("id-ID")}`);
const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const TD = "px-3 py-2.5";
const CELL = { borderBottom: "1px solid var(--color-border)" };

function Score({ nilai }: { nilai: number | null }) {
  if (nilai == null) return null;
  const t = TONE_STYLE[scoreTone(nilai)];
  return <span className="ml-1.5 rounded px-1.5 py-0.5 font-semibold tabular-nums" style={{ background: t.bg, color: t.fg }}>{nilai}</span>;
}

/** Monthly monitoring table, all OMEGA MR/ASM/SM. Total/Rekomendasi stay "–" until the SC Menang/Absensi bands are confirmed (OQ-2/OQ-3). */
export function NhMonitoringTable({ rows }: { rows: NhMonitoringRow[] }) {
  if (rows.length === 0) {
    return <Card><p className="p-6 text-sm" style={{ color: "var(--color-text-muted)" }}>Tidak ada personil OMEGA aktif.</p></Card>;
  }
  return (
    <Card className="p-0!">
      <div className="max-h-[72vh] overflow-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20" style={{ background: "var(--color-surface)", boxShadow: "0 1px 0 var(--color-border)" }}>
            <tr style={{ color: "var(--color-text-faint)" }}>
              {["Personil", "Role", "Wilayah (GT)", "Achievement (50%)", "Kunjungan (25%)", "SC Menang (15%)", "Absensi (10%)", "Total", "Akhir Kontrak"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [sales, kunj, sc, abs] = r.indicators;
              return (
                <tr key={r.nip} className="hover:bg-[var(--color-bg-subtle)]" title={r.notes.join(" · ")}>
                  <td className={TD} style={CELL}>
                    <p className="max-w-[14rem] truncate text-[13px] font-medium">{r.name}</p>
                    <p className="tabular-nums" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>
                  </td>
                  <td className={TD} style={CELL}>{roleLabel(r.role, r.jabatan)}</td>
                  <td className={`${TD} whitespace-nowrap`} style={CELL}>{r.gt ?? "–"}</td>
                  <td className={TD} style={CELL}>
                    <span className="tabular-nums">{pct(r.month.ach)}</span><Score nilai={sales.nilai} />
                    <p style={{ color: "var(--color-text-faint)" }}>{rp(r.month.sales)} / {rp(r.month.target)}</p>
                  </td>
                  <td className={TD} style={CELL}>
                    <span className="tabular-nums">{pct(r.month.achKunjungan)}</span><Score nilai={kunj.nilai} />
                    <p style={{ color: "var(--color-text-faint)" }}>{r.month.visit != null ? `${r.month.visit} visit · ${r.month.hariAktif} hari` : "Kosong"}</p>
                  </td>
                  <td className={`${TD} tabular-nums`} style={CELL}>{sc.realLabel}</td>
                  <td className={`${TD} tabular-nums`} style={CELL}>{abs.realLabel}</td>
                  <td className={`${TD} tabular-nums`} style={CELL}>{r.totalScore != null ? r.totalScore.toFixed(2) : "–"}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`} style={CELL}>{r.akhirKontrak ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
