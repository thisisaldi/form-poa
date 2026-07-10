/**
 * In-memory mock dataset for local development (USE_MOCK_DB=true).
 * Mirrors the Prisma model shapes closely enough to satisfy all page queries.
 */

import type { User, PoaForm, PoaAuditLog, PoaLineItem } from "@prisma/client";
import { Role, PoaStatus, AuditAction, StatusStandarisasi, Prisma } from "@prisma/client";

const d = (v: string) => new Prisma.Decimal(v);

const NOW = new Date("2026-07-09T08:00:00Z");
const EARLIER = new Date("2026-07-01T08:00:00Z");

// ─── Users ───────────────────────────────────────────────────────────────────

export const MOCK_USERS: User[] = [
  {
    nip: "NSM001",
    name: "Budi Santoso",
    role: Role.NSM,
    email: "budi@example.com",
    nipAtasan: null,
    namaAtasan: null,
    isActive: true,
    syncedAt: NOW,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    nip: "SM001",
    name: "Rina Wulandari",
    role: Role.SM,
    email: "rina@example.com",
    nipAtasan: "NSM001",
    namaAtasan: "Budi Santoso",
    isActive: true,
    syncedAt: NOW,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    nip: "ASM001",
    name: "Agus Pratama",
    role: Role.ASM,
    email: "agus@example.com",
    nipAtasan: "SM001",
    namaAtasan: "Rina Wulandari",
    isActive: true,
    syncedAt: NOW,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    nip: "MR001",
    name: "Siti Rahayu",
    role: Role.MR,
    email: "siti@example.com",
    nipAtasan: "ASM001",
    namaAtasan: "Agus Pratama",
    isActive: true,
    syncedAt: NOW,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    nip: "MR002",
    name: "Dodi Prasetyo",
    role: Role.MR,
    email: "dodi@example.com",
    nipAtasan: "ASM001",
    namaAtasan: "Agus Pratama",
    isActive: true,
    syncedAt: NOW,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
];

// ─── POA Forms ───────────────────────────────────────────────────────────────

export const MOCK_POAS: PoaForm[] = [
  {
    id: "poa-001",
    period: "2026-07",
    status: PoaStatus.SUBMITTED_TO_ASM,
    ownerId: "MR001",
    currentHolderId: "ASM001",
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "poa-002",
    period: "2026-07",
    status: PoaStatus.DRAFT,
    ownerId: "MR002",
    currentHolderId: null,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "poa-003",
    period: "2026-06",
    status: PoaStatus.APPROVED_BY_NSM,
    ownerId: "MR001",
    currentHolderId: null,
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-15"),
  },
];

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export const MOCK_AUDIT_LOGS: PoaAuditLog[] = [
  {
    id: "log-001",
    poaId: "poa-001",
    actorId: "MR001",
    action: AuditAction.CREATE,
    fromStatus: null,
    toStatus: PoaStatus.DRAFT,
    snapshot: {},
    createdAt: EARLIER,
  },
  {
    id: "log-002",
    poaId: "poa-001",
    actorId: "MR001",
    action: AuditAction.SUBMIT,
    fromStatus: PoaStatus.DRAFT,
    toStatus: PoaStatus.SUBMITTED_TO_ASM,
    snapshot: {},
    createdAt: NOW,
  },
];

// ─── Master Reference Data (customer & product catalogues) ───────────────────

export interface MockCustomer {
  kodeRequest: string;
  kodeCust: string;
  namaCust: string;
  role: string;
  spesialisasi: string;
  historisPSSP: string | null;
  kodePI: string | null;
  namaOutlet: string;
}

export interface MockProduct {
  kodeProduk: string;
  namaGroupBrand: string;
  namaProduk: string;
  zatAktif: string | null;
  satuan: string;
  hna: { toString(): string };
}

export const MOCK_CUSTOMERS: MockCustomer[] = [
  {
    kodeRequest: "C-001",
    kodeCust: "K001",
    namaCust: "dr. Andi Kusuma, Sp.PD",
    role: "Dokter Spesialis",
    spesialisasi: "Penyakit Dalam",
    historisPSSP: "PSSP-2025-001",
    kodePI: "PI-001",
    namaOutlet: "RS Medika Utama",
  },
  {
    kodeRequest: "C-002",
    kodeCust: "K002",
    namaCust: "dr. Dewi Lestari, Sp.JP",
    role: "Dokter Spesialis",
    spesialisasi: "Kardiologi",
    historisPSSP: null,
    kodePI: "PI-002",
    namaOutlet: "Klinik Jantung Sehat",
  },
  {
    kodeRequest: "C-003",
    kodeCust: "K003",
    namaCust: "dr. Hendra Gunawan, Sp.S",
    role: "Dokter Spesialis",
    spesialisasi: "Neurologi",
    historisPSSP: "PSSP-2025-003",
    kodePI: null,
    namaOutlet: "RS Pusat Otak Nasional",
  },
  {
    kodeRequest: "C-004",
    kodeCust: "K004",
    namaCust: "dr. Irma Suryani, Sp.DV",
    role: "Dokter Spesialis",
    spesialisasi: "Dermatologi",
    historisPSSP: null,
    kodePI: "PI-004",
    namaOutlet: "Klinik Kulit Cantik",
  },
  {
    kodeRequest: "C-005",
    kodeCust: "K005",
    namaCust: "dr. Fikri Hakim, Sp.OG",
    role: "Dokter Spesialis",
    spesialisasi: "Kebidanan",
    historisPSSP: "PSSP-2025-005",
    kodePI: "PI-005",
    namaOutlet: "RS Ibu dan Anak Bunda",
  },
];

export const MOCK_PRODUCTS: MockProduct[] = [
  {
    kodeProduk: "0100211",
    namaGroupBrand: "ASCARDIA",
    namaProduk: "ASCARDIA 80MG TAB 100'S",
    zatAktif: "Acetylsalicylic acid 80 mg",
    satuan: "BOX",
    hna: { toString: () => "97750" },
  },
  {
    kodeProduk: "0100683",
    namaGroupBrand: "CLINOVIR",
    namaProduk: "CLINOVIR CREAM 5GR",
    zatAktif: "Acyclovir",
    satuan: "TUBE",
    hna: { toString: () => "38500" },
  },
  {
    kodeProduk: "0100684",
    namaGroupBrand: "CLINOVIR",
    namaProduk: "CLINOVIR 200MG TAB 30'S",
    zatAktif: "Acyclovir 200 mg",
    satuan: "BOX",
    hna: { toString: () => "142000" },
  },
  {
    kodeProduk: "0109345",
    namaGroupBrand: "KOLTON",
    namaProduk: "KOLTON 100MG TAB 50'S",
    zatAktif: "Allopurinol 100 mg",
    satuan: "BOX",
    hna: { toString: () => "65000" },
  },
];

// ─── POA Line Items ───────────────────────────────────────────────────────────

export const MOCK_LINE_ITEMS: PoaLineItem[] = [
  // poa-001: Siti Rahayu — 2 customers, 3 line items total
  {
    id: "li-001",
    poaId: "poa-001",
    kodeRequest: "C-001",
    kodeCust: "K001",
    namaCust: "dr. Andi Kusuma, Sp.PD",
    role: "Dokter Spesialis",
    spesialisasi: "Penyakit Dalam",
    historisPSSP: "PSSP-2025-001",
    kodePI: "PI-001",
    namaOutlet: "RS Medika Utama",
    kodeProduk: "0100211",
    namaProduk: "ASCARDIA 80MG TAB 100'S",
    kategoriProdukFokus: "ASCARDIA",
    itemKode: "0100211",
    satuanTerkecil: "BOX",
    produkKompetitor: "Lovacard",
    statusStandarisasi: StatusStandarisasi.SUDAH_STANDARISASI,
    hariKerjaBulan: null,
    jumlahPasienHari: null,
    jumlahResepHari: null,
    qtyProdukResep: null,
    lamaPeriode: 3,
    periodeAwal: "202607",
    rencanaTotalBiaya: d("1500000"),
    rencanaVisitMinggu: 2,
    nilaiR: d("1200000"),
    historySales3Bln: d("3500000"),
    avgDiskon: d("0.05"),
    hargaSatuanTerkecil: null,
    estimasiPSSPBulan: null,
    totalEstimasiPSSPBulan: null,
    pengaliNilaiR: null,
    rekomendasiBiayaBulan: null,
    totalRekomendasiBiayaBulan: null,
    estimasiPSSPPeriode: null,
    totalEstimasiPSSPPeriode: null,
    rekomendasiBiayaPeriode: null,
    totalRekomendasiBiayaPeriode: null,
    rasioRekomenEstimasi: null,
    rasioRencanaBiayaEstimasi: null,
    totalPersenBudget: null,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "li-002",
    poaId: "poa-001",
    kodeRequest: "C-001",
    kodeCust: "K001",
    namaCust: "dr. Andi Kusuma, Sp.PD",
    role: "Dokter Spesialis",
    spesialisasi: "Penyakit Dalam",
    historisPSSP: "PSSP-2025-001",
    kodePI: "PI-001",
    namaOutlet: "RS Medika Utama",
    kodeProduk: "0100683",
    namaProduk: "CLINOVIR CREAM 5GR",
    kategoriProdukFokus: "CLINOVIR",
    itemKode: "0100683",
    satuanTerkecil: "TUBE",
    produkKompetitor: null,
    statusStandarisasi: StatusStandarisasi.PROSES_PENGAJUAN,
    hariKerjaBulan: null,
    jumlahPasienHari: null,
    jumlahResepHari: null,
    qtyProdukResep: null,
    lamaPeriode: 3,
    periodeAwal: "202607",
    rencanaTotalBiaya: d("800000"),
    rencanaVisitMinggu: 1,
    nilaiR: d("600000"),
    historySales3Bln: d("1800000"),
    avgDiskon: d("0.03"),
    hargaSatuanTerkecil: null,
    estimasiPSSPBulan: null,
    totalEstimasiPSSPBulan: null,
    pengaliNilaiR: null,
    rekomendasiBiayaBulan: null,
    totalRekomendasiBiayaBulan: null,
    estimasiPSSPPeriode: null,
    totalEstimasiPSSPPeriode: null,
    rekomendasiBiayaPeriode: null,
    totalRekomendasiBiayaPeriode: null,
    rasioRekomenEstimasi: null,
    rasioRencanaBiayaEstimasi: null,
    totalPersenBudget: null,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
  {
    id: "li-003",
    poaId: "poa-001",
    kodeRequest: "C-002",
    kodeCust: "K002",
    namaCust: "dr. Dewi Lestari, Sp.JP",
    role: "Dokter Spesialis",
    spesialisasi: "Kardiologi",
    historisPSSP: null,
    kodePI: "PI-002",
    namaOutlet: "Klinik Jantung Sehat",
    kodeProduk: "0100684",
    namaProduk: "CLINOVIR 200MG TAB 30'S",
    kategoriProdukFokus: "CLINOVIR",
    itemKode: "0100684",
    satuanTerkecil: "BOX",
    produkKompetitor: "Atorfix",
    statusStandarisasi: StatusStandarisasi.BELUM_STANDARISASI,
    hariKerjaBulan: null,
    jumlahPasienHari: null,
    jumlahResepHari: null,
    qtyProdukResep: null,
    lamaPeriode: 3,
    periodeAwal: "202607",
    rencanaTotalBiaya: d("2000000"),
    rencanaVisitMinggu: 2,
    nilaiR: d("1800000"),
    historySales3Bln: d("5400000"),
    avgDiskon: d("0.07"),
    hargaSatuanTerkecil: null,
    estimasiPSSPBulan: null,
    totalEstimasiPSSPBulan: null,
    pengaliNilaiR: null,
    rekomendasiBiayaBulan: null,
    totalRekomendasiBiayaBulan: null,
    estimasiPSSPPeriode: null,
    totalEstimasiPSSPPeriode: null,
    rekomendasiBiayaPeriode: null,
    totalRekomendasiBiayaPeriode: null,
    rasioRekomenEstimasi: null,
    rasioRencanaBiayaEstimasi: null,
    totalPersenBudget: null,
    createdAt: EARLIER,
    updatedAt: NOW,
  },
];
