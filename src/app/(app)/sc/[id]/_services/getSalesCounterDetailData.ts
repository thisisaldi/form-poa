import { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScSubordinateIdsUnder } from "@/lib/authz";
import { getMrSalesSummary } from "@/lib/salesSummary";
import { resolveTargetHospitalValueFallback } from "@/lib/targetHospitalValue";
import type { ScDraftFormItem } from "@/components/sc/types";
import { getSalesCounterProduct } from "./getSalesCounterProduct";
import { getHistorySales } from "./getHistorySales";
import { postHistorySales } from "./postHistorySales";
import { getScOutletB3Sales } from "./getScOutletB3Sales";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import { getB3ByQuarter } from "@/lib/b3Utils";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";

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
        .flatMap((d: any) =>
          d.auditLogs.map((log: any) => ({
            ...log,
            namaOutlet: d.namaOutlet || null,
            kodePI: d.kodePI || null,
          }))
        )
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
  // Owner can always add new outlets and manage their DRAFT/REVISI outlets.
  // Each outlet card enforces individual lock status (DRAFT/REVISI vs APPROVED).
  const userCanEdit = isOwner || sessionRole === "ADMIN";

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

  const [blastInSet, rawOutlets, batchHistRes] = await Promise.all([
    getBlastInOutletSet(),
    getSalesCounterOutletsDirect(actor.nip),
    outletCodes.length > 0
      ? postHistorySales({
          piCodes: outletCodes,
          period: b3Info.targetPeriods,
          agg: true,
        }).catch(() => null)
      : null,
  ]);

  await Promise.all(
    outletCodes.map(async (kodePI: string) => {
      try {
        const scProductRes = await getSalesCounterProduct(kodePI).catch(() => null);
        const scCodes = new Set<string>();
        if (scProductRes?.data) {
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

        const scProCodes = Array.from(scCodes);

        // Check if batchHistRes already has sales for this outlet
        const parsed = parseOutletHistorySales(batchHistRes, kodePI);
        if (parsed.totalSales > 0 || parsed.productSalesMap.size > 0) {
          // Filter to SC products
          let scTotalSales = 0;
          for (const [code, val] of parsed.productSalesMap.entries()) {
            const norm = code.replace(/^0+/, "");
            if (scCodes.size === 0 || scCodes.has(code) || scCodes.has(norm)) {
              scTotalSales += (val || 0) * 3; // 3 months total
            }
          }
          if (scTotalSales > 0) {
            outletHistorySalesQuarterMap.set(kodePI, scTotalSales);
            return;
          }
        }

        if (scProCodes.length > 0) {
          // Fallback 1: getScOutletB3Sales for SC products
          const b3Items = await getScOutletB3Sales(b3Info.period, kodePI, scProCodes).catch(() => []);
          const activeB3 = (b3Items || []).filter((it: any) => (Number(it.average_sales) || 0) > 0 || (Number(it.average_qty) || 0) > 0);
          if (activeB3.length > 0) {
            const totalB3Val = activeB3.reduce((sum, it) => sum + (Number(it.average_sales) || 0), 0) * 3;
            if (totalB3Val > 0) {
              outletHistorySalesQuarterMap.set(kodePI, totalB3Val);
              return;
            }
          }

          // Fallback 2: legacy getHistorySales strictly filtered by SC codes
          const historyRes = await getHistorySales(kodePI, false).catch(() => null);
          if (historyRes?.data && Array.isArray(historyRes.data)) {
            let totalValSum = 0;
            for (const it of historyRes.data) {
              const itemPeriod = Number(it.period);
              const salesVal = Number(it.sales_value) || 0;
              if (targetPeriodsSet.has(itemPeriod) && salesVal > 0 && it.code && scCodes.has(it.code)) {
                totalValSum += salesVal;
              }
            }
            if (totalValSum > 0) {
              outletHistorySalesQuarterMap.set(kodePI, totalValSum);
              return;
            }
          }
        }

        outletHistorySalesQuarterMap.set(kodePI, 0);
      } catch (err) {
        console.error(`Error fetching SC data for ${kodePI}:`, err);
      }
    })
  );

  const outletScMap = new Map(rawOutlets.map((o) => [o.kodePI, !!o.is_sc]));
  const totalCoverageScOutlets = rawOutlets.filter((o) => !!o.is_sc).length;

  // Build clean SC Draft Form items
  const scDrafts: ScDraftFormItem[] = drafts.map((d: any) => {
    const scCodes = outletScProductCodesMap.get(d.kodePI) || new Set<string>();
    const totalScProducts = outletScTotalCountMap.get(d.kodePI) ?? 0;
    const scOnlyProducts = scCodes.size > 0
      ? d.products.filter((p: any) => scCodes.has(p.kodeProduk) || scCodes.has(String(p.kodeProduk || "").replace(/^0+/, "")))
      : d.products;
    const distinctScCodes = new Set(scOnlyProducts.map((p: any) => p.kodeProduk).filter(Boolean));
    const validScProductsCount = distinctScCodes.size;

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
        outletPersonId: p.outletPersonId,
        nik_ktp: p.outletPersonId,
        personName: p.personName,
        positionName: p.positionName,
      })),
      products: scOnlyProducts.map((p: any) => {
        const mp = masterProductMap.get(p.kodeProduk);
        const cp = canvasserProductMap.get(`${d.kodePI}_${p.kodeProduk}`);
        const isScProduct = scCodes.has(p.kodeProduk);
        return {
          id: p.id,
          kodeProduk: p.kodeProduk,
          namaProduk: p.namaProduk,
          periodeMonth: p.periodeMonth,
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
      auditLogs: (d.auditLogs || []).map((log: any) => ({
        id: log.id,
        poaScId: log.poaScId,
        actorId: log.actorId,
        action: log.action,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        snapshot: log.snapshot,
        createdAt: log.createdAt,
        actor: log.actor
          ? {
              nip: log.actor.nip,
              name: log.actor.name,
              role: log.actor.role,
              jabatan: log.actor.jabatan,
            }
          : null,
      })),
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
    };
  });

  const salesSummary = poa.owner.isDummy
    ? { historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0 }
    : await getMrSalesSummary(poa.ownerId);

  // Live via resolveTargetHospitalValueFallback (2026-09-14 — TargetHospitalValue
  // no longer has a nipMR column, see that function's doc comment).
  const targetValueFromGT = /^\d{4}-Q[1-4]$/.test(poa.period)
    ? (await resolveTargetHospitalValueFallback([{ owner: poa.owner, quarter: poa.period }])).get(`${poa.ownerId}|${poa.period}`) ?? null
    : null;

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