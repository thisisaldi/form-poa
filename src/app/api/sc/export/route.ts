/**
 * GET /api/sc/export
 *
 * Bulk Sales Counter Excel export for Dashboard:
 * Supports:
 * - ?period=2026-Q3 (or current quarter when omitted or 'current')
 * - ?period=all (exports all periods and all products)
 *
 * Sheets:
 * 1. DATA INPUT POA (Detail per Bulan)
 * 2. DATA POA PER PERIODE (Rekap per Periode)
 * 3. SUMMARY BY PRODUK (Rekap Semua Produk)
 * 4. BIAYA ENTERTAIN OUTLET (Jika ada data entertain)
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getVisiblePoaScFilter } from "@/lib/authz";
import { currentQuarter } from "@/lib/quarterUtils";
import { getSalesCounterProduct } from "@/app/(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScCashbackPoa } from "@/app/(app)/sc/[id]/_services/getScCashbackPoa";
import { calculateCashbackDetails } from "@/components/sc/edit/hooks/useSalesCounterCashback";
import { getPeriodMonthList } from "@/components/sc/detail/utils/outletCalculationUtils";

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const visibleFilter = await getVisiblePoaScFilter(actor);

  const searchParams = req.nextUrl.searchParams;
  const periodParam = searchParams.get("period");
  const isAllPeriod = periodParam === "all";
  const targetPeriod = isAllPeriod ? null : (periodParam && periodParam !== "current" ? periodParam : currentQuarter());

  const where: any = { AND: [visibleFilter] };
  if (targetPeriod) {
    where.AND.push({ period: targetPeriod });
  }

  const drafts = await prisma.poaScForm.findMany({
    where,
    include: {
      owner: true,
      currentHolder: true,
      products: true,
      persons: true,
      entertainItems: true,
    },
    orderBy: [{ period: "asc" }, { kodePI: "asc" }],
  });

  if (drafts.length === 0) {
    return NextResponse.json(
      { error: `Tidak ada data POA Sales Counter ditemukan untuk ${targetPeriod ? `periode ${targetPeriod}` : "semua periode"}` },
      { status: 404 }
    );
  }

  // Ensure deterministic sorting: Periode Kuartal (asc / kecil ke besar), Kode PI Outlet (asc)
  drafts.sort((a: any, b: any) =>
    (a.period || "").localeCompare(b.period || "") ||
    (a.kodePI || "").localeCompare(b.kodePI || "")
  );

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

  const outletCodes = Array.from(new Set(drafts.map((d: any) => d.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();
  const outletScProductCodesMap = new Map<string, Set<string>>();
  const outletCashbackMap = new Map<string, any>();

  await Promise.all(
    outletCodes.map(async (kodePI: string) => {
      try {
        const [scRes, cbRes] = await Promise.all([
          getSalesCounterProduct(kodePI).catch(() => null),
          getScCashbackPoa(kodePI).catch(() => null),
        ]);
        if (scRes?.data) {
          const scSet = new Set<string>();
          for (const cp of scRes.data) {
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
        console.error(`Error fetching SC/Cashback for ${kodePI}:`, err);
      }
    })
  );

  // Build ExcelJS Workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "POA Sales Counter System";
  wb.created = new Date();

  const BLUE = "FF0063A0";
  const WHITE = "FFFFFFFF";
  const RP_FMT = "#,##0";
  const PCT_FMT = "0.0%";

  // ─── Sheet 1: DATA INPUT POA (Detail per Bulan) ───────────────────────────
  const formSheet = wb.addWorksheet("DATA INPUT POA");
  formSheet.columns = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode Kuartal", key: "periodeKuartal", width: 16 },
    { header: "Periode Bulan", key: "periodeBulan", width: 14 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Qty ST / Bulan", key: "qtyPerBulan", width: 16 },
    { header: "Estimasi Sales / Bln (Rp)", key: "estSalesBulan", width: 22 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Insentif SC / Bln (Rp)", key: "nilaiScBulan", width: 20 },
    { header: "% Diskon", key: "persenDiskon", width: 14 },
    { header: "Diskon / Bln (Rp)", key: "diskonBulan", width: 22 },
    { header: "% Cashback", key: "persenCashback", width: 14 },
    { header: "Cashback Matrik / bulan", key: "cashbackBulan", width: 24 },
    { header: "Total Rencana Biaya SC (Rp)", key: "rencanaTotalBiaya", width: 24 },
    { header: "Status", key: "status", width: 16 },
  ];

  formSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  formSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  formSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  // ─── Sheet 2: DATA POA PER PERIODE (Rekap Akumulasi per Periode) ───────────
  const periodSheet = wb.addWorksheet("DATA POA PER PERIODE");
  periodSheet.columns = [
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
    { header: "Total Estimasi Sales (Rp)", key: "totalEstSales", width: 24 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Total Insentif SC (Rp)", key: "totalNilaiSc", width: 22 },
    { header: "% Diskon", key: "persenDiskon", width: 14 },
    { header: "Total Diskon (Rp)", key: "totalDiskon", width: 22 },
    { header: "% Cashback", key: "persenCashback", width: 14 },
    { header: "Total Cashback (Rp)", key: "totalCashback", width: 22 },
    { header: "Total Rencana Biaya SC (Rp)", key: "totalRencanaBiaya", width: 24 },
    { header: "Status", key: "status", width: 16 },
  ];

  periodSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  periodSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  periodSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  // Global Product Aggregations for Sheet 3
  interface GlobalProductSummary {
    kodeProduk: string;
    namaProduk: string;
    totalQty: number;
    totalEstSales: number;
    totalNilaiSc: number;
    totalDiskon: number;
    totalCashback: number;
    totalRencanaBiaya: number;
    outlets: Set<string>;
  }
  const globalProductSummaryMap = new Map<string, GlobalProductSummary>();

  let formCounter = 1;
  for (const draft of drafts) {
    const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
    const scCodes = outletScProductCodesMap.get(draft.kodePI);

    const validProducts = draft.products.filter((p: any) => {
      if (!p.kodeProduk) return false;
      if (scCodes && scCodes.size > 0 && !scCodes.has(p.kodeProduk) && !scCodes.has(p.kodeProduk.replace(/^0+/, ""))) {
        return false;
      }
      return true;
    });

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

    // Prepare inputs for calculateCashbackDetails (exact web logic)
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

    const cbDetails = calculateCashbackDetails({
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
      const mp = masterMap.get(p.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const qty = p.qtyPerBulan || 0;
      const estSalesBulan = qty * hnaSJ;
      const pctMatriks = (parseFloat(p.persenMatriksSc.toString()) || 0) / 100;
      const cp = canvasserProductMap.get(`${draft.kodePI}_${p.kodeProduk}`);
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

      let nilaiScBulan = 0;
      if (scVal != null && scVal > 0) {
        nilaiScBulan = qty >= scMin ? qty * scVal : 0;
      } else {
        nilaiScBulan = estSalesBulan * pctMatriks;
      }

      const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
      const diskonBulan = estSalesBulan * pctDiskon;

      const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;

      let cashbackBulan = 0;
      if (cashbackData) {
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

      formSheet.addRow({
        formNo: formCounter,
        nipMr: draft.owner.nip,
        namaMr: draft.owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        periodeKuartal: draft.period,
        periodeBulan: p.periodeMonth || draft.periodeAwal || draft.period,
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
      const mp = masterMap.get(primary.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const pctMatriks = (parseFloat(primary.persenMatriksSc.toString()) || 0) / 100;
      const pctDiskon = (parseFloat(primary.persenDiskon.toString()) || 0) / 100;
      const pctCashback = (parseFloat(primary.persenCashback.toString()) || 0) / 100;

      const cp = canvasserProductMap.get(`${draft.kodePI}_${primary.kodeProduk}`);
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

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

      const totalCashback = cashbackData
        ? (cbDetails?.resultMap?.get(primary.kodeProduk) ?? 0)
        : totalEstSales * pctCashback;

      const totalBiaya = totalNilaiSc + totalDiskon + totalCashback;

      periodSheet.addRow({
        formNo: formCounter,
        nipMr: draft.owner.nip,
        namaMr: draft.owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        periode: draft.period,
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

      // Update Global Product Summary for Sheet 3
      const gKey = primary.kodeProduk;
      if (!globalProductSummaryMap.has(gKey)) {
        globalProductSummaryMap.set(gKey, {
          kodeProduk: primary.kodeProduk,
          namaProduk: primary.namaProduk,
          totalQty: 0,
          totalEstSales: 0,
          totalNilaiSc: 0,
          totalDiskon: 0,
          totalCashback: 0,
          totalRencanaBiaya: 0,
          outlets: new Set<string>(),
        });
      }
      const gItem = globalProductSummaryMap.get(gKey)!;
      gItem.totalQty += totalQty;
      gItem.totalEstSales += totalEstSales;
      gItem.totalNilaiSc += totalNilaiSc;
      gItem.totalDiskon += totalDiskon;
      gItem.totalCashback += totalCashback;
      gItem.totalRencanaBiaya += totalBiaya;
      gItem.outlets.add(draft.kodePI);
    }

    formCounter++;
  }

  // ─── Sheet 3: SUMMARY BY PRODUK ──────────────────────────────────────────
  const summarySheet = wb.addWorksheet("SUMMARY BY PRODUK");
  summarySheet.columns = [
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk", key: "namaProduk", width: 32 },
    { header: "Total Qty ST", key: "totalQty", width: 16 },
    { header: "Total Estimasi Sales (Rp)", key: "totalEstSales", width: 24 },
    { header: "Total Insentif SC (Rp)", key: "totalNilaiSc", width: 22 },
    { header: "Total Diskon (Rp)", key: "totalDiskon", width: 22 },
    { header: "Total Cashback (Rp)", key: "totalCashback", width: 22 },
    { header: "Total Rencana Biaya (Rp)", key: "totalRencanaBiaya", width: 24 },
    { header: "Cost Ratio (%)", key: "costRatio", width: 16 },
    { header: "Jumlah Outlet", key: "outletCount", width: 16 },
  ];

  summarySheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  summarySheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  summarySheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  const sortedSummaryRows = Array.from(globalProductSummaryMap.values()).sort(
    (a, b) => b.totalEstSales - a.totalEstSales || a.kodeProduk.localeCompare(b.kodeProduk)
  );

  for (const s of sortedSummaryRows) {
    const costRatio = s.totalEstSales > 0 ? (s.totalRencanaBiaya / s.totalEstSales) * 100 : 0;
    summarySheet.addRow({
      kodeProduk: s.kodeProduk,
      namaProduk: s.namaProduk,
      totalQty: s.totalQty,
      totalEstSales: Math.round(s.totalEstSales),
      totalNilaiSc: Math.round(s.totalNilaiSc),
      totalDiskon: Math.round(s.totalDiskon),
      totalCashback: Math.round(s.totalCashback),
      totalRencanaBiaya: Math.round(s.totalRencanaBiaya),
      costRatio: costRatio / 100, // format as percentage
      outletCount: s.outlets.size,
    });
  }

  // Format Sheet 1
  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    formSheet.getColumn(k).numFmt = PCT_FMT;
  });
  ["estSalesBulan", "nilaiScBulan", "diskonBulan", "cashbackBulan", "rencanaTotalBiaya"].forEach((k) => {
    formSheet.getColumn(k).numFmt = RP_FMT;
  });
  formSheet.getColumn("qtyPerBulan").numFmt = RP_FMT;

  // Format Sheet 2
  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    periodSheet.getColumn(k).numFmt = PCT_FMT;
  });
  ["totalEstSales", "totalNilaiSc", "totalDiskon", "totalCashback", "totalRencanaBiaya"].forEach((k) => {
    periodSheet.getColumn(k).numFmt = RP_FMT;
  });
  periodSheet.getColumn("totalQty").numFmt = RP_FMT;

  // Format Sheet 3
  ["totalEstSales", "totalNilaiSc", "totalDiskon", "totalCashback", "totalRencanaBiaya"].forEach((k) => {
    summarySheet.getColumn(k).numFmt = RP_FMT;
  });
  summarySheet.getColumn("totalQty").numFmt = RP_FMT;
  summarySheet.getColumn("costRatio").numFmt = PCT_FMT;
  summarySheet.getColumn("outletCount").numFmt = RP_FMT;

  // ─── Sheet 4: BIAYA ENTERTAIN OUTLET (Jika ada) ──────────────────────────
  const hasEntertain = drafts.some((d: any) => d.entertainItems && d.entertainItems.length > 0);
  if (hasEntertain) {
    const entertainSheet = wb.addWorksheet("BIAYA ENTERTAIN OUTLET");
    entertainSheet.columns = [
      { header: "No. Form SC", key: "formNo", width: 12 },
      { header: "NIP MR", key: "nipMr", width: 14 },
      { header: "Nama MR", key: "namaMr", width: 24 },
      { header: "KodePI Outlet", key: "kodePI", width: 14 },
      { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
      { header: "Periode Kuartal", key: "periodeKuartal", width: 16 },
      { header: "Periode Bulan", key: "periodeMonth", width: 16 },
      { header: "Biaya Entertain (Rp)", key: "biayaEntertain", width: 22 },
    ];
    entertainSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
    entertainSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    entertainSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

    let fNum = 1;
    for (const draft of drafts) {
      const sortedEntertain = draft.entertainItems.slice().sort((a: any, b: any) =>
        (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
      );
      for (const ent of sortedEntertain) {
        entertainSheet.addRow({
          formNo: fNum,
          nipMr: draft.owner.nip,
          namaMr: draft.owner.name,
          kodePI: draft.kodePI,
          namaOutlet: draft.namaOutlet || draft.kodePI,
          periodeKuartal: draft.period,
          periodeMonth: ent.periodeMonth,
          biayaEntertain: parseFloat(ent.biayaEntertain.toString()) || 0,
        });
      }
      fNum++;
    }
    entertainSheet.getColumn("biayaEntertain").numFmt = RP_FMT;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = targetPeriod
    ? `POA_SC_${targetPeriod}_Export.xlsx`
    : `POA_SC_Semua_Produk_Periode_Export.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
