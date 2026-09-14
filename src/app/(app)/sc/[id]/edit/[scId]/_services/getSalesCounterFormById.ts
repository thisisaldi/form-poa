import { prisma } from "@/lib/prisma";
import { PoaStatus } from "@prisma/client";
import { getScProducts, getSalesCounterOutletsDirect } from "@/lib/masterData";
import { isOutletBlastIn } from "@/lib/outletBlastIn";
import { getSalesCountersByOutlet } from "../../../_services/getSalesCounters";
import { getSalesCounterProduct } from "../../../_services/getSalesCounterProduct";
import { canUserEditScForm } from "@/lib/authz";

export async function getSalesCounterFormById(
  scId: string,
  sessionUserId: string,
  sessionRole?: string
) {
  const form = await prisma.poaScForm.findUnique({
    where: { id: scId },
    include: {
      owner: true,
      products: true,
      persons: true,
      entertainItems: true,
    },
  });

  if (!form) return null;
  const isOwner = form.ownerId === sessionUserId;
  const isSpecialRole = sessionRole != null && ["ADMIN", "GM", "SFE", "VIEWER"].includes(sessionRole);
  const isSuperior = sessionRole != null && ["ASM", "SM", "NSM"].includes(sessionRole);

  let hasAccess = false;
  if (isOwner || isSpecialRole) {
    hasAccess = true;
  } else if (isSuperior) {
    hasAccess = form.status !== PoaStatus.DRAFT;
  }

  if (!hasAccess) return null;

  const [products, isBlastIn, rawOutlets, canvasserPersonsData, scProductRes] = await Promise.all([
    getScProducts().catch(() => []),
    isOutletBlastIn(form.kodePI).catch(() => false),
    getSalesCounterOutletsDirect(form.owner.nip || form.ownerId || sessionUserId).catch(() => []),
    getSalesCountersByOutlet(form.kodePI).catch(() => ({ data: [] })),
    getSalesCounterProduct(form.kodePI).catch(() => null),
  ]);

  const targetOutlet = rawOutlets.find((o) => o.kodePI === form.kodePI);
  const scCodes = new Set(scProductRes?.data?.map((cp: any) => cp.pro_code) || []);
  const scOnlyProducts = scCodes.size > 0
    ? form.products.filter((p: any) => scCodes.has(p.kodeProduk) || scCodes.has(String(p.kodeProduk || "").replace(/^0+/, "")))
    : form.products;

  const serialized = {
    id: form.id,
    period: form.period,
    status: form.status,
    version: form.version,
    ownerId: form.ownerId,
    owner: { nip: form.owner.nip, name: form.owner.name },
    kodePI: form.kodePI,
    namaOutlet: form.namaOutlet,
    is_sc: !!targetOutlet?.is_sc,
    jumlah_sc: targetOutlet?.jumlah_sc ?? null,
    isBlastIn,
    isOnline: !!targetOutlet?.isOnline,
    periodeAwal: form.periodeAwal,
    lamaPeriode: form.lamaPeriode,
    persenResepDokter: form.persenResepDokter,
    jumlahKaryawan: (form.jumlahKaryawan && form.jumlahKaryawan > 0) ? form.jumlahKaryawan : (targetOutlet?.jumlah_karyawan ?? form.jumlahKaryawan ?? null),
    jumlahPasien: (form.jumlahPasien && form.jumlahPasien > 0) ? form.jumlahPasien : (targetOutlet?.jumlah_pasien ?? form.jumlahPasien ?? null),
    jumlahPasienResep: (form.jumlahPasienResep && form.jumlahPasienResep > 0) ? form.jumlahPasienResep : (targetOutlet?.jumlah_pasien_resep ?? form.jumlahPasienResep ?? null),
    jumlahPasienNonResep: (form.jumlahPasienNonResep && form.jumlahPasienNonResep > 0) ? form.jumlahPasienNonResep : (targetOutlet?.jumlah_pasien_non_resep ?? form.jumlahPasienNonResep ?? null),
    persons: form.persons.map((p: any) => {
      const personIdVal = p.outletPersonId || p.nik_ktp;
      const matchedApiPerson = canvasserPersonsData?.data?.find(
        (c: any) =>
          String(c.person_id) === String(personIdVal) ||
          String(c.nik) === String(personIdVal) ||
          String(c.person_id) === String(p.id)
      );
      return {
        id: p.id,
        outletPersonId: personIdVal,
        nik_ktp: personIdVal,
        personName: p.personName,
        positionName: p.positionName,
        tipeUploadSc: matchedApiPerson?.tipe_upload_sc || "-",
      };
    }),
    products: scOnlyProducts.map((p: any) => ({
      id: p.id,
      kodeProduk: p.kodeProduk,
      namaProduk: p.namaProduk,
      produkKompetitor: p.produkKompetitor,
      periodeMonth: p.periodeMonth,
      qtyPerBulan: p.qtyPerBulan,
      persenMatriksSc: Number(p.persenMatriksSc.toString()),
      persenDiskon: Number(p.persenDiskon.toString()),
      persenCashback: Number(p.persenCashback.toString()),
      rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
    })),
    entertainItems: form.entertainItems.map((e: any) => ({
      id: e.id,
      periodeMonth: e.periodeMonth,
      biayaEntertain: Number(e.biayaEntertain.toString()),
    })),
  };

  return {
    isOwner: form.ownerId === sessionUserId,
    userCanEdit: canUserEditScForm(sessionRole || "MR", sessionUserId, form.ownerId, form.status),
    form: serialized,
    products,
  };
}
