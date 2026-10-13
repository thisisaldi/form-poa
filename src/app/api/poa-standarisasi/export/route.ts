/**
 * GET /api/poa-standarisasi/export
 *
 * Exports the POA Standarisasi list page (same visibility as
 * listVisiblePoaStandarisasiAction: own + subordinates, company-wide for
 * ADMIN/GM/SD/SFE/VIEWER) as one sheet, "Detail Produk & Dokter" — one row
 * per Produk × Dokter combination across every pengajuan shown there
 * (2026-09-09 redline "Export Excel — Sheet Baru 'Detail
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
import { getSubordinateOwnerNips } from "@/lib/authz";
import { buildPhaseProgress } from "@/lib/poaStandarisasiPhases";
import { POA_STANDARISASI_VIEW_ROLES } from "@/lib/role";

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

  const actor = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!actor || !POA_STANDARISASI_VIEW_ROLES.includes(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Scope identik dengan listVisiblePoaStandarisasiAction — export = isi dashboard.
  const ownerNips = [...new Set([actor.nip, ...(await getSubordinateOwnerNips(actor))])];

  const rows = await prisma.poaStandarisasi.findMany({
    where: { ownerId: { in: ownerNips } },
    include: {
      owner: { select: { name: true } },
      outlet: { select: { namaOutlet: true } },
      produk: {
        include: {
          product: { select: { kodeProduk: true, namaProduk: true } },
          dokterApproval: { select: { customerId: true, sudahTtd: true, customer: { select: { namaCustomer: true } } } },
          dokterUser: { include: { customer: { select: { namaCustomer: true } } } },
          approvals: { select: { level: true, status: true, decidedAt: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Approver (ASM/SM/NSM) di-resolve BATCH — scope bisa company-wide, jadi jangan getPoaStandarisasiApprovers per baris
  // (sampai 5 query/baris, docs/PERFORMANCE.md). Logikanya sama dengan getPoaStandarisasiApprovers di lib/authz.ts:
  // rantai nipAtasan (hanya dipercaya kalau rolenya benar), fallback Outlet.coveredByNip/coveredByRole.
  type Row = (typeof rows)[number];
  const chainOwners = await prisma.user.findMany({ where: { nip: { in: [...new Set(rows.map((p: Row) => p.ownerId))] } }, select: { nip: true, nipAtasan: true } });
  const asmNipsAll = [...new Set(chainOwners.map((u: (typeof chainOwners)[number]) => u.nipAtasan).filter((n: string | null): n is string => !!n))];
  const asmUsers = await prisma.user.findMany({ where: { nip: { in: asmNipsAll } }, select: { nip: true, role: true, nipAtasan: true } });
  const smNipsAll = [...new Set(asmUsers.map((u: (typeof asmUsers)[number]) => u.nipAtasan).filter((n: string | null): n is string => !!n))];
  const smUsers = await prisma.user.findMany({ where: { nip: { in: smNipsAll } }, select: { nip: true, role: true, nipAtasan: true } });
  const outlets = await prisma.outlet.findMany({ where: { kodePI: { in: [...new Set(rows.map((p: Row) => p.kodePI))] } }, select: { kodePI: true, coveredByNip: true, coveredByRole: true } });
  const atasanByNip = new Map<string, string | null>(chainOwners.map((u: (typeof chainOwners)[number]) => [u.nip, u.nipAtasan]));
  const asmByNip = new Map<string, (typeof asmUsers)[number]>(asmUsers.map((u: (typeof asmUsers)[number]) => [u.nip, u]));
  const smByNip = new Map<string, (typeof smUsers)[number]>(smUsers.map((u: (typeof smUsers)[number]) => [u.nip, u]));
  const outletByKode = new Map<string, (typeof outlets)[number]>(outlets.map((o: (typeof outlets)[number]) => [o.kodePI, o]));
  const approversByPengajuanId = new Map<string, { asmNip: string | null; smNip: string | null; nsmNip: string | null }>();
  for (const p of rows) {
    let asmNip = atasanByNip.get(p.ownerId) ?? null;
    let smNip: string | null = null;
    let nsmNip: string | null = null;
    if (asmNip) {
      const asm = asmByNip.get(asmNip);
      if (asm?.role !== "ASM") asmNip = null;
      smNip = asm?.nipAtasan ?? null;
    }
    if (smNip) {
      const sm = smByNip.get(smNip);
      if (sm?.role !== "SM") smNip = null;
      nsmNip = sm?.nipAtasan ?? null;
    }
    const outlet = outletByKode.get(p.kodePI);
    if (!asmNip && outlet?.coveredByRole === "ASM") asmNip = outlet.coveredByNip;
    if (!smNip && outlet?.coveredByRole === "SM") smNip = outlet.coveredByNip;
    if (!nsmNip && outlet?.coveredByRole === "NSM") nsmNip = outlet.coveredByNip;
    approversByPengajuanId.set(p.id, { asmNip, smNip, nsmNip });
  }
  const approverNips = [...new Set([...approversByPengajuanId.values()].flatMap((a) => [a.asmNip, a.smNip, a.nsmNip]).filter((n): n is string => !!n))];
  const approverUsers = await prisma.user.findMany({ where: { nip: { in: approverNips } }, select: { nip: true, name: true } });
  const approverNameByNip = new Map(approverUsers.map((u: (typeof approverUsers)[number]) => [u.nip, u.name]));

  const wb = new ExcelJS.Workbook();

  const detail = wb.addWorksheet("Detail Produk & Dokter");
  const PCT_FMT = "0.00%";
  const RP_FMT = "#,##0";
  detail.columns = [
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "Nama ASM", key: "namaAsm", width: 24 },
    { header: "Nama SM", key: "namaSm", width: 24 },
    { header: "Nama NSM", key: "namaNsm", width: 24 },
    { header: "Kode Outlet", key: "kodeOutlet", width: 12 },
    { header: "Outlet", key: "outlet", width: 26 },
    { header: "Tipe", key: "tipe", width: 12 },
    { header: "Planning", key: "progPlanning", width: 22 },
    { header: "Approval ASM", key: "progAsm", width: 22 },
    { header: "Approval SM", key: "progSm", width: 22 },
    { header: "Approval User/Dokter", key: "progUserDokter", width: 20 },
    { header: "Finalisasi", key: "progFinalisasi", width: 22 },
    { header: "Kode Produk", key: "kodeProduk", width: 12 },
    { header: "Nama Produk", key: "namaProduk", width: 28 },
    { header: "Distributor", key: "distributor", width: 20 },
    { header: "Diskon PI (%)", key: "diskonPi", width: 12 },
    { header: "Diskon Dist. (%)", key: "diskonDist", width: 14 },
    { header: "DP (Rp)", key: "dpRp", width: 14 },
    { header: "Est. Qty/bln (SJ)", key: "estimasiQty", width: 12 },
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
    const approvers = approversByPengajuanId.get(p.id)!;
    const progress = buildPhaseProgress(p);
    const shared = {
      namaMr: p.owner.name,
      namaAsm: approvers.asmNip ? approverNameByNip.get(approvers.asmNip) ?? "-" : "-",
      namaSm: approvers.smNip ? approverNameByNip.get(approvers.smNip) ?? "-" : "-",
      namaNsm: approvers.nsmNip ? approverNameByNip.get(approvers.nsmNip) ?? "-" : "-",
      kodeOutlet: p.kodePI,
      outlet: p.outlet.namaOutlet,
      tipe: p.tipeStandarisasi === "PERIODIC" ? "Periodic" : p.tipeStandarisasi === "SISIPAN" ? "Sisipan" : "Non Periodic",
      progPlanning: progress.planning,
      progAsm: progress.approvalAsm,
      progSm: progress.approvalSm,
      progUserDokter: progress.approvalUserDokter,
      progFinalisasi: progress.finalisasi,
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
            qty: d.estimasiQtyUbPerBulan,
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
      "Content-Disposition": `attachment; filename="POA_Standarisasi_${session.userId}.xlsx"`,
    },
  });
}
