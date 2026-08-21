import type { PoaStatus } from "@prisma/client";

export interface DoctorActions {
  canApprove: boolean;
  canFastTrack: boolean;
  canCancel: boolean;
  approveAction: () => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
  fastTrackAction: () => Promise<void>;
  cancelAction: (formData: FormData) => Promise<void>;
}

export interface ScProductItemData {
  id: string;
  kodeProduk: string;
  namaProduk: string;
  produkKompetitor: string | null;
  pembeliHari: number;
  qtyCustomerBaru: number;
  persenMatriksSc: number;
  persenDiskon: number;
  persenCashback: number;
  rencanaTotalBiaya: number;
  // Master product info for calculations
  hnaSJ?: number;
  konversiPembagi?: number;
  satuanTerkecil?: string;
  satuanSJ?: string;
  salesCounterValue?: number;
  salesCounterMinimum?: number;
}

export interface ScPersonItemData {
  id: string;
  nik_ktp: string;
  personName: string;
  positionName: string;
}

export interface ScEntertainItemData {
  id: string;
  periodeMonth: string;
  biayaEntertain: number;
}

export interface ScDraftFormItem {
  id: string;
  period: string;
  periodeAwal: string;
  lamaPeriode: number;
  status: PoaStatus;
  version: number;
  kodePI: string;
  namaOutlet: string;
  hariKerjaBulan: number;
  rencanaVisitMinggu: number;
  surveyPasienHarian: number;
  ownerId: string;
  is_sc?: boolean;
  isBlastIn?: boolean;
  products: ScProductItemData[];
  persons: ScPersonItemData[];
  entertainItems: ScEntertainItemData[];
}

export interface SalesFigures {
  historisTahunLalu: number;
  historisTahunLaluLabel: string;
  salesYtd: number;
  growthPct: number;
}
