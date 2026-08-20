/**
 * GET /api/sc/[id]/export
 *
 * Returns a single-POA Sales Counter (SC) Excel workbook using ExcelJS.
 * Export uses ACTUAL raw numbers (no /1,000,000 denominator division).
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { quarterToMonths, quarterLabelFromMonths } from "@/lib/quarterUtils";

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
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [drafts, actor] = await Promise.all([
    prisma.poaScForm.findMany({
      where: { ownerId: session.userId, period: id },
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
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (drafts.length === 0) {
    return NextResponse.json({ error: "No SC POA drafts found for this period" }, { status: 404 });
  }

  const first = drafts[0];
  const owner = first.owner;

  // Authorization check
  const hasAccess = owner.nip === session.userId || (["ASM", "SM", "NSM", "ADMIN", "GM", "SFE", "VIEWER"] as string[]).includes(session.role);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const quarterMonths = /^\d{4}-Q[1-4]$/.test(id) ? quarterToMonths(id) : [];
  const qLabel = quarterLabelFromMonths(quarterMonths);

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

  // Calculate totals and metrics (in ACTUAL Rupiah numbers)
  let totalEstimasiSales = 0;
  let totalNilaiSc = 0;
  let totalDiskon = 0;
  let totalCashback = 0;
  let totalEntertain = 0;

  let tercacahEstimasiSales = 0;
  let tercacahNilaiSc = 0;

  const monthlyMap = new Map<string, { estimasiSales: number; nilaiSc: number }>();
  for (const m of quarterMonths) {
    monthlyMap.set(m, { estimasiSales: 0, nilaiSc: 0 });
  }

  const distinctOutlets = new Set<string>();
  const distinctPersons = new Set<string>();
  const distinctProducts = new Set<string>();
  let totalProductRows = 0;

  for (const draft of drafts) {
    distinctOutlets.add(draft.kodePI);
    const lama = draft.lamaPeriode || 3;
    const days = draft.hariKerjaBulan || 0;

    // Overlap count for tercacah
    const startYear = parseInt(draft.periodeAwal.slice(0, 4), 10);
    const startMonth = parseInt(draft.periodeAwal.slice(4, 6), 10);
    let overlapCount = 0;
    for (let i = 0; i < lama; i++) {
      const d = new Date(startYear, startMonth - 1 + i, 1);
      const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (quarterMonths.includes(yyyymm)) overlapCount++;
    }

    for (const p of draft.persons) {
      distinctPersons.add(p.nik_ktp);
    }

    for (const p of draft.products) {
      if (!p.kodeProduk) continue;
      distinctProducts.add(p.kodeProduk);
      totalProductRows++;

      const mp = masterMap.get(p.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const pembeli = p.pembeliHari || 0;
      const qty = p.qtyCustomerBaru || 0;

      const estSalesPerMonth = pembeli * qty * days * hnaST;
      const estSalesFull = estSalesPerMonth * lama;

      const pctMatriks = parseFloat(p.persenMatriksSc.toString()) || 0;
      const nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
      const nilaiScFull = nilaiScPerMonth * lama;

      const diskonFull = estSalesFull * ((parseFloat(p.persenDiskon.toString()) || 0) / 100);
      const cashbackFull = estSalesFull * ((parseFloat(p.persenCashback.toString()) || 0) / 100);

      totalEstimasiSales += estSalesFull;
      totalNilaiSc += nilaiScFull;
      totalDiskon += diskonFull;
      totalCashback += cashbackFull;

      if (lama > 0 && overlapCount > 0) {
        tercacahEstimasiSales += (estSalesFull / lama) * overlapCount;
        tercacahNilaiSc += (nilaiScFull / lama) * overlapCount;
      }

      for (let i = 0; i < lama; i++) {
        const d = new Date(startYear, startMonth - 1 + i, 1);
        const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (monthlyMap.has(yyyymm)) {
          const cur = monthlyMap.get(yyyymm)!;
          monthlyMap.set(yyyymm, {
            estimasiSales: cur.estimasiSales + estSalesPerMonth,
            nilaiSc: cur.nilaiSc + nilaiScPerMonth,
          });
        }
      }
    }

    const draftEntertain = draft.entertainItems.reduce(
      (s: number, e: any) => s + (parseFloat(e.biayaEntertain.toString()) || 0),
      0
    );
    totalEntertain += draftEntertain;
  }

  const totalBudgetSc = totalNilaiSc + totalDiskon + totalCashback + totalEntertain;

  // Build ExcelJS Workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "POA Sales Counter System";
  wb.created = new Date();

  const BLUE = "FF0063A0";
  const LBLUE = "FFD6E8F5";
  const WHITE = "FFFFFFFF";
  const LGRAY = "FFF5F5F5";
  const RP_FMT = "#,##0";
  const PCT_FMT = "0.0%";

  // ─── Sheet 1: Summary SC ──────────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary SC");
  summary.columns = [
    { key: "label", width: 34 },
    { key: "value", width: 28 },
  ];

  function addSectionHeader(ws: ExcelJS.Worksheet, title: string) {
    const row = ws.addRow([title, ""]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    row.getCell(1).alignment = { vertical: "middle" };
    row.height = 18;
  }

  function addDataRow(ws: ExcelJS.Worksheet, label: string, value: string | number, shade = false, isNum = false) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: false };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: shade ? LGRAY : WHITE } };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: shade ? LGRAY : WHITE } };
    row.getCell(2).alignment = { horizontal: "right" };
    if (isNum && typeof value === "number") {
      row.getCell(2).numFmt = RP_FMT;
    }
  }

  addSectionHeader(summary, "Informasi POA Sales Counter");
  addDataRow(summary, "Nama MR", owner.name);
  addDataRow(summary, "NIP MR", owner.nip, true);
  addDataRow(summary, "Periode", id);
  addDataRow(summary, "Status", first.status.replace(/_/g, " "), true);
  addDataRow(summary, "Dibuat", first.createdAt.toLocaleDateString("id-ID"));
  addDataRow(summary, "Terakhir diperbarui", first.updatedAt.toLocaleDateString("id-ID"), true);

  summary.addRow([]);

  addSectionHeader(summary, "Estimasi Sales & Nilai SC");
  addDataRow(summary, "Total Estimasi Sales SC (Full Periode)", Math.round(totalEstimasiSales), false, true);
  addDataRow(summary, `Estimasi Sales SC (Tercacah Q${qLabel})`, Math.round(tercacahEstimasiSales), true, true);
  addDataRow(summary, "Total Nilai SC / Insentif (Full Periode)", Math.round(totalNilaiSc), false, true);
  addDataRow(summary, `Nilai SC / Insentif (Tercacah Q${qLabel})`, Math.round(tercacahNilaiSc), true, true);

  summary.addRow([]);

  addSectionHeader(summary, "Anggaran SC (Rencana Biaya)");
  addDataRow(summary, "Insentif SC (Biaya Matriks)", Math.round(totalNilaiSc), false, true);
  addDataRow(summary, "Diskon SC", Math.round(totalDiskon), true, true);
  addDataRow(summary, "Cashback SC", Math.round(totalCashback), false, true);
  addDataRow(summary, "Entertain SC", Math.round(totalEntertain), true, true);
  addDataRow(summary, "Total Rencana Biaya SC", Math.round(totalBudgetSc), false, true);

  summary.addRow([]);

  addSectionHeader(summary, "Cakupan Sales Counter");
  addDataRow(summary, "Jumlah Outlet SC", distinctOutlets.size);
  addDataRow(summary, "Jumlah Personil Sales Counter", distinctPersons.size, true);
  addDataRow(summary, "Variasi Produk SC", distinctProducts.size);
  addDataRow(summary, "Total Pengajuan Produk (baris)", totalProductRows, true);

  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LBLUE } };

  // ─── Sheet 2: Estimasi SC per Bulan ──────────────────────────────────────
  const monthlySorted = [...monthlyMap.keys()].sort();
  const wsMonthly = wb.addWorksheet("Estimasi SC per Bulan");
  wsMonthly.columns = [
    { header: "Bulan", key: "monthLabel", width: 18 },
    { header: "Estimasi Sales SC (Rp)", key: "estimasiSales", width: 22 },
    { header: "Nilai SC / Insentif (Rp)", key: "nilaiSc", width: 22 },
  ];
  wsMonthly.getRow(1).font = { bold: true, color: { argb: WHITE } };
  wsMonthly.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };

  for (const m of monthlySorted) {
    const v = monthlyMap.get(m)!;
    const year = m.slice(0, 4);
    const monthIdx = parseInt(m.slice(4, 6), 10) - 1;
    const label = new Date(parseInt(year), monthIdx).toLocaleString("id-ID", { month: "long", year: "numeric" });

    wsMonthly.addRow({
      monthLabel: `${m} · ${label}`,
      estimasiSales: Math.round(v.estimasiSales),
      nilaiSc: Math.round(v.nilaiSc),
    });
  }

  wsMonthly.addRow({
    monthLabel: "Total",
    estimasiSales: Math.round(totalEstimasiSales / (first.lamaPeriode || 3) * quarterMonths.length),
    nilaiSc: Math.round(totalNilaiSc / (first.lamaPeriode || 3) * quarterMonths.length),
  });
  const lastRowIndex = wsMonthly.rowCount;
  wsMonthly.getRow(lastRowIndex).font = { bold: true };

  wsMonthly.getColumn("estimasiSales").numFmt = RP_FMT;
  wsMonthly.getColumn("nilaiSc").numFmt = RP_FMT;

  // ─── Sheet 3: Pengisian SC ───────────────────────────────────────────────
  const formSheet = wb.addWorksheet("Pengisian SC");
  formSheet.columns = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Hari Kerja / Bln", key: "hariKerjaBulan", width: 14 },
    { header: "Visit / Bln", key: "rencanaVisitMinggu", width: 12 },
    { header: "Survey Pasien / Hr", key: "surveyPasienHarian", width: 16 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Pembeli / Hari", key: "pembeliHari", width: 14 },
    { header: "Qty / Pembeli", key: "qtyCustomerBaru", width: 14 },
    { header: "Estimasi Sales / Bln (Rp)", key: "estSalesBulan", width: 22 },
    { header: "Estimasi Sales / Periode (Rp)", key: "estSalesPeriode", width: 24 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Nilai SC / Bln (Rp)", key: "nilaiScBulan", width: 20 },
    { header: "Nilai SC / Periode (Rp)", key: "nilaiScPeriode", width: 22 },
    { header: "% Diskon SC", key: "persenDiskon", width: 14 },
    { header: "Diskon SC / Periode (Rp)", key: "diskonPeriode", width: 22 },
    { header: "% Cashback SC", key: "persenCashback", width: 14 },
    { header: "Cashback SC / Periode (Rp)", key: "cashbackPeriode", width: 22 },
    { header: "Entertain SC / Periode (Rp)", key: "entertainPeriode", width: 22 },
    { header: "Total Rencana Biaya SC (Rp)", key: "rencanaTotalBiaya", width: 24 },
    { header: "Periode Awal", key: "periodeAwal", width: 14 },
    { header: "Lama Periode (Bulan)", key: "lamaPeriode", width: 16 },
    { header: "Status", key: "status", width: 16 },
  ];

  formSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  formSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  formSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  let formCounter = 1;
  for (const draft of drafts) {
    const days = draft.hariKerjaBulan || 0;
    const lama = draft.lamaPeriode || 3;
    const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
    const draftEntertain = draft.entertainItems.reduce((s: number, e: any) => s + (parseFloat(e.biayaEntertain.toString()) || 0), 0);

    for (const p of draft.products) {
      if (!p.kodeProduk) continue;

      const mp = masterMap.get(p.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const pembeli = p.pembeliHari || 0;
      const qty = p.qtyCustomerBaru || 0;

      const estSalesBulan = pembeli * qty * days * hnaST;
      const estSalesPeriode = estSalesBulan * lama;

      const pctMatriks = (parseFloat(p.persenMatriksSc.toString()) || 0) / 100;
      const nilaiScBulan = estSalesBulan * pctMatriks;
      const nilaiScPeriode = nilaiScBulan * lama;

      const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
      const diskonPeriode = estSalesPeriode * pctDiskon;

      const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;
      const cashbackPeriode = estSalesPeriode * pctCashback;

      const totalBiayaProduk = parseFloat(p.rencanaTotalBiaya.toString()) || (nilaiScPeriode + diskonPeriode + cashbackPeriode);

      formSheet.addRow({
        formNo: formCounter,
        nipMr: owner.nip,
        namaMr: owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        hariKerjaBulan: days,
        rencanaVisitMinggu: draft.rencanaVisitMinggu || 0,
        surveyPasienHarian: draft.surveyPasienHarian || 0,
        scPersonNames: scPersonStr,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        produkKompetitor: p.produkKompetitor || "-",
        pembeliHari: pembeli,
        qtyCustomerBaru: qty,
        estSalesBulan: Math.round(estSalesBulan),
        estSalesPeriode: Math.round(estSalesPeriode),
        persenMatriksSc: pctMatriks,
        nilaiScBulan: Math.round(nilaiScBulan),
        nilaiScPeriode: Math.round(nilaiScPeriode),
        persenDiskon: pctDiskon,
        diskonPeriode: Math.round(diskonPeriode),
        persenCashback: pctCashback,
        cashbackPeriode: Math.round(cashbackPeriode),
        entertainPeriode: Math.round(draftEntertain),
        rencanaTotalBiaya: Math.round(totalBiayaProduk + draftEntertain),
        periodeAwal: draft.periodeAwal,
        lamaPeriode: lama,
        status: draft.status.replace(/_/g, " "),
      });
    }
    formCounter++;
  }

  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    formSheet.getColumn(k).numFmt = PCT_FMT;
  });

  [
    "estSalesBulan",
    "estSalesPeriode",
    "nilaiScBulan",
    "nilaiScPeriode",
    "diskonPeriode",
    "cashbackPeriode",
    "entertainPeriode",
    "rencanaTotalBiaya",
  ].forEach((k) => {
    formSheet.getColumn(k).numFmt = RP_FMT;
  });

  // ─── Sheet 4: Audit Log SC ───────────────────────────────────────────────
  const auditSheet = wb.addWorksheet("Audit Log SC");
  auditSheet.columns = [
    { header: "Date", key: "date", width: 22 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Action", key: "action", width: 14 },
    { header: "From Status", key: "from", width: 22 },
    { header: "To Status", key: "to", width: 22 },
  ];
  auditSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  auditSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };

  const allLogs = drafts
    .flatMap((d: any) => d.auditLogs)
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const log of allLogs) {
    auditSheet.addRow({
      date: log.createdAt.toISOString(),
      actor: `${log.actor.name} (${log.actor.nip})`,
      action: log.action,
      from: log.fromStatus ?? "-",
      to: log.toStatus ?? "-",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_SC_${id}_${owner.nip}.xlsx"`,
    },
  });
}
