/**
 * KPI Monitoring scoring engine — see docs/kpi-monitoring/01-business-rules.md.
 * Source: Memo Internal SM/ETH-II/PI/08.2026 (28 Juli 2026, efektif 01 Agustus 2026).
 *
 * Several inputs here are WORKING ASSUMPTIONS (not stakeholder-confirmed),
 * flagged individually below — see docs/kpi-monitoring/01-business-rules.md §7
 * before relying on exact numbers for anything beyond the v1 rollout.
 */

export const KPI_WEIGHTS = {
  sales: 0.5,
  activity: 0.25,
  customer: 0.15,
  absensi: 0.1,
} as const;

/**
 * Memo "MR/Spv: 4+6, ASM: 2+3, SM: 3" (confirmed 2026-09-21): minimum AVERAGE
 * visits per active day — `day` for 08:00-15:00 WIB, `off` for 15:00-08:00.
 * SM has no time window, just `total`.
 */
export const CALL_ACTIVITY_MIN_BY_ROLE: Record<string, { day: number; off: number } | { total: number }> = {
  MR: { day: 4, off: 6 },
  ASM: { day: 2, off: 3 },
  SM: { total: 3 },
};

/** Sum of the per-window minimums — the denominator of achievement%. */
export const CALL_ACTIVITY_STANDARD_BY_ROLE: Record<string, number> = Object.fromEntries(
  Object.entries(CALL_ACTIVITY_MIN_BY_ROLE).map(([role, m]) => [role, "total" in m ? m.total : m.day + m.off])
);

/**
 * Effective realisasi = each window capped at its own minimum, then summed, so
 * surplus in one window can't hide a shortfall in the other. Achievement% =
 * this / CALL_ACTIVITY_STANDARD_BY_ROLE.
 */
export function callActivityRealisasiFromDailyAvgs(role: string, avgDay: number, avgOff: number): number | null {
  const m = CALL_ACTIVITY_MIN_BY_ROLE[role];
  if (!m) return null;
  const v = "total" in m ? Math.min(avgDay + avgOff, m.total) : Math.min(avgDay, m.day) + Math.min(avgOff, m.off);
  return Math.round(v * 100) / 100;
}

type Band = { max: number; score: number };

/** Ascending-is-better band lookup: first band whose ceiling the value meets. */
function scoreFromAscendingBands(value: number, bands: Band[]): number {
  for (const band of bands) {
    if (value < band.max) return band.score;
  }
  return bands[bands.length - 1].score;
}

// SR/R/S/T/ST → 40/55/70/85/100, achievement-% based (Sales Achievement, Call Activity).
const ACHIEVEMENT_BANDS: Band[] = [
  { max: 80, score: 40 },
  { max: 90, score: 55 },
  { max: 100, score: 70 },
  { max: 110, score: 85 },
  { max: Infinity, score: 100 },
];

/** Business Result — Sales Achievement (50%). achievementPct = actual/target*100. */
export function scoreSalesAchievement(achievementPct: number): number {
  return scoreFromAscendingBands(achievementPct, ACHIEVEMENT_BANDS);
}

// Call Activity bands are shifted slightly lower than sales (<70/70-79/80-89/90-99/>=100).
const CALL_ACTIVITY_BANDS: Band[] = [
  { max: 70, score: 40 },
  { max: 80, score: 55 },
  { max: 90, score: 70 },
  { max: 100, score: 85 },
  { max: Infinity, score: 100 },
];

/** Activity & Coverage — Call Activity (25%). achievementPct = realisasi/standar*100. */
export function scoreCallActivity(achievementPct: number): number {
  return scoreFromAscendingBands(achievementPct, CALL_ACTIVITY_BANDS);
}

const CUSTOMER_AKTIF_BANDS: Band[] = [
  { max: 6, score: 40 },
  { max: 9, score: 55 },
  { max: 12, score: 70 },
  { max: 15, score: 85 },
  { max: Infinity, score: 100 },
];

/** Market Development — Customer Expansion (15%). Absolute count, not a percentage. */
export function scoreCustomerExpansion(customerAktifCount: number): number {
  return scoreFromAscendingBands(customerAktifCount, CUSTOMER_AKTIF_BANDS);
}

/**
 * Attitude — Kepatuhan Absensi (10%). ASSUMPTION (§7.3): absensiValue = average
 * hours late reporting per month relative to the 08:00 WIB deadline — LOWER is
 * better (0 = ST/perfect). Descending-is-better, so bands are checked in
 * reverse (smallest ceiling scores highest).
 */
export function scoreAbsensi(absensiValue: number): number {
  if (absensiValue <= 0) return 100;
  if (absensiValue <= 0.5) return 85;
  if (absensiValue <= 1.0) return 70;
  if (absensiValue <= 2.0) return 55;
  return 40;
}

export type KpiPillarScores = {
  salesScore: number;
  activityScore: number;
  customerScore: number;
  absensiScore: number;
};

/** Weighted sum of the 4 pillar scores → Total Score KPI (0-100). */
export function computeTotalScore(scores: KpiPillarScores): number {
  const total =
    scores.salesScore * KPI_WEIGHTS.sales +
    scores.activityScore * KPI_WEIGHTS.activity +
    scores.customerScore * KPI_WEIGHTS.customer +
    scores.absensiScore * KPI_WEIGHTS.absensi;
  return Math.round(total * 100) / 100;
}

export type ContractRecommendation = {
  months: 12 | 9 | 6 | 0;
  label: string;
};

/** Total Score KPI → contract-extension recommendation (memo §4). Not a final decision — atasan may override. */
export function recommendContractMonths(totalScore: number): ContractRecommendation {
  if (totalScore > 85) return { months: 12, label: "Sangat Baik" };
  if (totalScore >= 71) return { months: 9, label: "Baik" };
  if (totalScore >= 55) return { months: 6, label: "Perlu evaluasi" };
  return { months: 0, label: "Tidak direkomendasikan" };
}
