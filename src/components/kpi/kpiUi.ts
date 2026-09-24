/** Shared display helpers for the /kpi-perpanjangan components (color tone, role label). */

export type Tone = "good" | "ok" | "warn" | "bad" | "none";

// Text colors are one step darker than the brand tokens so the small pill text keeps >= 4.5:1 contrast on the light tint.
export const TONE_STYLE: Record<Tone, { fg: string; bg: string; solid: string }> = {
  good: { fg: "#006B32", bg: "var(--color-green-light)", solid: "var(--color-green)" },
  ok: { fg: "var(--color-blue)", bg: "var(--color-blue-light)", solid: "var(--color-blue)" },
  warn: { fg: "#7A5A12", bg: "var(--color-warning-bg)", solid: "var(--color-warning)" },
  bad: { fg: "var(--color-error)", bg: "var(--color-error-bg)", solid: "var(--color-error)" },
  none: { fg: "var(--color-text-faint)", bg: "var(--color-bg-subtle)", solid: "var(--color-border-strong)" },
};

/** Score bands used across the KPI page (same cut-offs as the old table: 85 / 70 / 55). */
export function scoreTone(score: number | null): Tone {
  if (score == null) return "none";
  if (score >= 85) return "good";
  if (score >= 70) return "ok";
  if (score >= 55) return "warn";
  return "bad";
}

/** Contract recommendation (12 / 9 / 6 / 0 months) → tone. */
export function recommendationTone(months: number | null): Tone {
  if (months == null) return "none";
  if (months === 12) return "good";
  if (months === 9) return "ok";
  if (months === 6) return "warn";
  return "bad";
}

export type RoleLabel = "MR" | "SPV" | "ASM" | "SM";

/**
 * Display role. `User.jabatan` carries the raw HR/Exodus title, so MRs show up
 * as "Field Force" — but Field Force IS the MR role. Supervisors keep "SPV"
 * (jabatan override on role MR, see orgStructureSync.ts).
 */
export function roleLabel(role: string, jabatan: string | null): string {
  const j = jabatan?.trim();
  if (!j || /^field force$/i.test(j)) return role;
  if (/^(spv|supervisor)$/i.test(j)) return "SPV";
  return j;
}

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "2026-08" → "Agustus 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return MONTHS_ID[m - 1] ? `${MONTHS_ID[m - 1]} ${y}` : period;
}
