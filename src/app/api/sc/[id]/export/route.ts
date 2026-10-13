/**
 * GET /api/sc/[id]/export
 *
 * Returns a single-POA Sales Counter (SC) Excel workbook using ExcelJS.
 * Export uses ACTUAL raw numbers (no /1,000,000 denominator division).
 *
 * STREAMING (2026-10-13): dengan ?approvalType=ASM route ini mengekspor semua outlet semua MR di bawah satu ASM
 * (ratusan form, puluhan ribu baris). Workbook yang dibangun penuh di memori lalu `writeBuffer` memakan ratusan
 * MB untuk ukuran itu, jadi sekarang baris langsung di-commit ke WorkbookWriter yang menulis ke response stream
 * (sama seperti /api/sc/export). Sheet ditulis berurutan; baris rekap Sheet 2 dikumpulkan sebagai objek biasa
 * saat Sheet 1 ditulis.
 */

import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
import { getAppSetting } from "@/lib/appSettings";
import { settingMessage } from "@/lib/appSettingsRegistry";
import { PoaStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { getScSubordinateIdsUnder } from "@/lib/authz";
import { getSalesCounterProduct } from "../../../../(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScCashbackPoa } from "../../../../(app)/sc/[id]/_services/getScCashbackPoa";
import { calculateCashbackDetails } from "@/components/sc/edit/hooks/useSalesCounterCashback";
import { getPeriodMonthList } from "@/components/sc/detail/utils/outletCalculationUtils";
import { SC_EXPORT_PCT_FMT, SC_EXPORT_RP_FMT, startScExportSheet, writeScExportRow, type ScExportCol } from "@/lib/scExportSheet";
import { hasScSummary, isStoredScProduct, storedCashbackBulan, storedCashbackTotal, storedProductInputs } from "@/lib/scExportSummary";

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (await getAppSetting("export.sc.disabled")) {
    return NextResponse.json({ error: settingMessage("export.sc.disabled") }, { status: 503 });
  }
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ownerIdParam = _req.nextUrl.searchParams.get("ownerId") || _req.nextUrl.searchParams.get("owner");
  const approvalTypeParam = _req.nextUrl.searchParams.get("approvalType") || _req.nextUrl.searchParams.get("tipeApproval");

  let targetOwnerId = ownerIdParam || session.userId;
  let targetPeriod = id;

  // Check if id is a specific PoaScForm.id (UUID)
  const formById = await prisma.poaScForm.findUnique({
    where: { id },
    select: { ownerId: true, period: true, status: true, currentHolderId: true },
  });

  if (formById) {
    targetOwnerId = formById.ownerId;
    targetPeriod = formById.period;
  }

  const isAsmApproval = approvalTypeParam?.toUpperCase() === "ASM";
  const subordinateMrIds = isAsmApproval
    ? await getScSubordinateIdsUnder(targetOwnerId, 1)
    : [];
  const targetOwnerIds = isAsmApproval
    ? Array.from(new Set([targetOwnerId, ...subordinateMrIds]))
    : [targetOwnerId];

  // Authorization check
  const isSelf = targetOwnerId === session.userId;
  const isSpecialRole = (["ADMIN", "GM", "SFE", "VIEWER", "SD"] as string[]).includes(session.role);

  let hasAccess = false;
  if (isSelf || isSpecialRole) {
    hasAccess = true;
  } else {
    const depthByRole: Record<string, number> = { ASM: 1, SM: 2, NSM: 3 };
    const depth = depthByRole[session.role] ?? 1;
    const subIds = await getScSubordinateIdsUnder(session.userId, depth);
    const isSubordinate = subIds.includes(targetOwnerId) || targetOwnerIds.some((uid) => subIds.includes(uid));

    if (isSubordinate) {
      const submittedCount = await prisma.poaScForm.count({
        where: {
          ownerId: { in: targetOwnerIds },
          period: targetPeriod,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = submittedCount > 0;
    } else {
      const holderCount = await prisma.poaScForm.count({
        where: {
          ownerId: { in: targetOwnerIds },
          period: targetPeriod,
          currentHolderId: session.userId,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = holderCount > 0;
    }
  }

  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const draftsWhere: any = {
    ownerId: { in: targetOwnerIds },
    period: targetPeriod,
  };
  if (!isSelf && !isSpecialRole) {
    draftsWhere.status = { not: PoaStatus.DRAFT };
  }

  // Optional filter: only export specific outlet form IDs
  const outletIdsParam = _req.nextUrl.searchParams.get("outletIds");
  if (outletIdsParam) {
    const outletIds = outletIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (outletIds.length > 0) {
      draftsWhere.id = { in: outletIds };
    }
  }

  const drafts = await prisma.poaScForm.findMany({
    where: draftsWhere,
    include: {
      owner: true,
      currentHolder: true,
      products: true,
      persons: true,
      entertainItems: true,
      // Hanya kolom yang ditulis ke sheet Audit Log (snapshot JSON tidak ikut dimuat).
      auditLogs: {
        select: {
          createdAt: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          actor: { select: { name: true, nip: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ period: "asc" }, { kodePI: "asc" }],
  });

  if (drafts.length === 0) {
    return NextResponse.json({ error: "No SC POA drafts found for this period" }, { status: 404 });
  }

  // Ensure deterministic sorting: Periode Kuartal (asc), Kode PI Outlet (asc)
  drafts.sort((a: any, b: any) =>
    (a.period || "").localeCompare(b.period || "") ||
    (a.kodePI || "").localeCompare(b.kodePI || "")
  );


  const first = drafts[0];
  const owner = first.owner;

  // Fetch product master details for all products in drafts
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

  const masterMap = new Map<string, MasterProductItem>(
    masterProducts.map((p: MasterProductItem) => [p.kodeProduk, p])
  );

  // Form dengan ringkasan tersimpan (docs/sc-form-summary) memakai nilai SC, HNA, dan cashback dari barisnya
  // sendiri; Canvasser hanya dipanggil untuk outlet yang masih punya form tanpa ringkasan.
  const outletCodes = Array.from(
    new Set(drafts.filter((d: any) => !hasScSummary(d)).map((d: any) => d.kodePI).filter(Boolean))
  ) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();
  const outletScProductCodesMap = new Map<string, Set<string>>();
  const outletCashbackMap = new Map<string, any>();

  await mapWithConcurrency(
    outletCodes,
    8,
    async (kodePI: string) => {
      try {
        const [res, cbRes] = await Promise.all([
          getSalesCounterProduct(kodePI, targetPeriod).catch(() => null),
          getScCashbackPoa(kodePI).catch(() => null),
        ]);
        if (res?.data) {
          const scSet = new Set<string>();
          for (const cp of res.data) {
            canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
              sales_counter_value: cp.sales_counter_value || 0,
              sales_counter_minimum: cp.sales_counter_minimum || 0,
            });
            if (cp.pro_code) scSet.add(cp.pro_code);
          }
          outletScProductCodesMap.set(kodePI, scSet);
        }
        if (cbRes) {
          outletCashbackMap.set(kodePI, cbRes);
        }
      } catch (err) {
        console.error(`Error fetching SC products or cashback for ${kodePI}:`, err);
      }
    }
  );

  const RP_FMT = SC_EXPORT_RP_FMT;
  const PCT_FMT = SC_EXPORT_PCT_FMT;

  // ─── Sheet 1: DATA INPUT POA (Detail per Bulan) ───────────────────────────
  const formCols: ScExportCol[] = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode", key: "periode", width: 14 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Qty ST / Bulan", key: "qtyPerBulan", width: 16 },
    { header: "Estimasi Sales / Bln (Rp)", key: "estSalesBulan", width: 22, numFmt: RP_FMT },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18, numFmt: PCT_FMT },
    { header: "Insentif SC / Bln (Rp)", key: "nilaiScBulan", width: 20, numFmt: RP_FMT },
    { header: "% Diskon", key: "persenDiskon", width: 14, numFmt: PCT_FMT },
    { header: "Diskon / Bln (Rp)", key: "diskonBulan", width: 22, numFmt: RP_FMT },
    { header: "% Cashback", key: "persenCashback", width: 14, numFmt: PCT_FMT },
    { header: "Cashback Matrik / bulan", key: "cashbackBulan", width: 24, numFmt: RP_FMT },
    { header: "Total Rencana Biaya SC (Rp)", key: "rencanaTotalBiaya", width: 24, numFmt: RP_FMT },
    { header: "Status", key: "status", width: 16 },
  ];

  // ─── Sheet 2: DATA POA PER PERIODE (Rekap Akumulasi per Periode) ───────────
  const periodCols: ScExportCol[] = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode", key: "periode", width: 14 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Total Qty ST", key: "totalQty", width: 16 },
    { header: "Total Estimasi Sales (Rp)", key: "totalEstSales", width: 24, numFmt: RP_FMT },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18, numFmt: PCT_FMT },
    { header: "Total Insentif SC (Rp)", key: "totalNilaiSc", width: 22, numFmt: RP_FMT },
    { header: "% Diskon", key: "persenDiskon", width: 14, numFmt: PCT_FMT },
    { header: "Total Diskon (Rp)", key: "totalDiskon", width: 22, numFmt: RP_FMT },
    { header: "% Cashback", key: "persenCashback", width: 14, numFmt: PCT_FMT },
    { header: "Total Cashback (Rp)", key: "totalCashback", width: 22, numFmt: RP_FMT },
    { header: "Total Rencana Biaya SC (Rp)", key: "totalRencanaBiaya", width: 24, numFmt: RP_FMT },
    { header: "Status", key: "status", width: 16 },
  ];

  const entertainCols: ScExportCol[] = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode Bulan", key: "periodeMonth", width: 16 },
    { header: "Biaya Entertain (Rp)", key: "biayaEntertain", width: 22, numFmt: RP_FMT },
  ];

  const auditCols: ScExportCol[] = [
    { header: "Date", key: "date", width: 22 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Action", key: "action", width: 14 },
    { header: "From Status", key: "from", width: 22 },
    { header: "To Status", key: "to", width: 22 },
  ];

  // ─── Stream ───────────────────────────────────────────────────────────────
  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
  wb.creator = "POA Sales Counter System";
  wb.created = new Date();

  const writeWorkbook = async () => {
    const formSheet = startScExportSheet(wb, "DATA INPUT POA", formCols);
    // Baris rekap Sheet 2, ditulis setelah Sheet 1 selesai (sheet streaming ditulis berurutan).
    const periodRows: Record<string, unknown>[] = [];

    let formCounter = 1;
    for (const draft of drafts) {
      const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
      const stored = hasScSummary(draft);
      const scCodes = outletScProductCodesMap.get(draft.kodePI);

      const validProducts = draft.products.filter((p: any) => {
        if (stored) return isStoredScProduct(p);
        if (!p.kodeProduk) return false;
        if (scCodes && scCodes.size > 0 && !scCodes.has(p.kodeProduk) && !scCodes.has(p.kodeProduk.replace(/^0+/, ""))) {
          return false;
        }
        return true;
      });

      // HNA dan nilai SC satu baris: dari baris itu sendiri bila form punya ringkasan, selain itu dari master/Canvasser.
      const productInputs = (p: any) => {
        if (stored) return storedProductInputs(p);
        const mp = masterMap.get(p.kodeProduk);
        const cp = canvasserProductMap.get(`${draft.kodePI}_${p.kodeProduk}`);
        return {
          hnaSJ: mp ? parseFloat(mp.hna.toString()) : 0,
          scVal: cp?.sales_counter_value,
          scMin: cp?.sales_counter_minimum || 0,
        };
      };

      // Sort products by kodeProduk (asc) then periodeMonth (asc)
      validProducts.sort((a: any, b: any) =>
        a.kodeProduk.localeCompare(b.kodeProduk) || (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
      );

      // Group valid products by kodeProduk
      const productGroups = new Map<string, typeof validProducts>();
      for (const p of validProducts) {
        if (!productGroups.has(p.kodeProduk)) {
          productGroups.set(p.kodeProduk, []);
        }
        productGroups.get(p.kodeProduk)!.push(p);
      }

      const lama = draft.lamaPeriode || 3;
      const generatedMonths = getPeriodMonthList(draft.periodeAwal, lama);
      const distinctMonths = Array.from(new Set(validProducts.map((p: any) => p.periodeMonth).filter(Boolean))) as string[];
      const periodMonths = generatedMonths.length > 0 ? generatedMonths : distinctMonths;

      // Prepare inputs for calculateCashbackDetails (matching web app logic)
      const cashbackData = outletCashbackMap.get(draft.kodePI);
      const selectedProductsForCb = Array.from(productGroups.entries()).map(([kodeProduk, items]) => {
        const primary = items[0];
        const itemMonthMap = new Map<string, number>();
        for (const it of items) {
          if (it.periodeMonth) {
            itemMonthMap.set(it.periodeMonth, it.qtyPerBulan);
          }
        }
        const hasAnyPeriodeMonth = items.some((it: any) => Boolean(it.periodeMonth));
        const monthlyQty = periodMonths.map((m) => {
          const q = itemMonthMap.has(m)
            ? (itemMonthMap.get(m) || 0)
            : (hasAnyPeriodeMonth || periodMonths.length > 1 ? 0 : (primary.qtyPerBulan || 0));
          return String(q);
        });

        return {
          kodeProduk,
          qtyPerBulan: String(primary.qtyPerBulan || 0),
          monthlyQty,
          persenCashback: String(primary.persenCashback || 0),
        };
      });

      const masterProductsForCb = Array.from(productGroups.keys()).map((code) => {
        const mp = masterMap.get(code);
        return {
          kodeProduk: code,
          hna: String(mp ? parseFloat(mp.hna.toString()) : 0),
          konversiPembagi: String(mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1),
        };
      });

      const cbDetails = stored
        ? null
        : calculateCashbackDetails({
            cashbackData,
            selectedProducts: selectedProductsForCb,
            masterProducts: masterProductsForCb,
            lamaPeriode: lama,
          });

      // Sort products by kodeProduk then periodeMonth for Sheet 1
      validProducts.sort((a: any, b: any) =>
        a.kodeProduk.localeCompare(b.kodeProduk) || (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
      );

      // Populate Sheet 1: Detail per Bulan
      for (const p of validProducts) {
        const { hnaSJ, scVal, scMin } = productInputs(p);
        const qty = p.qtyPerBulan || 0;
        const estSalesBulan = qty * hnaSJ;
        const pctMatriks = (parseFloat(p.persenMatriksSc.toString()) || 0) / 100;

        let nilaiScBulan = 0;
        if (scVal != null && scVal > 0) {
          nilaiScBulan = qty >= scMin ? qty * scVal : 0;
        } else {
          nilaiScBulan = estSalesBulan * pctMatriks;
        }

        const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
        const diskonBulan = estSalesBulan * pctDiskon;

        const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;

        // Find monthly cashback from cbDetails (matrix & multiplier rules)
        let cashbackBulan = 0;
        if (stored) {
          cashbackBulan = storedCashbackBulan(p, periodMonths, lama);
        } else if (cashbackData) {
          const mIdx = p.periodeMonth ? periodMonths.indexOf(p.periodeMonth) : -1;
          if (mIdx >= 0 && cbDetails?.monthlyStats?.[mIdx]) {
            const stat = cbDetails.monthlyStats[mIdx].productStats.find((ps) => ps.kodeProduk === p.kodeProduk);
            cashbackBulan = stat ? stat.mCashbackVal : 0;
          } else {
            cashbackBulan = cbDetails?.monthlyResultMap?.get(p.kodeProduk) ?? 0;
          }
        } else {
          cashbackBulan = estSalesBulan * pctCashback;
        }

        const totalBiayaProduk = nilaiScBulan + diskonBulan + cashbackBulan;

        writeScExportRow(formSheet, formCols, {
          formNo: formCounter,
          nipMr: draft.owner.nip,
          namaMr: draft.owner.name,
          kodePI: draft.kodePI,
          namaOutlet: draft.namaOutlet || draft.kodePI,
          periode: p.periodeMonth || draft.period || draft.periodeAwal || targetPeriod,
          scPersonNames: scPersonStr,
          kodeProduk: p.kodeProduk,
          namaProduk: p.namaProduk,
          produkKompetitor: p.produkKompetitor || "-",
          qtyPerBulan: qty,
          estSalesBulan: Math.round(estSalesBulan),
          persenMatriksSc: pctMatriks,
          nilaiScBulan: Math.round(nilaiScBulan),
          persenDiskon: pctDiskon,
          diskonBulan: Math.round(diskonBulan),
          persenCashback: pctCashback,
          cashbackBulan: Math.round(cashbackBulan),
          rencanaTotalBiaya: Math.round(totalBiayaProduk),
          status: draft.status.replace(/_/g, " "),
        });
      }

      // Populate Sheet 2: Rekap / Sum per Produk untuk Satu Periode (Sorted by Kode Produk asc)
      const sortedProductGroups = Array.from(productGroups.entries()).sort(([codeA], [codeB]) =>
        codeA.localeCompare(codeB)
      );
      for (const [, items] of sortedProductGroups) {
        const primary = items[0];
        const { hnaSJ, scVal, scMin } = productInputs(primary);
        const pctMatriks = (parseFloat(primary.persenMatriksSc.toString()) || 0) / 100;
        const pctDiskon = (parseFloat(primary.persenDiskon.toString()) || 0) / 100;
        const pctCashback = (parseFloat(primary.persenCashback.toString()) || 0) / 100;

        let totalQty = 0;
        let totalEstSales = 0;
        let totalNilaiSc = 0;
        let totalDiskon = 0;

        for (const it of items) {
          const q = it.qtyPerBulan || 0;
          const estMonth = q * hnaSJ;

          let scMonth = 0;
          if (scVal != null && scVal > 0) {
            scMonth = q >= scMin ? q * scVal : 0;
          } else {
            scMonth = estMonth * pctMatriks;
          }

          const dMonth = estMonth * pctDiskon;

          totalQty += q;
          totalEstSales += estMonth;
          totalNilaiSc += scMonth;
          totalDiskon += dMonth;
        }

        const totalCashback = stored
          ? storedCashbackTotal(items)
          : cashbackData
            ? (cbDetails?.resultMap?.get(primary.kodeProduk) ?? 0)
            : totalEstSales * pctCashback;

        const totalBiaya = totalNilaiSc + totalDiskon + totalCashback;

        periodRows.push({
          formNo: formCounter,
          nipMr: draft.owner.nip,
          namaMr: draft.owner.name,
          kodePI: draft.kodePI,
          namaOutlet: draft.namaOutlet || draft.kodePI,
          periode: draft.period || targetPeriod,
          scPersonNames: scPersonStr,
          kodeProduk: primary.kodeProduk,
          namaProduk: primary.namaProduk,
          produkKompetitor: primary.produkKompetitor || "-",
          totalQty,
          totalEstSales: Math.round(totalEstSales),
          persenMatriksSc: pctMatriks,
          totalNilaiSc: Math.round(totalNilaiSc),
          persenDiskon: pctDiskon,
          totalDiskon: Math.round(totalDiskon),
          persenCashback: pctCashback,
          totalCashback: Math.round(totalCashback),
          totalRencanaBiaya: Math.round(totalBiaya),
          status: draft.status.replace(/_/g, " "),
        });
      }

      formCounter++;
    }

    formSheet.commit();

    const periodSheet = startScExportSheet(wb, "DATA POA PER PERIODE", periodCols);
    for (const row of periodRows) writeScExportRow(periodSheet, periodCols, row);
    periodSheet.commit();

    // ─── Sheet: BIAYA ENTERTAIN OUTLET (Jika ada data entertain) ─────────────
    const hasEntertain = drafts.some((d: any) => d.entertainItems && d.entertainItems.length > 0);
    if (hasEntertain) {
      const entertainSheet = startScExportSheet(wb, "BIAYA ENTERTAIN OUTLET", entertainCols);
      let fNum = 1;
      for (const draft of drafts) {
        const sortedEntertain = draft.entertainItems.slice().sort((a: any, b: any) =>
          (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
        );
        for (const ent of sortedEntertain) {
          writeScExportRow(entertainSheet, entertainCols, {
            formNo: fNum,
            kodePI: draft.kodePI,
            namaOutlet: draft.namaOutlet || draft.kodePI,
            periodeMonth: ent.periodeMonth,
            biayaEntertain: parseFloat(ent.biayaEntertain.toString()) || 0,
          });
        }
        fNum++;
      }
      entertainSheet.commit();
    }

    // ─── Sheet: Audit Log SC ─────────────────────────────────────────────────
    const auditSheet = startScExportSheet(wb, "Audit Log SC", auditCols);
    const allLogs = drafts
      .flatMap((d: any) => d.auditLogs)
      .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const log of allLogs) {
      writeScExportRow(auditSheet, auditCols, {
        date: log.createdAt.toISOString(),
        actor: `${log.actor.name} (${log.actor.nip})`,
        action: log.action,
        from: log.fromStatus ?? "-",
        to: log.toStatus ?? "-",
      });
    }
    auditSheet.commit();

    await wb.commit();
  };

  writeWorkbook().catch((err) => {
    console.error("[sc/[id]/export] streaming failed:", err);
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new NextResponse(Readable.toWeb(pass) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_SC_${targetPeriod}_${owner.nip}.xlsx"`,
    },
  });
}
