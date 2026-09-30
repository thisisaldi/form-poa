/**
 * Distributor POA Standarisasi (enum DistributorPilihan: AMS/PPG/MPI) ke
 * distributor_id + distributor_name yang dipakai Exodus di
 * POST /promotion/v1/request/discount.
 *
 * id + nama lengkap dikonfirmasi user (2026-09-29).
 */
export const EXODUS_DISTRIBUTORS = {
  AMS: { id: 1, name: "ANTARMITRA SEMBADA, PT" },
  PPG: { id: 2, name: "PARIT PADANG GLOBAL, PT" },
  MPI: { id: 3, name: "MILLENNIUM PHARMACON INTERNATIONAL, PT" },
} as const;

export type ExodusDistributorKode = keyof typeof EXODUS_DISTRIBUTORS;
