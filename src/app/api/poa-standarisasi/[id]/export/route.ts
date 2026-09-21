/**
 * GET /api/poa-standarisasi/[id]/export
 *
 * Single POA Standarisasi pengajuan as one flat Excel sheet — one row per
 * dokter per produk (2026-09-09 user request, deliberately no separate
 * summary sheet: "satu sheet aja gaperlu summary"). Per produk, uses the
 * FINAL dokter list (`dokterUser`, filled at Finalisasi) when it has rows,
 * falling back to the Planning estimate list (`dokterApproval`) when the
 * pengajuan hasn't reached Finalisasi yet — a "Sumber Data" column marks
 * which one a row came from so a reader isn't misled into thinking every
 * row is final. Values are whatever's currently saved in the DB (no live
 * Exodus re-fetch here) — a plain snapshot of what the pengajuan looks like
 * right now, same spirit as the single-POA Estimasi export.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canViewPoaStandarisasi, getPoaStandarisasiApprovers } from "@/lib/authz";
import { PHASES } from "@/lib/poaStandarisasiPhases";

const STATUS_PENGAJUAN_LABELS: Record<string, string> = { BARU: "Baru", PERPANJANGAN: "Perpanjangan" };
const SKEMA_LABELS: Record<string, string> = { DISKON: "Diskon", DP: "DP" };

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [pengajuan, actor] = await Promise.all([
    prisma.poaStandarisasi.findUnique({
      where: { id },
      include: {
        outlet: { select: { namaOutlet: true } },
        owner: { select: { name: true } },
        produk: {
          include: {
            product: { select: { kodeProduk: true, namaProduk: true } },
            dokterApproval: { include: { customer: { select: { namaCustomer: true } } } },
            dokterUser: { include: { customer: { select: { namaCustomer: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!pengajuan) return NextResponse.json({ error: "Pengajuan not found" }, { status: 404 });
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("POA Standarisasi");
  const PCT_FMT = "0.00%";
  const RP_FMT = "#,##0";

  sheet.columns = [
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "Nama ASM", key: "namaAsm", width: 24 },
    { header: "Nama SM", key: "namaSm", width: 24 },
    { header: "Nama NSM", key: "namaNsm", width: 24 },
    { header: "Outlet", key: "outlet", width: 28 },
    { header: "Tipe Standarisasi", key: "tipe", width: 14 },
    { header: "Tahap", key: "tahap", width: 16 },
    { header: "Distributor", key: "distributors", width: 16 },
    { header: "Item Kode - Nama Produk", key: "produk", width: 32 },
    { header: "Status Pengajuan Produk", key: "statusProduk", width: 16 },
    { header: "Skema Pembayaran", key: "skema", width: 14 },
    { header: "Diskon PI", key: "diskonPi", width: 12 },
    { header: "Diskon Distributor", key: "diskonDist", width: 14 },
    { header: "Value DP", key: "valueDp", width: 16 },
    { header: "Biaya Listing", key: "biayaListing", width: 16 },
    { header: "Nama Dokter", key: "namaDokter", width: 26 },
    { header: "Sumber Data Dokter", key: "sumberData", width: 16 },
    { header: "Jumlah Hari Praktek / Bulan", key: "hariPraktek", width: 14 },
    { header: "Jumlah Pasien / Hari", key: "jumlahPasien", width: 14 },
    { header: "Resep / Pasien", key: "resepPerPasien", width: 12 },
    { header: "Estimasi Qty / Bulan (SJ)", key: "estimasiQty", width: 14 },
    { header: "Estimasi Sales (Rp) / Bulan", key: "estimasiSales", width: 16 },
    { header: "Entertain (Rp)", key: "entertainRp", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  const { asmNip, smNip, nsmNip } = await getPoaStandarisasiApprovers(pengajuan.ownerId, pengajuan.kodePI);
  const approverUsers = await prisma.user.findMany({
    where: { nip: { in: [asmNip, smNip, nsmNip].filter((n): n is string => !!n) } },
    select: { nip: true, name: true },
  });
  const approverNameByNip = new Map(approverUsers.map((u: (typeof approverUsers)[number]) => [u.nip, u.name]));
  const namaMr = pengajuan.owner.name;
  const namaAsm = asmNip ? approverNameByNip.get(asmNip) ?? "-" : "-";
  const namaSm = smNip ? approverNameByNip.get(smNip) ?? "-" : "-";
  const namaNsm = nsmNip ? approverNameByNip.get(nsmNip) ?? "-" : "-";

  const outletLabel = pengajuan.outlet.namaOutlet;
  const tipeLabel = pengajuan.tipeStandarisasi === "PERIODIC" ? "Periodic" : pengajuan.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic";
  const tahapLabel = pengajuan.submittedAt ? "Sudah Disubmit" : phaseLabel(pengajuan.currentPhase);
  const distributorsLabel = pengajuan.distributors.join(", ") || "-";

  for (const prod of pengajuan.produk) {
    const produkLabel = `${prod.product.kodeProduk} - ${prod.product.namaProduk}`;
    const skema = prod.skemaPembayaran;
    const diskonPi = pct(prod.finalDiscountPct) ?? pct(prod.estimasiDiskonPct);
    const diskonDist = pct(prod.diskonDistributorPct) ?? pct(prod.estimasiDiskonDistributorPct);
    const valueDp = num(prod.finalValueDpRp) ?? num(prod.estimasiValueDpRp);
    const biayaListing = num(prod.finalBiayaListingRp) ?? num(prod.estimasiBiayaListingRp);

    // Final dokter list (Finalisasi) wins once it has rows — falls back to the
    // Planning estimate list only when Finalisasi hasn't been filled yet.
    const useFinal = prod.dokterUser.length > 0;
    const dokterRows = useFinal
      ? prod.dokterUser.map((d: (typeof prod.dokterUser)[number]) => ({
          nama: d.customer.namaCustomer,
          hariPraktek: d.jumlahHariPraktekPerBulan,
          jumlahPasien: d.jumlahPasien,
          resep: num(d.resepPerPasienSt),
          qty: d.estimasiQtyUbPerBulan,
          sales: num(d.estimasiSalesRpPerBulan),
          entertain: num(d.entertainRp),
        }))
      : prod.dokterApproval.map((d: (typeof prod.dokterApproval)[number]) => ({
          nama: d.customer.namaCustomer,
          hariPraktek: d.jumlahHariPraktekPerBulan,
          jumlahPasien: d.jumlahPasien,
          resep: num(d.resepPerPasienSt),
          qty: d.estimasiQtyUbPerBulan,
          sales: num(d.estimasiNilaiRpPerBulan),
          entertain: num(d.entertainRp),
        }));
    const sumberData = useFinal ? "Final (Finalisasi)" : "Estimasi (Planning)";

    if (dokterRows.length === 0) {
      sheet.addRow({
        namaMr, namaAsm, namaSm, namaNsm,
        outlet: outletLabel, tipe: tipeLabel, tahap: tahapLabel, distributors: distributorsLabel,
        produk: produkLabel, statusProduk: STATUS_PENGAJUAN_LABELS[prod.statusPengajuan] ?? prod.statusPengajuan,
        skema: SKEMA_LABELS[skema] ?? skema, diskonPi: skema === "DISKON" ? diskonPi : null,
        diskonDist: skema === "DISKON" ? diskonDist : null, valueDp: skema === "DP" ? valueDp : null,
        biayaListing, namaDokter: "-", sumberData: "-",
      });
      continue;
    }

    for (const d of dokterRows) {
      const row = sheet.addRow({
        namaMr,
        namaAsm,
        namaSm,
        namaNsm,
        outlet: outletLabel,
        tipe: tipeLabel,
        tahap: tahapLabel,
        distributors: distributorsLabel,
        produk: produkLabel,
        statusProduk: STATUS_PENGAJUAN_LABELS[prod.statusPengajuan] ?? prod.statusPengajuan,
        skema: SKEMA_LABELS[skema] ?? skema,
        diskonPi: skema === "DISKON" ? diskonPi : null,
        diskonDist: skema === "DISKON" ? diskonDist : null,
        valueDp: skema === "DP" ? valueDp : null,
        biayaListing,
        namaDokter: d.nama,
        sumberData,
        hariPraktek: d.hariPraktek,
        jumlahPasien: d.jumlahPasien,
        resepPerPasien: d.resep,
        estimasiQty: d.qty,
        estimasiSales: d.sales,
        entertainRp: d.entertain,
      });
      row.getCell("diskonPi").numFmt = PCT_FMT;
      row.getCell("diskonDist").numFmt = PCT_FMT;
      for (const key of ["valueDp", "biayaListing", "estimasiSales", "entertainRp"]) row.getCell(key).numFmt = RP_FMT;
    }
  }

  if (pengajuan.produk.length === 0) sheet.addRow(["(Belum ada produk)"]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_Standarisasi_${pengajuan.kodePI}_${pengajuan.id.slice(0, 8)}.xlsx"`,
    },
  });
}
