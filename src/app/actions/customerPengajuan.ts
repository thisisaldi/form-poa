"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";

export interface RekeningItem {
  pemilik: string;
  nomor: string;
  bank: string;
  relasi: string;
}

export interface OrganisasiItem {
  namaOrganisasi: string;
  jabatanOrganisasi: string;
}

export interface JadwalHari {
  mulai: string;   // "HH:mm"
  selesai: string;
  jumlahPasien: string;
  tidakPraktik: boolean;
}

export interface OutletPengajuan {
  kodePI: string;
  namaOutlet: string;
  jadwal: Record<string, JadwalHari>; // key = hari: "Senin" | "Selasa" | ...
}

export interface CustomerPengajuanData {
  // Step 1
  namaLengkap: string;
  namaPanggilan: string;
  jabatan: string;
  tipeCustomer: string;      // "NEGERI" | "SWASTA"
  tanggalLahir: string;      // "YYYY-MM-DD" or ""
  jenisKelamin: string;      // "L" | "P" | ""
  alamatRumah: string;
  kota: string;
  nik: string;
  email: string;
  nomorHp1: string;
  nomorHp2: string;
  rekening: RekeningItem[];
  // Step 2
  universitasS1: string;
  spesialisasi: string;
  universitasSpesialis: string;
  subSpesialisasi: string;
  organisasi: OrganisasiItem[];
  // Step 3
  outletsPengajuan: OutletPengajuan[];
}

function buildPayload(data: CustomerPengajuanData, submittedBy: string, status: string) {
  return {
    namaLengkap: data.namaLengkap,
    namaPanggilan: data.namaPanggilan,
    jabatan: data.jabatan,
    tipeCustomer: data.tipeCustomer,
    tanggalLahir: data.tanggalLahir ? new Date(data.tanggalLahir) : null,
    jenisKelamin: data.jenisKelamin || null,
    alamatRumah: data.alamatRumah || null,
    kota: data.kota || null,
    nik: data.nik || null,
    email: data.email || null,
    nomorHp1: data.nomorHp1,
    nomorHp2: data.nomorHp2 || null,
    rekening: data.rekening,
    universitasS1: data.universitasS1 || null,
    spesialisasi: data.spesialisasi,
    universitasSpesialis: data.universitasSpesialis || null,
    subSpesialisasi: data.subSpesialisasi || null,
    organisasi: data.organisasi,
    outletsPengajuan: data.outletsPengajuan,
    submittedBy,
    status,
  };
}

export async function saveDraftAction(
  data: CustomerPengajuanData,
  existingId?: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sesi tidak valid." };
  if (await isWriteBlocked(user.role)) return { ok: false, error: WRITE_BLOCKED_MESSAGE };

  const payload = buildPayload(data, user.nip, "DRAFT");

  if (existingId) {
    await prisma.customerPengajuan.update({ where: { id: existingId }, data: payload });
    return { ok: true, id: existingId };
  }
  const created = await prisma.customerPengajuan.create({ data: payload });
  return { ok: true, id: created.id };
}

export async function submitCustomerPengajuanAction(
  data: CustomerPengajuanData,
  existingId?: string
): Promise<{ ok: boolean; customerId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sesi tidak valid." };
  if (await isWriteBlocked(user.role)) return { ok: false, error: WRITE_BLOCKED_MESSAGE };

  if (!data.namaLengkap || !data.spesialisasi || !data.nomorHp1) {
    return { ok: false, error: "Nama lengkap, spesialisasi, dan nomor HP wajib diisi." };
  }

  // Create Customer + CustomerOutlet in a transaction
  const customer = await prisma.customer.create({
    data: {
      namaCustomer: data.namaLengkap,
      spesialisasi: data.spesialisasi,
      outlets: {
        create: data.outletsPengajuan.map((o) => ({
          kodePI: o.kodePI,
          isFokus: false,
        })),
      },
    },
  });

  const payload = {
    ...buildPayload(data, user.nip, "SUBMITTED"),
    customerId: customer.id,
  };

  if (existingId) {
    await prisma.customerPengajuan.update({ where: { id: existingId }, data: payload });
  } else {
    await prisma.customerPengajuan.create({ data: payload });
  }

  return { ok: true, customerId: customer.id };
}
