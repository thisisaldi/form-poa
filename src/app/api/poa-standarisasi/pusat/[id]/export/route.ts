/**
 * GET /api/poa-standarisasi/pusat/[id]/export
 *
 * POA Standarisasi Pusat (HKA) sebagai satu sheet datar — satu baris per dokter per produk, kolom
 * sama dengan export cabang (`/api/poa-standarisasi/[id]/export`) kecuali kolom MR/ASM/SM/NSM dan
 * Outlet diganti Pembuat dan Grup RS (pusat tidak punya rantai nipAtasan maupun satu outlet).
 * Nilai = snapshot DB saat ini. docs/poa-standarisasi-pusat/04-layout-parity.md.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { censorName } from "@/lib/censorName";
import { canViewPusat } from "@/lib/hka";

const STATUS_LABELS: Record<string, string> = { BARU: "Baru", PERPANJANGAN: "Perpanjangan" };
const SKEMA_LABELS: Record<string, string> = { DISKON: "Diskon", DP: "DP" };
const FASE_LABELS: Record<string, string> = { APPROVAL_ATASAN: "Approval Atasan", APPROVAL_USER_DOKTER: "Approval User/Dokter", FINALISASI: "Finalisasi" };

function num(v: { toString(): string } | null | undefined): number | null {
  return v == null ? null : parseFloat(v.toString());
}
// numFmt "0.00%" menampilkan nilai × 100; diskon disimpan sebagai angka persen (10 = 10%).
function pct(v: { toString(): string } | null | undefined): number | null {
  const n = num(v);
  return n == null ? null : n / 100;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [pengajuan, actor] = await Promise.all([
    prisma.poaStandarisasiPusat.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        kpdmList: true,
        produk: {
          include: {
            product: { select: { kodeProduk: true, namaProduk: true } },
            dokter: { include: { customer: { select: { kodeCustomer: true, namaCustomer: true } } } },
            dokterUser: { include: { customer: { select: { kodeCustomer: true, namaCustomer: true } } } },
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);
  if (!pengajuan) return NextResponse.json({ error: "Pengajuan not found" }, { status: 404 });
  if (!canViewPusat(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("POA Standarisasi Pusat");
  const PCT_FMT = "0.00%";
  const RP_FMT = "#,##0";
  sheet.columns = [
    { header: "Pembuat", key: "pembuat", width: 24 },
    { header: "Grup RS", key: "grup", width: 22 },
    { header: "KPDM", key: "kpdm", width: 30 },
    { header: "Tipe Standarisasi", key: "tipe", width: 14 },
    { header: "Target Finalisasi", key: "timeline", width: 16 },
    { header: "Tahap", key: "tahap", width: 20 },
    { header: "Item Kode - Nama Produk", key: "produk", width: 32 },
    { header: "Status Pengajuan Produk", key: "statusProduk", width: 16 },
    { header: "Skema Pembayaran", key: "skema", width: 14 },
    { header: "Diskon PI", key: "diskonPi", width: 12 },
    { header: "Diskon Distributor", key: "diskonDist", width: 14 },
    { header: "Value DP", key: "valueDp", width: 16 },
    { header: "Biaya Listing", key: "biayaListing", width: 16 },
    { header: "Kode Dokter", key: "kodeDokter", width: 14 },
    { header: "Nama Dokter", key: "namaDokter", width: 26 },
    { header: "Sumber Data Dokter", key: "sumberData", width: 18 },
    { header: "Jumlah Hari Praktek / Bulan", key: "hariPraktek", width: 14 },
    { header: "Jumlah Pasien / Hari", key: "jumlahPasien", width: 14 },
    { header: "Resep / Pasien", key: "resepPerPasien", width: 12 },
    { header: "Estimasi Qty / Bulan (SJ)", key: "estimasiQty", width: 14 },
    { header: "Estimasi Sales (Rp) / Bulan", key: "estimasiSales", width: 16 },
    { header: "Entertain (Rp)", key: "entertainRp", width: 14 },
    { header: "Sudah TTD", key: "sudahTtd", width: 10 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  const tipe = pengajuan.tipeStandarisasi === "PERIODIC" ? "Periodic" : pengajuan.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic";
  const base = {
    pembuat: pengajuan.owner.name,
    grup: pengajuan.hkaGroup,
    kpdm: pengajuan.kpdmList.map((k: (typeof pengajuan.kpdmList)[number]) => k.namaSnapshot).join(", ") || "-",
    tipe,
    timeline: pengajuan.estimasiTimelineSelesai ? pengajuan.estimasiTimelineSelesai.toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "-",
    tahap: pengajuan.submittedAt ? "Sudah Disubmit" : FASE_LABELS[pengajuan.currentPhase] ?? pengajuan.currentPhase,
  };

  for (const prod of pengajuan.produk) {
    const skema = prod.skemaPembayaran;
    // Nilai final (Finalisasi) menang bila sudah ada; kalau belum, nilai Planning.
    const prodCols = {
      ...base,
      produk: `${prod.product.kodeProduk} - ${prod.product.namaProduk}`,
      statusProduk: STATUS_LABELS[prod.statusPengajuan] ?? prod.statusPengajuan,
      skema: SKEMA_LABELS[skema] ?? skema,
      diskonPi: skema === "DISKON" ? pct(prod.finalDiscountPct) ?? pct(prod.estimasiDiskonPct) : null,
      diskonDist: skema === "DISKON" ? pct(prod.diskonDistributorPct) ?? pct(prod.estimasiDiskonDistributorPct) : null,
      valueDp: skema === "DP" ? num(prod.finalValueDpRp) ?? num(prod.estimasiValueDpRp) : null,
      biayaListing: num(prod.finalBiayaListingRp) ?? num(prod.estimasiBiayaListingRp),
    };
    // Daftar dokter final (Finalisasi) menang begitu punya baris; kalau belum, daftar Planning.
    const useFinal = prod.dokterUser.length > 0;
    const ttdByCustomer = new Map<string, boolean>(prod.dokter.map((d: (typeof prod.dokter)[number]) => [d.customerId, d.sudahTtd]));
    const dokterRows = useFinal
      ? prod.dokterUser.map((d: (typeof prod.dokterUser)[number]) => ({
          customerId: d.customerId, kode: d.customer.kodeCustomer ?? "-", nama: censorName(d.customer.namaCustomer), hari: d.jumlahHariPraktekPerBulan, pasien: d.jumlahPasien,
          resep: num(d.resepPerPasienSt), qty: d.estimasiQtyUbPerBulan, sales: num(d.estimasiSalesRpPerBulan), entertain: num(d.entertainRp),
        }))
      : prod.dokter.map((d: (typeof prod.dokter)[number]) => ({
          customerId: d.customerId, kode: d.customer.kodeCustomer ?? "-", nama: censorName(d.customer.namaCustomer), hari: d.jumlahHariPraktekPerBulan, pasien: d.jumlahPasien,
          resep: num(d.resepPerPasienSt), qty: d.estimasiQtyUbPerBulan, sales: num(d.estimasiNilaiRpPerBulan), entertain: num(d.entertainRp),
        }));
    const sumberData = useFinal ? "Final (Finalisasi)" : "Estimasi (Planning)";
    if (dokterRows.length === 0) {
      sheet.addRow({ ...prodCols, kodeDokter: "-", namaDokter: "-", sumberData: "-" });
      continue;
    }
    for (const d of dokterRows) {
      const row = sheet.addRow({
        ...prodCols,
        kodeDokter: d.kode, namaDokter: d.nama,
        sumberData,
        hariPraktek: d.hari,
        jumlahPasien: d.pasien,
        resepPerPasien: d.resep,
        estimasiQty: d.qty,
        estimasiSales: d.sales,
        entertainRp: d.entertain,
        sudahTtd: ttdByCustomer.get(d.customerId) ? "Ya" : "Belum",
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
      "Content-Disposition": `attachment; filename="POA_Standarisasi_Pusat_${pengajuan.hkaGroup.replace(/[^A-Za-z0-9]+/g, "_")}_${pengajuan.id.slice(0, 8)}.xlsx"`,
    },
  });
}
