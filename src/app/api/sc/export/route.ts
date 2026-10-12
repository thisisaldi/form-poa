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
 *
 * STREAMING (2026-10-12): produksi punya 200rb+ baris produk, dan versi sebelumnya memuat semua form + membangun
 * seluruh workbook di memori (ExcelJS menyimpan tiap sel sebagai objek, ~300x ukuran file) lalu `writeBuffer`
 * → OOM. Sekarang: form diambil per halaman (PAGE_SIZE) lalu baris langsung di-commit ke ExcelJS WorkbookWriter
 * yang menulis ke response stream, jadi memori datar terhadap jumlah baris. Konsekuensi: sheet ditulis berurutan
 * (1 → 2 → 3 → 4), sehingga halaman form dihitung ulang untuk tiap sheet (CPU 2-3x, bukan memori), dan agregat
 * Sheet 3 dikumpulkan saat Sheet 2 ditulis. Rumus per baris tidak berubah.
 */

import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
import { getAppSetting } from "@/lib/appSettings";
import { settingMessage } from "@/lib/appSettingsRegistry";
import { getCurrentUser } from "@/lib/session";
import { getVisiblePoaScFilter } from "@/lib/authz";
import { currentQuarter } from "@/lib/quarterUtils";
import { getSalesCounterProduct } from "@/app/(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScCashbackPoa } from "@/app/(app)/sc/[id]/_services/getScCashbackPoa";
import { calculateCashbackDetails } from "@/components/sc/edit/hooks/useSalesCounterCashback";
import { getPeriodMonthList } from "@/components/sc/detail/utils/outletCalculationUtils";

const PAGE_SIZE = 100;

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

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

const BLUE = "FF0063A0";
const WHITE = "FFFFFFFF";
const RP_FMT = "#,##0";
const PCT_FMT = "0.0%";

type ColDef = { header: string; key: string; width: number; numFmt?: string };

/** Sheet dengan header berwarna + format angka per kolom (WorkbookWriter: header ditulis manual lalu di-commit). */
function startSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, name: string, cols: ColDef[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: WHITE } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.commit();
  return ws;
}

/** Tulis satu baris (objek ber-key) tepat sesuai urutan kolom, lalu commit supaya langsung dilepas dari memori. */
function writeRow(ws: ExcelJS.Worksheet, cols: ColDef[], data: Record<string, unknown>) {
  const row = ws.addRow(cols.map((c) => data[c.key] as ExcelJS.CellValue));
  row.commit();
}

export async function GET(req: NextRequest) {
  if (await getAppSetting("export.sc.disabled")) {
    return NextResponse.json({ error: settingMessage("export.sc.disabled") }, { status: 503 });
  }
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

  if (isAllPeriod && (await getAppSetting("export.team.periodAllDisabled"))) {
    return NextResponse.json({ error: settingMessage("export.team.periodAllDisabled") }, { status: 400 });
  }

  const where: any = { AND: [visibleFilter] };
  if (targetPeriod) {
    where.AND.push({ period: targetPeriod });
  }

  // Urutan deterministik: Periode Kuartal (asc), Kode PI Outlet (asc); id sebagai pemecah seri supaya halaman stabil.
  const refs: { id: string; kodePI: string | null; period: string | null }[] = await prisma.poaScForm.findMany({
    where,
    select: { id: true, kodePI: true, period: true },
    orderBy: [{ period: "asc" }, { kodePI: "asc" }, { id: "asc" }],
  });

  if (refs.length === 0) {
    return NextResponse.json(
      { error: `Tidak ada data POA Sales Counter ditemukan untuk ${targetPeriod ? `periode ${targetPeriod}` : "semua periode"}` },
      { status: 404 }
    );
  }

  const indexById = new Map(refs.map((r, i) => [r.id, i]));

  // Master produk: hanya kode yang benar-benar dipakai (distinct di DB, bukan memuat semua baris).
  const codeRows: { kodeProduk: string | null }[] = await prisma.poaScProductItem.findMany({
    where: { poaSc: where },
    distinct: ["kodeProduk"],
    select: { kodeProduk: true },
  });
  const allProductCodes = codeRows.map((r) => r.kodeProduk).filter((c): c is string => !!c);
  const masterProducts: MasterProductItem[] = await prisma.product.findMany({
    where: { kodeProduk: { in: allProductCodes } },
    select: { kodeProduk: true, namaProduk: true, hna: true, konversiPembagi: true, satuanTerkecil: true, satuan: true },
  });
  const masterMap = new Map<string, MasterProductItem>(masterProducts.map((p) => [p.kodeProduk, p]));

  const outletCodes = Array.from(new Set(refs.map((d) => d.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();
  const outletScProductCodesMap = new Map<string, Set<string>>();
  const outletCashbackMap = new Map<string, any>();

  const outletPeriodMap = new Map<string, string>();
  for (const d of refs) {
    if (d.kodePI && d.period && !outletPeriodMap.has(d.kodePI)) outletPeriodMap.set(d.kodePI, d.period);
  }

  await mapWithConcurrency(outletCodes, 8, async (kodePI: string) => {
    try {
      const draftPeriod = outletPeriodMap.get(kodePI) || targetPeriod;
      const [scRes, cbRes] = await Promise.all([
        getSalesCounterProduct(kodePI, draftPeriod).catch(() => null),
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
      if (cbRes) outletCashbackMap.set(kodePI, cbRes);
    } catch (err) {
      console.error(`Error fetching SC/Cashback for ${kodePI}:`, err);
    }
  });

  const hasEntertain = (await prisma.poaScEntertainItem.count({ where: { poaSc: where } })) > 0;

  // ─── Kolom ────────────────────────────────────────────────────────────────
  const formCols: ColDef[] = [
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
    { header: "Qty ST / Bulan", key: "qtyPerBulan", width: 16, numFmt: RP_FMT },
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
  const periodCols: ColDef[] = [
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
    { header: "Total Qty ST", key: "totalQty", width: 16, numFmt: RP_FMT },
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
  const summaryCols: ColDef[] = [
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk", key: "namaProduk", width: 32 },
    { header: "Total Qty ST", key: "totalQty", width: 16, numFmt: RP_FMT },
    { header: "Total Estimasi Sales (Rp)", key: "totalEstSales", width: 24, numFmt: RP_FMT },
    { header: "Total Insentif SC (Rp)", key: "totalNilaiSc", width: 22, numFmt: RP_FMT },
    { header: "Total Diskon (Rp)", key: "totalDiskon", width: 22, numFmt: RP_FMT },
    { header: "Total Cashback (Rp)", key: "totalCashback", width: 22, numFmt: RP_FMT },
    { header: "Total Rencana Biaya (Rp)", key: "totalRencanaBiaya", width: 24, numFmt: RP_FMT },
    { header: "Cost Ratio (%)", key: "costRatio", width: 16, numFmt: PCT_FMT },
    { header: "Jumlah Outlet", key: "outletCount", width: 16, numFmt: RP_FMT },
  ];
  const entertainCols: ColDef[] = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode Kuartal", key: "periodeKuartal", width: 16 },
    { header: "Periode Bulan", key: "periodeMonth", width: 16 },
    { header: "Biaya Entertain (Rp)", key: "biayaEntertain", width: 22, numFmt: RP_FMT },
  ];

  /** Satu halaman form lengkap dengan relasi, urut sesuai `refs` (id dalam halaman diurutkan ulang). */
  async function loadPage(start: number, include: Record<string, boolean>) {
    const ids = refs.slice(start, start + PAGE_SIZE).map((r) => r.id);
    const rows: any[] = await prisma.poaScForm.findMany({ where: { id: { in: ids } }, include: { owner: true, ...include } });
    rows.sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));
    return rows;
  }

  /** Turunan satu draft (produk valid, rekap kasbek) — sama persis dengan logika versi sebelumnya. */
  function deriveDraft(draft: any) {
    const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
    const scCodes = outletScProductCodesMap.get(draft.kodePI);

    const validProducts = draft.products.filter((p: any) => {
      if (!p.kodeProduk) return false;
      if (scCodes && scCodes.size > 0 && !scCodes.has(p.kodeProduk) && !scCodes.has(p.kodeProduk.replace(/^0+/, ""))) {
        return false;
      }
      return true;
    });
    validProducts.sort((a: any, b: any) =>
      a.kodeProduk.localeCompare(b.kodeProduk) || (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
    );

    const productGroups = new Map<string, any[]>();
    for (const p of validProducts) {
      if (!productGroups.has(p.kodeProduk)) productGroups.set(p.kodeProduk, []);
      productGroups.get(p.kodeProduk)!.push(p);
    }

    const lama = draft.lamaPeriode || 3;
    const generatedMonths = getPeriodMonthList(draft.periodeAwal, lama);
    const distinctMonths = Array.from(new Set(validProducts.map((p: any) => p.periodeMonth).filter(Boolean))) as string[];
    const periodMonths = generatedMonths.length > 0 ? generatedMonths : distinctMonths;

    const cashbackData = outletCashbackMap.get(draft.kodePI);
    const selectedProductsForCb = Array.from(productGroups.entries()).map(([kodeProduk, items]) => {
      const primary = items[0];
      const itemMonthMap = new Map<string, number>();
      for (const it of items) {
        if (it.periodeMonth) itemMonthMap.set(it.periodeMonth, it.qtyPerBulan);
      }
      const hasAnyPeriodeMonth = items.some((it: any) => Boolean(it.periodeMonth));
      const monthlyQty = periodMonths.map((m) => {
        const q = itemMonthMap.has(m)
          ? (itemMonthMap.get(m) || 0)
          : (hasAnyPeriodeMonth || periodMonths.length > 1 ? 0 : (primary.qtyPerBulan || 0));
        return String(q);
      });
      return { kodeProduk, qtyPerBulan: String(primary.qtyPerBulan || 0), monthlyQty, persenCashback: String(primary.persenCashback || 0) };
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

    return { scPersonStr, validProducts, productGroups, periodMonths, cashbackData, cbDetails };
  }

  function detailRow(draft: any, formNo: number, d: ReturnType<typeof deriveDraft>, p: any) {
    const mp = masterMap.get(p.kodeProduk);
    const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
    const qty = p.qtyPerBulan || 0;
    const estSalesBulan = qty * hnaSJ;
    const pctMatriks = (parseFloat(p.persenMatriksSc.toString()) || 0) / 100;
    const cp = canvasserProductMap.get(`${draft.kodePI}_${p.kodeProduk}`);
    const scVal = cp?.sales_counter_value;
    const scMin = cp?.sales_counter_minimum || 0;

    let nilaiScBulan = 0;
    if (scVal != null && scVal > 0) nilaiScBulan = qty >= scMin ? qty * scVal : 0;
    else nilaiScBulan = estSalesBulan * pctMatriks;

    const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
    const diskonBulan = estSalesBulan * pctDiskon;
    const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;

    let cashbackBulan = 0;
    if (d.cashbackData) {
      const mIdx = p.periodeMonth ? d.periodMonths.indexOf(p.periodeMonth) : -1;
      if (mIdx >= 0 && d.cbDetails?.monthlyStats?.[mIdx]) {
        const stat = d.cbDetails.monthlyStats[mIdx].productStats.find((ps: any) => ps.kodeProduk === p.kodeProduk);
        cashbackBulan = stat ? stat.mCashbackVal : 0;
      } else {
        cashbackBulan = d.cbDetails?.monthlyResultMap?.get(p.kodeProduk) ?? 0;
      }
    } else {
      cashbackBulan = estSalesBulan * pctCashback;
    }

    const totalBiayaProduk = nilaiScBulan + diskonBulan + cashbackBulan;
    return {
      formNo,
      nipMr: draft.owner.nip,
      namaMr: draft.owner.name,
      kodePI: draft.kodePI,
      namaOutlet: draft.namaOutlet || draft.kodePI,
      periodeKuartal: draft.period,
      periodeBulan: p.periodeMonth || draft.periodeAwal || draft.period,
      scPersonNames: d.scPersonStr,
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
    };
  }

  const globalProductSummaryMap = new Map<string, GlobalProductSummary>();

  function recapRow(draft: any, formNo: number, d: ReturnType<typeof deriveDraft>, items: any[]) {
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
      if (scVal != null && scVal > 0) scMonth = q >= scMin ? q * scVal : 0;
      else scMonth = estMonth * pctMatriks;
      totalQty += q;
      totalEstSales += estMonth;
      totalNilaiSc += scMonth;
      totalDiskon += estMonth * pctDiskon;
    }
    const totalCashback = d.cashbackData
      ? (d.cbDetails?.resultMap?.get(primary.kodeProduk) ?? 0)
      : totalEstSales * pctCashback;
    const totalBiaya = totalNilaiSc + totalDiskon + totalCashback;

    // Agregat Sheet 3
    const gKey = primary.kodeProduk;
    if (!globalProductSummaryMap.has(gKey)) {
      globalProductSummaryMap.set(gKey, {
        kodeProduk: primary.kodeProduk, namaProduk: primary.namaProduk,
        totalQty: 0, totalEstSales: 0, totalNilaiSc: 0, totalDiskon: 0, totalCashback: 0, totalRencanaBiaya: 0,
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

    return {
      formNo,
      nipMr: draft.owner.nip,
      namaMr: draft.owner.name,
      kodePI: draft.kodePI,
      namaOutlet: draft.namaOutlet || draft.kodePI,
      periode: draft.period,
      scPersonNames: d.scPersonStr,
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
    };
  }

  // ─── Stream ───────────────────────────────────────────────────────────────
  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
  wb.creator = "POA Sales Counter System";
  wb.created = new Date();

  (async () => {
    // Sheet 1
    const formSheet = startSheet(wb, "DATA INPUT POA", formCols);
    for (let start = 0; start < refs.length; start += PAGE_SIZE) {
      const page = await loadPage(start, { products: true, persons: true } as any);
      for (const draft of page) {
        const d = deriveDraft(draft);
        const formNo = (indexById.get(draft.id) ?? 0) + 1;
        for (const p of d.validProducts) writeRow(formSheet, formCols, detailRow(draft, formNo, d, p));
      }
    }
    formSheet.commit();

    // Sheet 2 (+ agregat Sheet 3)
    const periodSheet = startSheet(wb, "DATA POA PER PERIODE", periodCols);
    for (let start = 0; start < refs.length; start += PAGE_SIZE) {
      const page = await loadPage(start, { products: true, persons: true } as any);
      for (const draft of page) {
        const d = deriveDraft(draft);
        const formNo = (indexById.get(draft.id) ?? 0) + 1;
        const groups = Array.from(d.productGroups.entries()).sort(([a], [b]) => a.localeCompare(b));
        for (const [, items] of groups) writeRow(periodSheet, periodCols, recapRow(draft, formNo, d, items));
      }
    }
    periodSheet.commit();

    // Sheet 3
    const summarySheet = startSheet(wb, "SUMMARY BY PRODUK", summaryCols);
    const sortedSummaryRows = Array.from(globalProductSummaryMap.values()).sort(
      (a, b) => b.totalEstSales - a.totalEstSales || a.kodeProduk.localeCompare(b.kodeProduk)
    );
    for (const s of sortedSummaryRows) {
      const costRatio = s.totalEstSales > 0 ? (s.totalRencanaBiaya / s.totalEstSales) * 100 : 0;
      writeRow(summarySheet, summaryCols, {
        kodeProduk: s.kodeProduk,
        namaProduk: s.namaProduk,
        totalQty: s.totalQty,
        totalEstSales: Math.round(s.totalEstSales),
        totalNilaiSc: Math.round(s.totalNilaiSc),
        totalDiskon: Math.round(s.totalDiskon),
        totalCashback: Math.round(s.totalCashback),
        totalRencanaBiaya: Math.round(s.totalRencanaBiaya),
        costRatio: costRatio / 100,
        outletCount: s.outlets.size,
      });
    }
    summarySheet.commit();

    // Sheet 4 (bila ada)
    if (hasEntertain) {
      const entertainSheet = startSheet(wb, "BIAYA ENTERTAIN OUTLET", entertainCols);
      for (let start = 0; start < refs.length; start += PAGE_SIZE) {
        const page = await loadPage(start, { entertainItems: true } as any);
        for (const draft of page) {
          const formNo = (indexById.get(draft.id) ?? 0) + 1;
          const sorted = draft.entertainItems.slice().sort((a: any, b: any) => (a.periodeMonth || "").localeCompare(b.periodeMonth || ""));
          for (const ent of sorted) {
            writeRow(entertainSheet, entertainCols, {
              formNo,
              nipMr: draft.owner.nip,
              namaMr: draft.owner.name,
              kodePI: draft.kodePI,
              namaOutlet: draft.namaOutlet || draft.kodePI,
              periodeKuartal: draft.period,
              periodeMonth: ent.periodeMonth,
              biayaEntertain: parseFloat(ent.biayaEntertain.toString()) || 0,
            });
          }
        }
      }
      entertainSheet.commit();
    }

    await wb.commit();
  })().catch((err) => {
    console.error("[sc/export] streaming failed:", err);
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  const filename = targetPeriod
    ? `POA_SC_${targetPeriod}_Export.xlsx`
    : `POA_SC_Semua_Produk_Periode_Export.xlsx`;

  return new NextResponse(Readable.toWeb(pass) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
