"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEditDoctor } from "@/lib/authz";
import { flagRevisionOnEditDoctor } from "@/lib/poaWorkflow";
import { getProductByKode } from "@/lib/masterData";
import { isWriteBlocked } from "@/lib/maintenance";
import { StatusStandarisasi, JenisPssp, PihakPssp, PsSp, BentukPssp, Prisma, type PoaForm, type User } from "@prisma/client";

/** Session/POA fetch only — no edit-rights check yet, since that's per-doctor (see assertCanEditDoctor below) and the doctor being touched isn't always known this early (addLineItemAction resolves it partway through). */
async function requireSessionAndPoa(poaId: string) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Sistem sedang mode view-only untuk maintenance. Coba lagi nanti."));

  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) redirect("/dashboard");

  return { poa, actor };
}

/**
 * Per-doctor edit rights (2026-08-18 fix) — these 3 actions each touch ONE
 * doctor's line item(s), but used to gate on canEdit(actor, poa), the
 * whole-draft rollup. That meant a doctor legitimately still editable (e.g.
 * sitting in REVISI, or never submitted this cycle) could get silently
 * redirected away because SOME OTHER doctor in the same draft had moved
 * further along in approval — and vice versa, a doctor already locked via
 * approval could still get edited because the draft-level rollup said yes.
 * canEditDoctor reads this doctor's own PoaDoctorApproval row instead.
 */
async function assertCanEditDoctor(poa: PoaForm, actor: User, kodePI: string | null, namaCust: string) {
  const doctorApproval = kodePI
    ? await prisma.poaDoctorApproval.findUnique({
        where: { poaId_kodePI_namaCust: { poaId: poa.id, kodePI, namaCust } },
      })
    : null;
  if (!(await canEditDoctor(actor, poa, doctorApproval))) redirect(`/poa/${poa.id}`);
}

export async function addLineItemAction(poaId: string, formData: FormData): Promise<void> {
  const { poa, actor } = await requireSessionAndPoa(poaId);

  const customerId = (formData.get("customerId") as string | null)?.trim() ?? "";
  const kodePI = (formData.get("kodePI") as string | null)?.trim() ?? "";
  const kodeProduk = (formData.get("kodeProduk") as string | null)?.trim() ?? "";
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const surveyPasienHarian = parseInt(formData.get("surveyPasienHarian") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const labelCustomer = (formData.get("labelCustomer") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const jenisPsspRaw = formData.get("jenisPssp") as string | null;
  const pihakPsspRaw = formData.get("pihakPssp") as string | null;
  const jenisPsSpRaw = formData.get("jenisPsSp") as string | null;
  const bentukPsspRaw = formData.get("bentukPssp") as string | null;
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  function parsePct(key: string) {
    const v = parseFloat(formData.get(key) as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal((v / 100).toFixed(4));
  }
  const rasioEstimasiGrowth = (() => {
    const v = parseFloat(formData.get("rasioEstimasiGrowth") as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const pengaliNilaiR = (() => {
    // 0 is a valid, intentional multiplier here (not "unset") — only NaN maps to null.
    const v = parseFloat(formData.get("pengaliNilaiR") as string);
    return isNaN(v) ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const persenPsspDokter = parsePct("persenPsspDokter");
  const persenPsspKpdm   = parsePct("persenPsspKpdm");
  const persenDiskon     = parsePct("persenDiskon");
  const persenDp         = parsePct("persenDp");
  const persenListingFee = parsePct("persenListingFee");
  const persenEntertain  = parsePct("persenEntertain");

  // Direct mode: caller already knows dokter info (e.g. adding a product to an existing doctor row)
  const directNamaCust = (formData.get("directNamaCust") as string | null)?.trim() ?? "";
  const directSpesialisasi = (formData.get("directSpesialisasi") as string | null)?.trim() ?? "";
  const directKodeCust = (formData.get("directKodeCust") as string | null)?.trim() || null;

  const isDirect = !customerId && !!directNamaCust && !!directSpesialisasi;

  if (!kodePI || !kodeProduk || !periodeAwal || isNaN(lamaPeriodeRaw)) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Field wajib belum lengkap."));
  }
  if (!isDirect && !customerId) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Field wajib belum lengkap."));
  }

  const itemKode = kodeProduk; // itemKode matches kodeProduk in our schema

  const [customerResult, outlet, product, salesHistory, diskonKontrak] = await Promise.all([
    isDirect
      ? Promise.resolve(null)
      : prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.outlet.findUnique({ where: { kodePI } }),
    getProductByKode(kodeProduk),
    prisma.outletSalesHistory.findUnique({
      where: { kodePI_itemKode: { kodePI, itemKode } },
    }),
    // Active DPL contract for this outlet+product whose period covers periodeAwal.
    // When more than one contract matches (a duplicate for the same outlet+product+
    // period), take the one with the largest newOnPi.
    prisma.diskonKontrak.findFirst({
      where: { kodePI, kodeProduk: itemKode, prdAwal: { lte: periodeAwal }, prdAkhir: { gte: periodeAwal } },
      orderBy: { newOnPi: "desc" },
    }),
  ]);

  if (!outlet || !product) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Outlet atau produk tidak ditemukan."));
  }
  if (!isDirect && !customerResult) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Customer tidak ditemukan."));
  }

  const namaCust = isDirect ? directNamaCust : customerResult!.namaCustomer;
  const kodeCust = isDirect ? directKodeCust : customerResult!.kodeCustomer;
  const spesialisasi = isDirect ? directSpesialisasi : customerResult!.spesialisasi;

  await assertCanEditDoctor(poa, actor, kodePI, namaCust);

  // Same doctor (outlet + name) can't have the same product added twice.
  const existingForDoctor: { kodeProduk: string; isManualCustomer: boolean }[] = await prisma.poaLineItem.findMany({
    where: { poaId, kodePI, namaCust },
    select: { kodeProduk: true, isManualCustomer: true },
  });
  if (existingForDoctor.some((i) => i.kodeProduk === kodeProduk)) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent(`${product!.namaProduk} sudah ada untuk dokter ini.`));
  }

  // Manual (unsynced) doctor — Customer.syncedAt is only ever null for doctors
  // registered via "Daftar User Baru", never for ones synced from the CDB.
  // Direct mode has no customerId to check, so it inherits the flag from
  // this doctor's other line item already in the POA (same doctor either way).
  const isManualCustomer = isDirect
    ? existingForDoctor[0]?.isManualCustomer ?? false
    : customerResult!.syncedAt === null;

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;
  const jenisPssp =
    jenisPsspRaw && Object.values(JenisPssp).includes(jenisPsspRaw as JenisPssp)
      ? (jenisPsspRaw as JenisPssp)
      : null;
  const pihakPssp =
    pihakPsspRaw && Object.values(PihakPssp).includes(pihakPsspRaw as PihakPssp)
      ? (pihakPsspRaw as PihakPssp)
      : PihakPssp.USER;
  const jenisPsSp =
    jenisPsSpRaw && Object.values(PsSp).includes(jenisPsSpRaw as PsSp)
      ? (jenisPsSpRaw as PsSp)
      : null;
  const bentukPssp =
    bentukPsspRaw && Object.values(BentukPssp).includes(bentukPsspRaw as BentukPssp)
      ? (bentukPsspRaw as BentukPssp)
      : null;

  // Editing a doctor that already left DRAFT bounces THAT doctor back to REVISI — must be resubmitted.
  await flagRevisionOnEditDoctor(poaId, kodePI, namaCust, actor.nip, { customer: namaCust, product: product!.namaProduk, op: "add" });

  await prisma.poaLineItem.create({
    data: {
      poaId,
      kodeRequest: null,
      kodeCust,
      namaCust,
      role: spesialisasi?.toLowerCase().includes("spesialis") ? "Dokter Spesialis" : "Dokter Umum",
      spesialisasi,
      isManualCustomer,
      historisPSSP: null,
      kodePI: outlet.kodePI,
      namaOutlet: outlet.namaOutlet,
      kodeProduk: product.kodeProduk,
      namaProduk: product.namaProduk,
      kategoriProdukFokus: product.namaGroupBrand,
      itemKode: product.kodeProduk,
      satuanTerkecil: product.satuanTerkecil ?? product.satuan,
      hargaSatuanTerkecil: (() => {
        const hna = parseFloat(product.hna);
        const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
        return new Prisma.Decimal((hna / konversi).toFixed(2));
      })(),
      historySales3Bln: salesHistory?.totalSales12Bln ?? null,
      avgDiskon: diskonKontrak?.newOnPi != null ? diskonKontrak.newOnPi.dividedBy(100) : null,
      produkKompetitor,
      labelCustomer,
      statusStandarisasi,
      jenisPssp,
      pihakPssp,
      jenisPsSp,
      bentukPssp,
      lamaPeriode: lamaPeriodeRaw,
      periodeAwal,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      surveyPasienHarian,
      hariKerjaBulan,
      jumlahResepHari,
      qtyProdukResep,
      rasioEstimasiGrowth,
      pengaliNilaiR,
      persenPsspDokter,
      persenPsspKpdm,
      persenDiskon,
      persenDp,
      persenListingFee,
      persenEntertain,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function updateLineItemAction(
  poaId: string,
  lineItemId: string,
  formData: FormData
): Promise<void> {
  const { poa, actor } = await requireSessionAndPoa(poaId);

  const kodeProduk = (formData.get("kodeProduk") as string | null)?.trim() ?? "";
  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const surveyPasienHarian = parseInt(formData.get("surveyPasienHarian") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const jenisPsspRaw = formData.get("jenisPssp") as string | null;
  const pihakPsspRaw = formData.get("pihakPssp") as string | null;
  const jenisPsSpRaw = formData.get("jenisPsSp") as string | null;
  const bentukPsspRaw = formData.get("bentukPssp") as string | null;
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  const [product, current] = await Promise.all([
    kodeProduk ? getProductByKode(kodeProduk) : Promise.resolve(null),
    prisma.poaLineItem.findUnique({ where: { id: lineItemId } }),
  ]);
  if (!current) redirect(`/poa/${poaId}`);
  await assertCanEditDoctor(poa, actor, current.kodePI, current.namaCust);

  if (product && current) {
    const duplicate = await prisma.poaLineItem.findFirst({
      where: { poaId, kodePI: current.kodePI, namaCust: current.namaCust, kodeProduk, id: { not: lineItemId } },
    });
    if (duplicate) {
      redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent(`${product.namaProduk} sudah ada untuk dokter ini.`));
    }
  }

  // Editing a doctor that already left DRAFT bounces THAT doctor back to REVISI — must be resubmitted.
  await flagRevisionOnEditDoctor(poaId, current?.kodePI ?? "", current?.namaCust ?? "", actor.nip, {
    customer: current?.namaCust,
    product: product?.namaProduk ?? current?.namaProduk,
    op: "update",
  });

  function parsePctU(key: string) {
    const v = parseFloat(formData.get(key) as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal((v / 100).toFixed(4));
  }
  const rasioEstimasiGrowthU = (() => {
    const v = parseFloat(formData.get("rasioEstimasiGrowth") as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const pengaliNilaiRU = (() => {
    // 0 is a valid, intentional multiplier here (not "unset") — only NaN maps to null.
    const v = parseFloat(formData.get("pengaliNilaiR") as string);
    return isNaN(v) ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const persenPsspDokterU = parsePctU("persenPsspDokter");
  const persenPsspKpdmU   = parsePctU("persenPsspKpdm");
  const persenDiskonU     = parsePctU("persenDiskon");
  const persenDpU         = parsePctU("persenDp");
  const persenListingFeeU = parsePctU("persenListingFee");
  const persenEntertainU  = parsePctU("persenEntertain");

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;
  const jenisPssp =
    jenisPsspRaw && Object.values(JenisPssp).includes(jenisPsspRaw as JenisPssp)
      ? (jenisPsspRaw as JenisPssp)
      : null;
  // Falls back to `undefined` (leave existing value untouched), not a forced
  // default — unlike create, pihakPssp already has a real value here that an
  // unparseable/missing raw value shouldn't clobber.
  const pihakPssp =
    pihakPsspRaw && Object.values(PihakPssp).includes(pihakPsspRaw as PihakPssp)
      ? (pihakPsspRaw as PihakPssp)
      : undefined;
  const jenisPsSp =
    jenisPsSpRaw && Object.values(PsSp).includes(jenisPsSpRaw as PsSp)
      ? (jenisPsSpRaw as PsSp)
      : null;
  const bentukPssp =
    bentukPsspRaw && Object.values(BentukPssp).includes(bentukPsspRaw as BentukPssp)
      ? (bentukPsspRaw as BentukPssp)
      : null;

  await prisma.poaLineItem.update({
    where: { id: lineItemId },
    data: {
      ...(product ? {
        kodeProduk: product.kodeProduk,
        namaProduk: product.namaProduk,
        kategoriProdukFokus: product.namaGroupBrand,
        itemKode: product.kodeProduk,
        satuanTerkecil: product.satuanTerkecil ?? product.satuan,
        hargaSatuanTerkecil: (() => {
          const hna = parseFloat(product.hna);
          const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
          return new Prisma.Decimal((hna / konversi).toFixed(2));
        })(),
      } : {}),
      produkKompetitor,
      statusStandarisasi,
      jenisPssp,
      pihakPssp,
      jenisPsSp,
      bentukPssp,
      lamaPeriode: isNaN(lamaPeriodeRaw) ? undefined : lamaPeriodeRaw,
      periodeAwal: periodeAwal || undefined,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      surveyPasienHarian,
      hariKerjaBulan,
      jumlahResepHari,
      qtyProdukResep,
      rasioEstimasiGrowth: rasioEstimasiGrowthU,
      pengaliNilaiR: pengaliNilaiRU,
      persenPsspDokter: persenPsspDokterU,
      persenPsspKpdm: persenPsspKpdmU,
      persenDiskon: persenDiskonU,
      persenDp: persenDpU,
      persenListingFee: persenListingFeeU,
      persenEntertain: persenEntertainU,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function deleteLineItemAction(poaId: string, lineItemId: string): Promise<void> {
  const { poa, actor } = await requireSessionAndPoa(poaId);

  const item = await prisma.poaLineItem.findUnique({ where: { id: lineItemId } });
  if (!item) redirect(`/poa/${poaId}`);
  await assertCanEditDoctor(poa, actor, item.kodePI, item.namaCust);

  // Deleting a doctor's LAST remaining line item, while that doctor already
  // has a PoaDoctorApproval row (any status — even REVISI), would orphan that
  // row: it stays in the DB with its full approval history, but the checklist
  // UI only ever lists doctors it finds in PoaLineItem (doctorKeysInDraft in
  // poa/[id]/page.tsx), so the doctor silently vanishes from the page with no
  // way back except re-adding the exact same kodePI+namaCust from scratch
  // (2026-08-20 incident — SM rejected a doctor, MR deleted all its products
  // meaning to redo them, and the doctor disappeared entirely). Block it here
  // instead: a doctor with approval history must always keep at least one
  // line item so it stays visible/actionable.
  const [siblingCount, doctorApproval] = await Promise.all([
    prisma.poaLineItem.count({ where: { poaId, kodePI: item.kodePI, namaCust: item.namaCust } }),
    item.kodePI
      ? prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust: { poaId, kodePI: item.kodePI, namaCust: item.namaCust } } })
      : null,
  ]);
  if (siblingCount <= 1 && doctorApproval) {
    // Target /poa/[id] (not /edit) — the only reachable caller today is
    // DraftChecklist's "Hapus [dokter]" button, which lives there; that page
    // now reads ?error= too (see PoaDetailPage), so the user sees this
    // without getting bounced to a different page.
    redirect(`/poa/${poaId}?error=` + encodeURIComponent(
      `Tidak bisa menghapus produk terakhir ${item.namaCust} karena dokter ini sudah punya riwayat approval. Ganti produknya (edit), atau tambah produk lain dulu sebelum menghapus yang ini.`
    ));
  }

  // Editing a doctor that already left DRAFT bounces THAT doctor back to REVISI — must be resubmitted.
  await flagRevisionOnEditDoctor(poaId, item.kodePI ?? "", item.namaCust, actor.nip, { customer: item.namaCust, product: item.namaProduk, op: "delete" });

  await prisma.poaLineItem.delete({ where: { id: lineItemId } });

  revalidatePath(`/poa/${poaId}/edit`);
}
