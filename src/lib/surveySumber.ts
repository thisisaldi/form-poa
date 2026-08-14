/**
 * Whitelist for "Sumber" on Input Data Survey (docs/TODO.md #18).
 *
 * Dikonfirmasi pengguna 2026-08-13. Plain string array (bukan Postgres enum
 * di schema.prisma) — daftar ini tetap gampang diedit di sini kalau berubah
 * lagi nanti, tanpa migration DB baru — lihat SurveyUploadLog.sumber di
 * prisma/schema.prisma.
 */
export const SURVEY_SUMBER_OPTIONS = [
  "Programmer/IT (Internal RS)",
  "Apoteker (Internal RS)",
  "Bagian Pembelian/Pengadaan (Internal RS)",
  "Bagian Gudang",
  "Tukang Amprah",
  "Komputer Dokter/Perawat",
  "Perawat (Internal RS)",
  "Sales Farmasi Lain (Eksternal RS)",
  "Lainnya",
] as const;

export type SurveySumber = (typeof SURVEY_SUMBER_OPTIONS)[number];
