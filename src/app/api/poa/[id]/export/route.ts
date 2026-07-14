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

  // ─── Sheet 1: Summary ────────────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 24 },
    { header: "Value", key: "value", width: 40 },
  ];
  summary.addRows([
    { field: "POA ID", value: poa.id },
    { field: "Period", value: poa.period },
    { field: "MR Name", value: poa.owner.name },
    { field: "MR NIP", value: poa.owner.nip },
    { field: "Status", value: poa.status.replace(/_/g, " ") },
    { field: "Created", value: poa.createdAt.toISOString() },
    { field: "Last Updated", value: poa.updatedAt.toISOString() },
  ]);

  // Style header row
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0063A0" }, // brand blue
  };
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

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
