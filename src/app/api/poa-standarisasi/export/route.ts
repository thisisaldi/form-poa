/**
 * GET /api/poa-standarisasi/export
 *
 * Exports the "Pengajuan Saya" list page as one sheet, "Detail Produk &
 * Dokter" — one row per Produk × Dokter combination across every pengajuan
 * owned by the user (2026-09-09 redline "Export Excel — Sheet Baru 'Detail
 * Produk & Dokter'"; the separate "Ringkasan" sheet this started with was
 * dropped same day per user request — this sheet alone is enough).
 *
 * Diverged from the redline mockup in two places where our actual data
 * model disagrees with its illustrative guess (mockup explicitly invited
 * correction on both):
 * - Kode Outlet / Kode Produk are real values (kodePI / product.kodeProduk),
 *   not placeholder-format guesses.
 * - "DP" is Rupiah in this system (estimasiValueDpRp/finalValueDpRp), not a
 *   percentage — column is "DP (Rp)".
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { PHASES } from "@/lib/poaStandarisasiPhases";

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.id === phase)?.label ?? phase;
}

function num(v: { toString(): string } | null | undefined): number | null {
  return v == null ? null : parseFloat(v.toString());
}

// numFmt "0.00%" multiplies the cell value by 100 to display it (it expects a
// fraction, 0.10 for "10%") — diskonPct is stored as a plain percent number
// (10 = 10%), so it needs dividing by 100 before being written as a percent cell.
function pct(v: { toString(): string } | null | undefined): number | null {
  const n = num(v);
  return n == null ? null : n / 100;
}

export async function GET(_req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.poaStandarisasi.findMany({
    where: { ownerId: session.userId },
    include: {
      outlet: { select: { namaOutlet: true } },
      produk: {
        include: {
          product: { select: { kodeProduk: true, namaProduk: true } },
          dokterApproval: { select: { customerId: true, sudahTtd: true, customer: { select: { namaCustomer: true } } } },
          dokterUser: { include: { customer: { select: { namaCustomer: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const wb = new ExcelJS.Workbook();

  const detail = wb.addWorksheet("Detail Produk & Dokter");
  const PCT_FMT = "0.00%";
  const RP_FMT = "#,##0";
  detail.columns = [
    { header: "Kode Outlet", key: "kodeOutlet", width: 12 },
    { header: "Outlet", key: "outlet", width: 26 },
    { header: "Tipe", key: "tipe", width: 12 },
    { header: "Tahap", key: "tahap", width: 16 },
    { header: "Kode Produk", key: "kodeProduk", width: 12 },
    { header: "Nama Produk", key: "namaProduk", width: 28 },
    { header: "Distributor", key: "distributor", width: 20 },
    { header: "Diskon PI (%)", key: "diskonPi", width: 12 },
    { header: "Diskon Dist. (%)", key: "diskonDist", width: 14 },
    { header: "DP (Rp)", key: "dpRp", width: 14 },
    { header: "Est. Qty/bln", key: "estimasiQty", width: 12 },
    { header: "Est. Sales/bln", key: "estimasiSales", width: 16 },
    { header: "Nama Dokter", key: "namaDokter", width: 26 },
    { header: "Dokter Approved", key: "dokterApproved", width: 14 },
    { header: "Target Penyelesaian", key: "target", width: 16 },
    { header: "Tanggal KFT", key: "tanggalKft", width: 14 },
  ];
  detail.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  detail.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };
  detail.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  for (const p of rows) {
    const shared = {
      kodeOutlet: p.kodePI,
      outlet: p.outlet.namaOutlet,
      tipe: p.tipeStandarisasi === "PERIODIC" ? "Periodic" : p.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic",
      tahap: p.submittedAt ? "Sudah Disubmit" : phaseLabel(p.currentPhase),
      distributor: p.distributors.join(", ") || "-",
      target: p.estimasiTimelineSelesai ? p.estimasiTimelineSelesai.toLocaleDateString("id-ID") : "-",
      tanggalKft: p.jadwalMeetingKft ? p.jadwalMeetingKft.toLocaleDateString("id-ID") : "-",
    };

    for (const prod of p.produk) {
      const skema = prod.skemaPembayaran;
      const diskonPi = pct(prod.finalDiscountPct) ?? pct(prod.estimasiDiskonPct);
      const diskonDist = pct(prod.diskonDistributorPct) ?? pct(prod.estimasiDiskonDistributorPct);
      const dpRp = num(prod.finalValueDpRp) ?? num(prod.estimasiValueDpRp);
      const sudahTtdByCustomerId = new Map(prod.dokterApproval.map((d: (typeof prod.dokterApproval)[number]) => [d.customerId, d.sudahTtd]));

      const useFinal = prod.dokterUser.length > 0;
      const dokterRows = useFinal
        ? prod.dokterUser.map((d: (typeof prod.dokterUser)[number]) => ({
            nama: d.customer.namaCustomer,
            approved: sudahTtdByCustomerId.get(d.customerId) ?? null,
            qty: num(d.estimasiQtyPerBulan),
            sales: num(d.estimasiSalesRpPerBulan),
          }))
        : prod.dokterApproval.map((d: (typeof prod.dokterApproval)[number]) => ({
            nama: d.customer.namaCustomer,
            approved: d.sudahTtd,
            qty: null as number | null,
            sales: null as number | null,
          }));

      const produkShared = {
        ...shared,
        kodeProduk: prod.product.kodeProduk,
        namaProduk: prod.product.namaProduk,
        diskonPi: skema === "DISKON" ? diskonPi : null,
        diskonDist: skema === "DISKON" ? diskonDist : null,
        dpRp: skema === "DP" ? dpRp : null,
      };

      if (dokterRows.length === 0) {
        detail.addRow({ ...produkShared, estimasiQty: null, estimasiSales: null, namaDokter: "-", dokterApproved: "-" });
        continue;
      }

      for (const d of dokterRows) {
        const row = detail.addRow({
          ...produkShared,
          estimasiQty: d.qty,
          estimasiSales: d.sales,
          namaDokter: d.nama,
          dokterApproved: d.approved == null ? "-" : d.approved ? "Ya" : "Tidak",
        });
        row.getCell("diskonPi").numFmt = PCT_FMT;
        row.getCell("diskonDist").numFmt = PCT_FMT;
        row.getCell("dpRp").numFmt = RP_FMT;
        row.getCell("estimasiSales").numFmt = RP_FMT;
      }
    }
  }
  if (rows.every((p: (typeof rows)[number]) => p.produk.length === 0)) detail.addRow(["(Belum ada produk)"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_Standarisasi_Pengajuan_Saya_${session.userId}.xlsx"`,
    },
  });
}
