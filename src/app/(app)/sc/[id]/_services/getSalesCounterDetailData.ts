import { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips, getScSubordinateIdsUnder } from "@/lib/authz";
import { getMrSalesSummary } from "@/lib/salesSummary";
import { quarterToMonths } from "@/lib/quarterUtils";
import type { ScDraftFormItem } from "@/components/sc/types";
import { getSalesCounterProduct } from "./getSalesCounterProduct";
import { getHistorySales } from "./getHistorySales";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import { getB3ByQuarter } from "@/lib/b3Utils";

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

export async function getSalesCounterDetailData(
  id: string,
  sessionUserId: string,
  sessionRole: string
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: sessionUserId } });

  let targetOwnerId = sessionUserId;
  let targetPeriod = id;

  // Check if id is a specific PoaScForm.id
  const formById = await prisma.poaScForm.findUnique({
    where: { id },
    select: { ownerId: true, period: true, currentHolderId: true },
  });

  if (formById) {
    targetOwnerId = formById.ownerId;
    targetPeriod = formById.period;
  }

  // Fast-path access check
  let hasAccess = false;
  const isSelf = targetOwnerId === sessionUserId;
  const isSpecialRole = ["ADMIN", "GM", "SFE", "VIEWER"].includes(sessionRole);

  if (isSelf || isSpecialRole) {
    hasAccess = true;
  } else {
    const depthByRole: Record<string, number> = { ASM: 1, SM: 2, NSM: 3 };
    const depth = depthByRole[sessionRole] ?? 1;
    const subIds = await getScSubordinateIdsUnder(sessionUserId, depth);
    if (subIds.includes(targetOwnerId)) {
      const submittedCount = await prisma.poaScForm.count({
        where: {
          ownerId: targetOwnerId,
          period: targetPeriod,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = submittedCount > 0;
    } else {
      const holderCount = await prisma.poaScForm.count({
        where: {
          ownerId: targetOwnerId,
          period: targetPeriod,
          currentHolderId: sessionUserId,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = holderCount > 0;
    }
  }

  if (!hasAccess) return { hasAccess: false };

  const draftsWhere: any = { ownerId: targetOwnerId, period: targetPeriod };
  if (!isSelf && !isSpecialRole) {
    draftsWhere.status = { not: PoaStatus.DRAFT };
  }

  const drafts = await prisma.poaScForm.findMany({
    where: draftsWhere,
    include: {
      owner: true,
      currentHolder: true,
      products: true,
      persons: true,
      entertainItems: true,
      auditLogs: {
        include: { actor: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let poa: any = null;
  if (drafts.length > 0) {
    const first = drafts[0];
    poa = {
      id: targetPeriod,
      period: targetPeriod,
      status: first.status,
      version: first.version,
      ownerId: first.ownerId,
      owner: first.owner,
      currentHolderId: first.currentHolderId,
      currentHolder: first.currentHolder,
      auditLogs: drafts
        .flatMap((d: any) => d.auditLogs)
        .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime()),
      entertainItems: drafts
        .flatMap((d: any) => d.entertainItems)
        .map((e: any) => ({
          ...e,
          biayaEntertain: Number(e.biayaEntertain.toString()),
        })),
    };
  } else {
    poa = {
      id: targetPeriod,
      period: targetPeriod,
      status: "DRAFT" as PoaStatus,
      version: 1,
      ownerId: targetOwnerId,
      owner: actor,
      currentHolderId: null,
      currentHolder: null,
      auditLogs: [],
      entertainItems: [],
    };
  }

  const isOwner = poa.ownerId === sessionUserId;
  const userCanEdit = isOwner && (poa.status === "DRAFT" || poa.status === "REVISI" || poa.status === "SUBMITTED_TO_ASM");

  // Collect all product codes across drafts to fetch master Product information
  const allProductCodes = Array.from(
    new Set(drafts.flatMap((d: any) => d.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts: MasterProductItem[] = await prisma.product.findMany({
    where: { kodeProduk: { in: allProductCodes } },
    select: {
      kodeProduk: true,
      namaProduk: true,
      hna: true,
      konversiPembagi: true,
      satuanTerkecil: true,
      satuan: true,
    },
  });

  const masterProductMap = new Map<string, MasterProductItem>(
    masterProducts.map((p: MasterProductItem) => [p.kodeProduk, p])
  );

  const outletCodes = Array.from(new Set(drafts.map((d: any) => d.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();
  const outletScProductCodesMap = new Map<string, Set<string>>();
  const outletScTotalCountMap = new Map<string, number>();
  const outletHistorySalesQuarterMap = new Map<string, number>();

  const b3Info = getB3ByQuarter(targetPeriod);
  const targetPeriodsSet = new Set((b3Info.targetPeriods || []).map(Number));

  const [blastInSet, rawOutlets] = await Promise.all([
    getBlastInOutletSet(),
    getSalesCounterOutletsDirect(actor.nip),
    Promise.all(
      outletCodes.map(async (kodePI: string) => {
        try {
          const [scProductRes, historyRes] = await Promise.all([
            getSalesCounterProduct(kodePI).catch(() => null),
            getHistorySales(kodePI, false).catch(() => null),
          ]);
          if (scProductRes?.data) {
            const scCodes = new Set<string>();
            for (const cp of scProductRes.data) {
              canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
                sales_counter_value: cp.sales_counter_value || 0,
                sales_counter_minimum: cp.sales_counter_minimum || 0,
              });
              if (cp.pro_code) scCodes.add(cp.pro_code);
            }
            outletScProductCodesMap.set(kodePI, scCodes);
            outletScTotalCountMap.set(kodePI, scProductRes.data.length);
          }
          if (historyRes?.data && Array.isArray(historyRes.data)) {
            let totalValSum = 0;
            for (const it of historyRes.data) {
              const itemPeriod = Number(it.period);
              const salesVal = Number(it.sales_value) || 0;
              if (targetPeriodsSet.has(itemPeriod) && salesVal > 0) {
                totalValSum += salesVal;
              }
            }
            outletHistorySalesQuarterMap.set(kodePI, totalValSum);
          }
        } catch (err) {
          console.error(`Error fetching SC data for ${kodePI}:`, err);
        }
      })
    ),
  ]);

  const outletScMap = new Map(rawOutlets.map((o) => [o.kodePI, !!o.is_sc]));
  const totalCoverageScOutlets = rawOutlets.filter((o) => !!o.is_sc).length;

  // Build clean SC Draft Form items
  const scDrafts: ScDraftFormItem[] = drafts.map((d: any) => {
    const scCodes = outletScProductCodesMap.get(d.kodePI) || new Set<string>();
    const totalScProducts = outletScTotalCountMap.get(d.kodePI) ?? 0;
    const validScProductsCount = d.products.filter((p: any) => scCodes.has(p.kodeProduk)).length;

    return {
      id: d.id,
      period: d.period,
      periodeAwal: d.periodeAwal,
      lamaPeriode: d.lamaPeriode,
      status: d.status,
      version: d.version,
      kodePI: d.kodePI,
      namaOutlet: d.namaOutlet || `Outlet ${d.kodePI}`,
      persenResepDokter: d.persenResepDokter,
      jumlahKaryawan: (d.jumlahKaryawan && d.jumlahKaryawan > 0) ? d.jumlahKaryawan : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_karyawan ?? d.jumlahKaryawan ?? null),
      jumlahPasien: (d.jumlahPasien && d.jumlahPasien > 0) ? d.jumlahPasien : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien ?? d.jumlahPasien ?? null),
      jumlahPasienResep: (d.jumlahPasienResep && d.jumlahPasienResep > 0) ? d.jumlahPasienResep : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien_resep ?? d.jumlahPasienResep ?? null),
      jumlahPasienNonResep: (d.jumlahPasienNonResep && d.jumlahPasienNonResep > 0) ? d.jumlahPasienNonResep : (rawOutlets.find((o: any) => o.kodePI === d.kodePI)?.jumlah_pasien_non_resep ?? d.jumlahPasienNonResep ?? null),
      ownerId: d.ownerId,
      is_sc: outletScMap.get(d.kodePI) ?? false,
      isBlastIn: blastInSet.has(d.kodePI),
      totalScProducts,
      validScProductsCount,
      historySalesQuarter: outletHistorySalesQuarterMap.get(d.kodePI) ?? 0,
      persons: d.persons.map((p: any) => ({
        id: p.id,
        nik_ktp: p.nik_ktp,
        personName: p.personName,
        positionName: p.positionName,
      })),
      products: d.products.map((p: any) => {
        const mp = masterProductMap.get(p.kodeProduk);
        const cp = canvasserProductMap.get(`${d.kodePI}_${p.kodeProduk}`);
        const isScProduct = scCodes.has(p.kodeProduk);
        return {
          id: p.id,
          kodeProduk: p.kodeProduk,
          namaProduk: p.namaProduk,
          produkKompetitor: p.produkKompetitor || null,
          qtyPerBulan: p.qtyPerBulan,
          persenMatriksSc: Number(p.persenMatriksSc.toString()),
          persenDiskon: Number(p.persenDiskon.toString()),
          persenCashback: Number(p.persenCashback.toString()),
          rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
          hnaSJ: mp ? Number(mp.hna.toString()) : 0,
          konversiPembagi: mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1,
          satuanTerkecil: mp?.satuanTerkecil || "ST",
          satuanSJ: mp?.satuan || "SJ",
          salesCounterValue: cp?.sales_counter_value || 0,
          salesCounterMinimum: cp?.sales_counter_minimum || 0,
          isScProduct,
        };
      }),
      entertainItems: d.entertainItems.map((e: any) => ({
        id: e.id,
        periodeMonth: e.periodeMonth,
        biayaEntertain: Number(e.biayaEntertain.toString()),
      })),
    };
  });

  const salesSummary = poa.owner.isDummy
    ? { historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0 }
    : await getMrSalesSummary(poa.ownerId);

  let targetValueFromGT: number | null = null;
  if (/^\d{4}-Q[1-4]$/.test(poa.period)) {
    const months = quarterToMonths(poa.period);
    const targetNips = await getSubordinateMRNips(poa.owner);
    const rows = targetNips.length > 0
      ? await prisma.targetHospitalValue.findMany({
          where: { nipMR: { in: targetNips }, periode: { in: months } },
          select: { target: true },
        })
      : [];
    if (rows.length > 0) {
      targetValueFromGT = rows.reduce((sum: number, r: any) => sum + parseFloat(r.target.toString()), 0);
    }
  }

  return {
    hasAccess: true,
    poa,
    actor,
    userCanEdit,
    isOwner,
    scDrafts,
    salesSummary,
    targetValueFromGT,
    totalCoverageScOutlets,
    historyQuarterLabel: b3Info.rangeLabel,
  };
}