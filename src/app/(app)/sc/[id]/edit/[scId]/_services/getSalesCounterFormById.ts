import { prisma } from "@/lib/prisma";
import { getScProducts, getSalesCounterOutletsDirect } from "@/lib/masterData";
import { isOutletBlastIn } from "@/lib/outletBlastIn";
import { getSalesCountersByOutlet } from "../../../_services/getSalesCounters";
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
  const hasAccess =
    form.ownerId === sessionUserId ||
    (sessionRole != null && ["ASM", "SM", "NSM", "ADMIN", "GM", "SFE", "VIEWER"].includes(sessionRole));
  if (!hasAccess) return null;

  const [products, isBlastIn, rawOutlets, canvasserPersonsData] = await Promise.all([
    getScProducts().catch(() => []),
    isOutletBlastIn(form.kodePI).catch(() => false),
    getSalesCounterOutletsDirect(sessionUserId).catch(() => []),
    getSalesCountersByOutlet(form.kodePI).catch(() => ({ data: [] })),
  ]);

  const targetOutlet = rawOutlets.find((o) => o.kodePI === form.kodePI);

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
    periodeAwal: form.periodeAwal,
    lamaPeriode: form.lamaPeriode,
    persenResepDokter: form.persenResepDokter,
    jumlahKaryawan: (form.jumlahKaryawan && form.jumlahKaryawan > 0) ? form.jumlahKaryawan : (targetOutlet?.jumlah_karyawan ?? form.jumlahKaryawan ?? null),
    jumlahPasien: (form.jumlahPasien && form.jumlahPasien > 0) ? form.jumlahPasien : (targetOutlet?.jumlah_pasien ?? form.jumlahPasien ?? null),
    jumlahPasienResep: (form.jumlahPasienResep && form.jumlahPasienResep > 0) ? form.jumlahPasienResep : (targetOutlet?.jumlah_pasien_resep ?? form.jumlahPasienResep ?? null),
    jumlahPasienNonResep: (form.jumlahPasienNonResep && form.jumlahPasienNonResep > 0) ? form.jumlahPasienNonResep : (targetOutlet?.jumlah_pasien_non_resep ?? form.jumlahPasienNonResep ?? null),
    persons: form.persons.map((p: any) => {
      const matchedApiPerson = canvasserPersonsData?.data?.find(
        (c: any) =>
          String(c.person_id) === String(p.nik_ktp) ||
          String(c.nik) === String(p.nik_ktp) ||
          String(c.person_id) === String(p.id)
      );
      return {
        id: p.id,
        nik_ktp: p.nik_ktp,
        personName: p.personName,
        positionName: p.positionName,
        tipeUploadSc: matchedApiPerson?.tipe_upload_sc || "-",
      };
    }),
    products: form.products.map((p: any) => ({
      id: p.id,
      kodeProduk: p.kodeProduk,
      namaProduk: p.namaProduk,
      produkKompetitor: p.produkKompetitor,
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
