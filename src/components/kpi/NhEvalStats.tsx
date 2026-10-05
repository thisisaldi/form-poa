import { Card } from "@/components/ui/Card";
import type { NhEvalRow } from "@/lib/nonHospitalEvaluation";
import { TONE_STYLE, scoreTone } from "./kpiUi";

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function Stat({ label, value, sub, color, bar }: { label: string; value: string; sub?: string; color?: string; bar?: { pct: number; color: string } }) {
  return (
    <Card className="p-4!">
      <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</p>
      {bar && (
        <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%`, background: bar.color }} />
        </div>
      )}
      {sub && <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{sub}</p>}
    </Card>
  );
}

/** Ringkasan di atas tabel Evaluasi Kontrak Non-Hospital (kartu dari prototipe, gaya mengikuti KpiDashboardStats). */
export function NhEvalStats({ rows, periodText }: { rows: NhEvalRow[]; periodText: string }) {
  const scored = rows.filter((r) => r.totalScore != null);
  const avg = scored.length ? scored.reduce((s, r) => s + (r.totalScore as number), 0) / scored.length : null;
  const problem = rows.filter((r) => r.notes.length > 0).length;
  const undecided = rows.filter((r) => !r.decision).length;
  const byJabatan = new Map<string, number>();
  for (const r of rows) if (r.jabatan) byJabatan.set(r.jabatan, (byJabatan.get(r.jabatan) ?? 0) + 1);
  const tone = TONE_STYLE[scoreTone(avg)];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Total Personil" value={String(rows.length)} sub={[...byJabatan].map(([j, n]) => `${n} ${titleCase(j)}`).join(" · ") || undefined} />
      <Stat label="Rata-rata Total Score" value={avg != null ? avg.toFixed(1) : "–"} color={avg != null ? tone.fg : undefined}
        bar={avg != null ? { pct: avg, color: tone.solid } : undefined} sub={`${scored.length} dari ${rows.length} sudah bernilai`} />
      <Stat label="Data Lengkap" value={String(rows.length - problem)} color={TONE_STYLE.good.fg} sub={`dari ${rows.length} personil`} />
      <Stat label="Data Bermasalah" value={String(problem)} color={problem ? TONE_STYLE.warn.fg : "var(--color-text-faint)"} sub="target/kunjungan kosong & sejenis" />
      <Stat label={`Kontrak Berakhir ${periodText}`} value={String(undecided)} sub="belum diputuskan" />
    </div>
  );
}
