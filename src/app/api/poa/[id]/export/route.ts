/**
 * GET /api/poa/[id]/export
 *
 * Returns a single-POA Excel workbook using ExcelJS.
 * Sheet "Line Items" exports all PoaLineItem rows for the POA.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canView } from "@/lib/authz";
import { computePeriodeAkhir, formatPeriode } from "@/lib/poaUtils";
import { getAllPakets } from "@/lib/paketProduk";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: { owner: true, items: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) {
    return NextResponse.json({ error: "POA not found" }, { status: 404 });
  }

  const hasAccess = await canView(actor, poa);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (poa.status === "DRAFT") {
    return NextResponse.json({ error: "Draft POA tidak dapat diekspor. Submit terlebih dahulu." }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "POA System";
  wb.created = new Date();

  // ─── Compute stats (mirrors DraftChecklist computeStats) ─────────────────
  const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
  type RawItem = typeof poa.items[number];
  const allItems: RawItem[] = poa.items ?? [];

  let estimasiTotal = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
  let sudahStandar = 0, prosesStandar = 0;
  const doctorKeys = new Set<string>();
  const fokusProdukSet = new Set<string>();

  for (const it of allItems) {
    const base = toNum(it.rencanaTotalBiaya);
    estimasiTotal  += base;
    psspTotal      += base * (toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm));
    discountTotal  += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
    doctorKeys.add(`${it.kodePI ?? ""}|${it.namaCust}`);
    if (getAllPakets(it.namaProduk).length > 0) fokusProdukSet.add(it.kodeProduk);
    if (it.statusStandarisasi === "SUDAH_STANDARISASI") sudahStandar++;
    if (it.statusStandarisasi === "PROSES_PENGAJUAN") prosesStandar++;
  }

  const budgetTotal  = psspTotal + discountTotal + entertainTotal;
  const budgetRatio  = estimasiTotal > 0 ? (budgetTotal / estimasiTotal) * 100 : 0;
  const budgetStatus = budgetRatio > 42.5 ? "Melebihi batas (>42.5%)" : budgetRatio > 38 ? "Mendekati batas (38–42.5%)" : budgetRatio > 0 ? "Aman (<38%)" : "-";
  const formatRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

  // ─── Sheet 1: Summary ────────────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { key: "label", width: 32 },
    { key: "value", width: 28 },
  ];

  const BLUE   = "FF0063A0";
  const LBLUE  = "FFD6E8F5";
  const WHITE  = "FFFFFFFF";
  const LGRAY  = "FFF5F5F5";

  function addSectionHeader(ws: ExcelJS.Worksheet, title: string) {
    const row = ws.addRow([title, ""]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    row.getCell(1).alignment = { vertical: "middle" };
    row.height = 18;
  }

  function addDataRow(ws: ExcelJS.Worksheet, label: string, value: string | number, shade = false) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: false };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: shade ? LGRAY : WHITE } };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: shade ? LGRAY : WHITE } };
    row.getCell(2).alignment = { horizontal: "right" };
  }

  // — Info POA —
  addSectionHeader(summary, "Informasi POA");
  addDataRow(summary, "Nama MR",       poa.owner.name);
  addDataRow(summary, "NIP MR",        poa.owner.nip, true);
  addDataRow(summary, "Periode",       poa.period);
  addDataRow(summary, "Status",        poa.status.replace(/_/g, " "), true);
  addDataRow(summary, "Dibuat",        poa.createdAt.toLocaleDateString("id-ID"));
  addDataRow(summary, "Terakhir diperbarui", poa.updatedAt.toLocaleDateString("id-ID"), true);

  summary.addRow([]);

  // — Estimasi —
  addSectionHeader(summary, "Estimasi");
  addDataRow(summary, "Total Estimasi POA",      formatRp(estimasiTotal));

  summary.addRow([]);

  // — Anggaran —
  addSectionHeader(summary, "Anggaran");
  addDataRow(summary, "PSSP",                    formatRp(psspTotal));
  addDataRow(summary, "Discount + DPL + DPF",    formatRp(discountTotal), true);
  addDataRow(summary, "Entertain",               formatRp(entertainTotal));
  addDataRow(summary, "Total Budget",            formatRp(budgetTotal), true);
  addDataRow(summary, "% Budget dari Estimasi",  budgetRatio > 0 ? `${budgetRatio.toFixed(1)}%` : "-");
  addDataRow(summary, "Status Anggaran",         budgetStatus, true);

  summary.addRow([]);

  // — Cakupan —
  addSectionHeader(summary, "Cakupan");
  addDataRow(summary, "Jumlah User",             doctorKeys.size);
  addDataRow(summary, "Produk Fokus",            fokusProdukSet.size, true);
  addDataRow(summary, "Total Pengajuan (baris)", allItems.length);

  summary.addRow([]);

  // — Listing / Standarisasi —
  addSectionHeader(summary, "Listing Produk");
  addDataRow(summary, "Sudah Listing",           sudahStandar);
  addDataRow(summary, "Proses Pengajuan",        prosesStandar, true);
  addDataRow(summary, "Belum Listing",           allItems.length - sudahStandar);

  // Light blue header row placeholder (column headers not used, style top border instead)
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LBLUE } };

  // ─── Sheet 2: Line Items ─────────────────────────────────────────────────
  const formSheet = wb.addWorksheet("Line Items");
  formSheet.columns = [
    { header: "Kode Request", key: "kodeRequest", width: 14 },
    { header: "Kode Cust", key: "kodeCust", width: 12 },
    { header: "Nama Customer", key: "namaCust", width: 30 },
    { header: "Spesialisasi", key: "spesialisasi", width: 18 },
    { header: "Kode PI", key: "kodePI", width: 14 },
    { header: "Nama Outlet", key: "namaOutlet", width: 28 },
    { header: "Kode Produk", key: "kodeProduk", width: 12 },
    { header: "Nama Produk", key: "namaProduk", width: 24 },
    { header: "Status Standarisasi", key: "statusStandarisasi", width: 22 },
    { header: "Lama Periode (bln)", key: "lamaPeriode", width: 18 },
    { header: "Periode Awal", key: "periodeAwal", width: 14 },
    { header: "Periode Akhir", key: "periodeAkhir", width: 14 },
    { header: "Estimasi", key: "rencanaTotalBiaya", width: 20 },
    { header: "Rencana Visit/Minggu", key: "rencanaVisitMinggu", width: 20 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
  ];
  formSheet.getRow(1).font = { bold: true };
  formSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0063A0" },
  };
  formSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  const items = (poa as typeof poa & { items: { kodeRequest: string; kodeCust: string; namaCust: string; spesialisasi: string; kodePI: string | null; namaOutlet: string; kodeProduk: string; namaProduk: string; statusStandarisasi: string | null; lamaPeriode: number; periodeAwal: string; rencanaTotalBiaya: { toString(): string }; rencanaVisitMinggu: number; produkKompetitor: string | null }[] }).items ?? [];
  for (const item of items) {
    formSheet.addRow({
      kodeRequest: item.kodeRequest,
      kodeCust: item.kodeCust,
      namaCust: item.namaCust,
      spesialisasi: item.spesialisasi,
      kodePI: item.kodePI ?? "-",
      namaOutlet: item.namaOutlet,
      kodeProduk: item.kodeProduk,
      namaProduk: item.namaProduk,
      statusStandarisasi: item.statusStandarisasi ?? "-",
      lamaPeriode: item.lamaPeriode,
      periodeAwal: formatPeriode(item.periodeAwal),
      periodeAkhir: formatPeriode(computePeriodeAkhir(item.periodeAwal, item.lamaPeriode)),
      rencanaTotalBiaya: parseFloat(item.rencanaTotalBiaya.toString()),
      rencanaVisitMinggu: item.rencanaVisitMinggu,
      produkKompetitor: item.produkKompetitor ?? "-",
    });
  }
  if (items.length === 0) formSheet.addRow(["(Belum ada line item)"]);

  // ─── Sheet 3: Audit Log ──────────────────────────────────────────────────
  const auditSheet = wb.addWorksheet("Audit Log");
  auditSheet.columns = [
    { header: "Date", key: "date", width: 22 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Action", key: "action", width: 12 },
    { header: "From Status", key: "from", width: 22 },
    { header: "To Status", key: "to", width: 22 },
  ];
  auditSheet.getRow(1).font = { bold: true };

  const logs = await prisma.poaAuditLog.findMany({
    where: { poaId: id },
    include: { actor: true },
    orderBy: { createdAt: "asc" },
  });

  for (const log of logs) {
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
      "Content-Disposition": `attachment; filename="POA_${poa.period}_${poa.owner.nip}.xlsx"`,
    },
  });
}
