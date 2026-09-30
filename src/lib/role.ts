/**
 * `jabatan` is a display-only override of what's shown as a user's title
 * (currently only ever "SPV") — their `role`/permissions never change, see
 * scripts/importStrukturHospital.ts. Every UI spot that shows a role label
 * should go through this instead of reading `.role` directly.
 */
export function displayRole(role: string, jabatan?: string | null): string {
  return jabatan || role;
}

// Rantai sales sesungguhnya (bukan ADMIN/GM/SD/SFE/VIEWER/SALES_SUPPORT) —
// dipakai buat nyaring data yang dibuat non-sales (biasanya ADMIN testing di
// production) keluar dari view/export company-wide. Lihat pemakaiannya di
// getStandarisasiDashboardAction dan /api/poa-standarisasi/export.
export const SALES_TEAM_ROLES = ["MR", "ASM", "SM", "NSM"] as const;

// Role yang boleh membuka daftar/detail POA Standarisasi (user 2026-09-29:
// "ikuti POA PSSP"); visibilitas per role di listVisiblePoaStandarisasiAction.
// Sales Support tetap hanya halaman memo.
export const POA_STANDARISASI_VIEW_ROLES: string[] = ["MR", "ASM", "SM", "NSM", "GM", "SD", "SFE", "VIEWER", "ADMIN"];
