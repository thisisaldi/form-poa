/**
 * Plain (non-"use client") module for PHASES — needs to be importable from
 * server code (e.g. the /poa-standarisasi list page) directly. Importing a
 * value export from a "use client" file breaks when used server-side (same
 * class of bug as hargaST in masterData.ts, 2026-08-19): every export from a
 * client-directive module becomes a client reference, which for functions
 * throws "not a function" when called server-side.
 */
// "Menunggu Meeting KFT" dihapus dari flow (2026-09-08, user request) — Phase
// 3 (Approval User/Dokter) lompat langsung ke Finalisasi. Nilai enum
// PoaStandarisasiPhase.MENUNGGU_MEETING_KFT tetap ada di schema (data
// historis lama), tapi tidak lagi diproduksi/ditampilkan — lihat
// advanceToFinalisasiAction (poaStandarisasi.ts) dan migration
// 20260908020000_poasc_drop_menunggu_meeting_kft_phase.
export const PHASES = [
  { id: "PLANNING", label: "Planning Standarisasi" },
  { id: "APPROVAL_ATASAN", label: "Approval Atasan" },
  { id: "APPROVAL_USER_DOKTER", label: "Approval User / Dokter" },
  { id: "FINALISASI", label: "Finalisasi" },
] as const;
