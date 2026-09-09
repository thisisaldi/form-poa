/**
 * GET /api/poa-standarisasi/export
 *
 * Exports the "Pengajuan Saya" list page as-is — one row per pengajuan,
 * same columns shown in the table (2026-09-09 redline, item #5). No filter
 * UI exists on that page yet, so "data yang sedang tampil" == every
 * pengajuan owned by the current user, same scope as listMyPoaStandarisasiAction.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { PHASES } from "@/lib/poaStandarisasiPhases";

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.id === phase)?.label ?? phase;
}

export async function GET(_req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.poaStandarisasi.findMany({
    where: { ownerId: session.userId },
    include: {
      outlet: { select: { namaOutlet: true } },
      produk: { select: { standarisasiGagal: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Pengajuan Saya");
  sheet.columns = [
    { header: "Outlet", key: "outlet", width: 28 },
    { header: "Tipe", key: "tipe", width: 14 },
    { header: "Tahap", key: "tahap", width: 18 },
    { header: "Jumlah Produk", key: "jumlahProduk", width: 14 },
    { header: "Produk Berhasil Standarisasi", key: "berhasil", width: 16 },
    { header: "Produk Gagal Standarisasi", key: "gagal", width: 16 },
    { header: "Target Penyelesaian", key: "target", width: 16 },
    { header: "Tanggal KFT", key: "tanggalKft", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  for (const p of rows) {
    const jumlahGagal = p.produk.filter((prod: (typeof p.produk)[number]) => prod.standarisasiGagal).length;
    sheet.addRow({
      outlet: p.outlet.namaOutlet,
      tipe: p.tipeStandarisasi === "PERIODIC" ? "Periodic" : p.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic",
      tahap: p.submittedAt ? "Sudah Disubmit" : phaseLabel(p.currentPhase),
      jumlahProduk: p.produk.length,
      berhasil: p.submittedAt ? p.produk.length - jumlahGagal : "-",
      gagal: p.submittedAt ? jumlahGagal : "-",
      target: p.estimasiTimelineSelesai ? p.estimasiTimelineSelesai.toLocaleDateString("id-ID") : "-",
      tanggalKft: p.jadwalMeetingKft ? p.jadwalMeetingKft.toLocaleDateString("id-ID") : "-",
    });
  }
  if (rows.length === 0) sheet.addRow(["(Belum ada pengajuan)"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_Standarisasi_Pengajuan_Saya_${session.userId}.xlsx"`,
    },
  });
}
