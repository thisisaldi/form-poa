/**
 * Evaluasi Kontrak Non-Hospital — pure scoring helpers (no DB). Spec:
 * docs/evaluasi-kontrak-non-hospital/. Formulas were derived from the sample
 * numbers in the prototype and re-verified (scripts/checkNonHospitalScoring.ts).
 */

import { scoreCallActivity, scoreSalesAchievement, recommendContractMonths } from "@/lib/kpiScoring";

export const NH_WEIGHTS = { sales: 0.5, kunjungan: 0.25, sc: 0.15, absensi: 0.1 } as const;
/** ASSUMPTION (OQ-7): 12 visits/day for every jabatan; the prototype only shows PSR. */
export const NH_VISIT_TARGET_PER_DAY = 12;
export const NH_WINDOW_MONTHS = 6;

export type NhIndicatorKey = keyof typeof NH_WEIGHTS;

export interface NhIndicator {
  key: NhIndicatorKey;
  name: string;
  weight: number;
  /** Average over the window's valid months; null when no month had data. */
  real: number | null;
  realLabel: string;
  /** Band value 0-100; null when the band is not defined yet or there is no real value. */
  nilai: number | null;
  /** nilai × weight; null when nilai is null. */
  score: number | null;
  /** Why nilai is null although real exists (band unconfirmed). */
  nilaiNote?: string;
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ASSUMPTION (OQ-4, from the prototype's sample: contract ends Oct 2026 →
 * window Mar-Aug 2026): the window is the NH_WINDOW_MONTHS complete months
 * ending two months before the contract-end month (evaluation happens in the
 * month before the contract ends). Clamped so it never starts before the
 * contract's start month.
 */
export function windowMonths(awalKontrak: Date, akhirKontrak: Date): string[] {
  const end = addMonths(periodOf(akhirKontrak), -2);
  let start = addMonths(end, -(NH_WINDOW_MONTHS - 1));
  const awal = periodOf(awalKontrak);
  if (start < awal) start = awal;
  const out: string[] = [];
  for (let p = start; p <= end; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function average(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** ACH of one month = visits ÷ (active days × target/day). Active days = days with >= 1 visit (same as Hospital Call Activity). */
export function visitAchievement(visits: number, activeDays: number): number | null {
  return activeDays > 0 ? visits / (activeDays * NH_VISIT_TARGET_PER_DAY) : null;
}

// SC Menang and Absensi (hari telat) bands are NOT defined anywhere yet (OQ-2 / OQ-3, blocking)
// — the prototype has one data point each and a band can't be guessed from that.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scoreScMenang(_avgSc: number): number | null {
  return null;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scoreAbsensiHariTelat(_avgHari: number): number | null {
  return null;
}

const pctLabel = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);

export function buildIndicators(input: {
  salesAch: (number | null)[];
  kunjunganAch: (number | null)[];
  sc: (number | null)[];
  telat: (number | null)[];
}): NhIndicator[] {
  const sales = average(input.salesAch);
  const kunj = average(input.kunjunganAch);
  const sc = average(input.sc);
  const telat = average(input.telat);
  const make = (
    key: NhIndicatorKey, name: string, real: number | null, realLabel: string, nilai: number | null, nilaiNote?: string
  ): NhIndicator => ({
    key, name, weight: NH_WEIGHTS[key], real, realLabel, nilai,
    score: nilai != null ? Math.round(nilai * NH_WEIGHTS[key] * 100) / 100 : null,
    nilaiNote: nilai == null && real != null ? nilaiNote : undefined,
  });
  return [
    make("sales", "Achievement Target", sales, pctLabel(sales), sales != null ? scoreSalesAchievement(sales * 100) : null),
    make("kunjungan", "Jumlah Kunjungan", kunj, pctLabel(kunj), kunj != null ? scoreCallActivity(kunj * 100) : null),
    make("sc", "Jumlah SC Menang", sc, sc == null ? "–" : `${sc % 1 ? sc.toFixed(1) : sc} SC`, sc != null ? scoreScMenang(sc) : null, "Band nilai SC Menang belum dikonfirmasi"),
    make("absensi", "Absensi", telat, telat == null ? "–" : `${telat.toFixed(1)} hari/bln`, telat != null ? scoreAbsensiHariTelat(telat) : null, "Band nilai Absensi belum dikonfirmasi"),
  ];
}

/** Total only when all four indicators have a nilai; otherwise null (never a partial total). */
export function totalScore(indicators: NhIndicator[]): number | null {
  if (indicators.some((i) => i.score == null)) return null;
  return Math.round(indicators.reduce((s, i) => s + (i.score as number), 0) * 100) / 100;
}

export function recommendationFor(total: number | null) {
  return total == null ? null : recommendContractMonths(total);
}
