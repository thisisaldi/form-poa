import { Card } from "@/components/ui/Card";
import type { KpiPersonnelRow } from "@/app/actions/kpi";
import { TONE_STYLE, scoreTone, type Tone } from "./kpiUi";

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const RECOMMENDATION_BANDS: { months: number; label: string; tone: Tone }[] = [
  { months: 12, label: "Sangat Baik", tone: "good" },
  { months: 9, label: "Baik", tone: "ok" },
  { months: 6, label: "Perlu evaluasi", tone: "warn" },
  { months: 0, label: "Tidak direkomendasikan", tone: "bad" },
];

function StatCard({ label, weight, value, hint }: { label: string; weight?: string; value: number | null; hint?: string }) {
  const tone = TONE_STYLE[scoreTone(value)];
  return (
    <Card className="p-4!">
      <p className="flex items-baseline justify-between text-xs" style={{ color: "var(--color-text-muted)" }}>
        <span className="font-medium">{label}</span>
        {weight && <span style={{ color: "var(--color-text-faint)" }}>{weight}</span>}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color: value != null ? tone.fg : "var(--color-text-faint)" }}>
        {value != null ? value.toFixed(1) : "–"}
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
        <div className="h-full rounded-full" style={{ width: `${value != null ? Math.min(100, Math.max(0, value)) : 0}%`, background: tone.solid }} />
      </div>
      {hint && <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{hint}</p>}
    </Card>
  );
}

/**
 * Ringkasan di atas tabel KPI: rata-rata skor Total + per pilar (0-100), dan
 * distribusi rekomendasi kontrak sebagai satu bar bertumpuk.
 */
export function KpiDashboardStats({ rows }: { rows: KpiPersonnelRow[] }) {
  const scoredRows = rows.filter((r) => r.totalScore != null);
  const incompleteCount = rows.length - scoredRows.length;

  const avgTotal = avg(scoredRows.map((r) => r.totalScore!));
  const avgSales = avg(rows.map((r) => r.salesScore).filter((v): v is number => v != null));
  const avgActivity = avg(rows.map((r) => r.activityScore).filter((v): v is number => v != null));
  const avgCustomer = avg(rows.map((r) => r.customerScore));
  const avgAbsensi = avg(rows.map((r) => r.absensiScore).filter((v): v is number => v != null));

  const countByMonths = new Map<number, number>();
  for (const r of scoredRows) {
    const months = r.recommendation!.months;
    countByMonths.set(months, (countByMonths.get(months) ?? 0) + 1);
  }
  const segments = [
    ...RECOMMENDATION_BANDS.map((b) => ({ key: String(b.months), label: `${b.months} bln — ${b.label}`, tone: b.tone, count: countByMonths.get(b.months) ?? 0 })),
    { key: "incomplete", label: "Belum lengkap", tone: "none" as Tone, count: incompleteCount },
  ];
  const total = rows.length || 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Score" value={avgTotal} hint={`${scoredRows.length} lengkap · ${incompleteCount} belum`} />
        <StatCard label="Sales" weight="50%" value={avgSales} hint="rata-rata skor" />
        <StatCard label="Activity" weight="25%" value={avgActivity} hint="rata-rata skor" />
        <StatCard label="Customer" weight="15%" value={avgCustomer} hint="rata-rata skor" />
        <StatCard label="Absensi" weight="10%" value={avgAbsensi} hint="rata-rata skor" />
      </div>

      <Card className="p-4!">
        <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Distribusi rekomendasi kontrak</p>
        <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="img"
          aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}>
          {segments.map((s) => s.count > 0 && (
            <div key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: TONE_STYLE[s.tone].solid }} title={`${s.label}: ${s.count}`} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: TONE_STYLE[s.tone].solid }} aria-hidden />
              {s.label}
              <span className="font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{s.count}</span>
              <span className="tabular-nums" style={{ color: "var(--color-text-faint)" }}>({Math.round((s.count / total) * 100)}%)</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
