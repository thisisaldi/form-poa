/**
 * Plain (non-"use client") module for PHASES — needs to be importable from
 * server code (e.g. the /poa-standarisasi list page) directly. Importing a
 * value export from a "use client" file breaks when used server-side (same
 * class of bug as hargaST in masterData.ts, 2026-08-19): every export from a
 * client-directive module becomes a client reference, which for functions
 * throws "not a function" when called server-side.
 */
export const PHASES = [
  { id: "PLANNING", label: "Planning Standarisasi" },
  { id: "APPROVAL_ATASAN", label: "Approval Atasan" },
  { id: "APPROVAL_USER_DOKTER", label: "Approval User / Dokter" },
  { id: "MENUNGGU_MEETING_KFT", label: "Menunggu Meeting KFT" },
  { id: "FINALISASI", label: "Finalisasi" },
] as const;
