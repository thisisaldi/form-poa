/**
 * Menu "KPI Personil" (leaderboard, detail, summary, monitoring perpanjangan,
 * evaluasi non-hospital, dan semua /api/kpi-*) dimatikan untuk selain ADMIN
 * (user, 2026-10-22). Satu-satunya sumber: untuk membukanya lagi untuk role
 * lain, ubah daftar ini — setiap halaman, API, dan server action KPI membaca
 * daftar ini lalu menyaring dengan aturan role masing-masing.
 */
export const KPI_PERSONIL_ROLES: readonly string[] = ["ADMIN"];

export const KPI_PERSONIL_DISABLED_MESSAGE = "Fitur KPI Personil hanya untuk admin saat ini.";

export function canUseKpiPersonil(role: string | undefined | null): boolean {
  return !!role && KPI_PERSONIL_ROLES.includes(role);
}
