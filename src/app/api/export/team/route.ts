/**
 * GET /api/export/team?period=2026-Q3
 *
 * Bulk Excel export for NSM/SM/ASM — all POA data for their subordinate MRs.
 * Sheets:
 *   1. Ringkasan Tim  — aggregate totals
 *   2. Per MR         — one row per MR with key metrics
 *   3. Semua Pengajuan — all line items across all POAs
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateMRNips } from "@/lib/authz";
import { getAllPakets } from "@/lib/paketProduk";
import { computePeriodeAkhir, formatPeriode } from "@/lib/poaUtils";
import { spesLabel } from "@/lib/spesialisasi";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function safePeriode(yyyymm: string | null | undefined): string {
  if (!yyyymm || yyyymm.length < 6) return "—";
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return "—";
  return formatPeriode(yyyymm);
}

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "MR") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);
  if (mrNips.length === 0) return NextResponse.json({ error: "Tidak ada MR di bawah Anda." }, { status: 404 });

  const period = req.nextUrl.searchParams.get("period") ?? null;

  // ── Query data ──────────────────────────────────────────────────────────────

  const mrUsers = await prisma.user.findMany({
    where: { nip: { in: mrNips } },
    orderBy: { name: "asc" },
  }) as { nip: string; name: string; nipAtasan: string | null }[];

  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips } };
  if (period) poaWhere.period = period;

  const poas = await prisma.poaForm.findMany({
    where: poaWhere,
    include: { owner: true },
    orderBy: { updatedAt: "desc" },
  }) as { id: string; ownerId: string; period: string; status: string; createdAt: Date; updatedAt: Date; target: { toString(): string } | null; owner: { nip: string; name: string } }[];

  const poaIds = poas.map(p => p.id);

  const lineItems = poaIds.length > 0
    ? await prisma.poaLineItem.findMany({ where: { poaId: { in: poaIds } } }) as {
        id: string; poaId: string; kodePI: string | null; namaOutlet: string;
        namaCust: string; kodeCust: string | null; spesialisasi: string; role: string;
        kodeProduk: string; namaProduk: string; periodeAwal: string; lamaPeriode: number;
        statusStandarisasi: string | null; rencanaTotalBiaya: { toString(): string };
        rencanaVisitMinggu: number; hariKerjaBulan: number | null;
        jumlahResepHari: number | null; qtyProdukResep: number | null;
        persenPsspDokter: { toString(): string } | null; persenPsspKpdm: { toString(): string } | null;
        persenDiskon: { toString(): string } | null; persenDp: { toString(): string } | null;
        persenListingFee: { toString(): string } | null; persenEntertain: { toString(): string } | null;
        pengaliNilaiR: { toString(): string } | null;
        produkKompetitor: string | null;
      }[]
    : [];

  // ── Build org hierarchy map ─────────────────────────────────────────────────
  // Trace 3 levels up from MR: ASM → SM → NSM

  type HierUser = { nip: string; name: string; role: string; nipAtasan: string | null };

  const hierMap = new Map<string, HierUser>();

  const round1Nips = [...new Set(mrUsers.map(m => m.nipAtasan).filter(Boolean) as string[])];
  const round1Users = round1Nips.length > 0
    ? await prisma.user.findMany({
        where: { nip: { in: round1Nips } },
        select: { nip: true, name: true, role: true, nipAtasan: true },
      }) as HierUser[]
    : [];
  round1Users.forEach(u => hierMap.set(u.nip, u));

  const round2Nips = [...new Set(round1Users.map(u => u.nipAtasan).filter(Boolean) as string[])].filter(n => !hierMap.has(n));
  const round2Users = round2Nips.length > 0
    ? await prisma.user.findMany({
        where: { nip: { in: round2Nips } },
        select: { nip: true, name: true, role: true, nipAtasan: true },
      }) as HierUser[]
    : [];
  round2Users.forEach(u => hierMap.set(u.nip, u));

  const round3Nips = [...new Set(round2Users.map(u => u.nipAtasan).filter(Boolean) as string[])].filter(n => !hierMap.has(n));
  const round3Users = round3Nips.length > 0
    ? await prisma.user.findMany({
        where: { nip: { in: round3Nips } },
        select: { nip: true, name: true, role: true, nipAtasan: true },
      }) as HierUser[]
    : [];
  round3Users.forEach(u => hierMap.set(u.nip, u));

  function getAncestors(nipAtasan: string | null) {
    const result = { asmNip: "—", asmName: "—", smNip: "—", smName: "—", nsmNip: "—", nsmName: "—" };
    let cur: string | null = nipAtasan;
    while (cur) {
      const u = hierMap.get(cur);
      if (!u) break;
      if (u.role === "ASM" && result.asmNip === "—") { result.asmNip = u.nip; result.asmName = u.name; }
      if (u.role === "SM"  && result.smNip  === "—") { result.smNip  = u.nip; result.smName  = u.name; }
      if (u.role === "NSM" && result.nsmNip === "—") { result.nsmNip = u.nip; result.nsmName = u.name; }
      cur = u.nipAtasan ?? null;
    }
    return result;
  }

  // ── Build per-MR stats ──────────────────────────────────────────────────────

  const poaByMR    = new Map<string, typeof poas[number]>();
  for (const p of poas) poaByMR.set(p.ownerId, p);

  const itemsByPoa = new Map<string, typeof lineItems>();
  for (const li of lineItems) {
    const list = itemsByPoa.get(li.poaId) ?? [];
    list.push(li);
    itemsByPoa.set(li.poaId, list);
  }

  interface MrRow {
    nip: string; name: string; nipAtasan: string | null;
    asmNip: string; asmName: string; smNip: string; smName: string; nsmNip: string; nsmName: string;
    period: string | null; status: string;
    estimasi: number; psspTotal: number; discountTotal: number; entertainTotal: number; budgetTotal: number;
    budgetPct: number;
    customerCount: number; variasiProdukFokus: number; totalPengajuan: number;
    sudahStandar: number; prosesStandar: number; belumStandar: number;
    items: typeof lineItems;
  }

  const mrRows: MrRow[] = mrUsers.map(mr => {
    const poa    = poaByMR.get(mr.nip);
    const items  = poa ? (itemsByPoa.get(poa.id) ?? []) : [];
    const anc    = getAncestors(mr.nipAtasan);

    let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
    const fokusProduk = new Set<string>();
    let sudah = 0, proses = 0;

    for (const it of items) {
      const base  = toNum(it.rencanaTotalBiaya);
      const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      const psspp = toNum(it.persenPsspDokter) * pengaliNilaiR + toNum(it.persenPsspKpdm);
      const disc  = toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee);
      const ent   = toNum(it.persenEntertain);
      estimasi      += base;
      psspTotal     += base * psspp;
      discountTotal += base * disc;
      entertainTotal += base * ent;
      if (getAllPakets(it.namaProduk).length > 0) fokusProduk.add(it.kodeProduk);
      if (it.statusStandarisasi === "SUDAH_STANDARISASI") sudah++;
      if (it.statusStandarisasi === "PROSES_PENGAJUAN") proses++;
    }

    const budgetTotal = psspTotal + discountTotal + entertainTotal;
    return {
      nip: mr.nip, name: mr.name, nipAtasan: mr.nipAtasan,
      ...anc,
      period: poa?.period ?? null,
      status: poa?.status ?? "BELUM_SUBMIT",
      estimasi, psspTotal, discountTotal, entertainTotal, budgetTotal,
      budgetPct: estimasi > 0 ? (budgetTotal / estimasi) * 100 : 0,
      customerCount: new Set(items.map(i => i.namaCust)).size,
      variasiProdukFokus: fokusProduk.size,
      totalPengajuan: items.length,
      sudahStandar: sudah, prosesStandar: proses, belumStandar: items.length - sudah,
      items,
    };
  });

  // ── Workbook ────────────────────────────────────────────────────────────────

  const wb = new ExcelJS.Workbook();
  wb.creator = "POA System";
  wb.created = new Date();

  const BLUE  = "FF0063A0";
  const WHITE = "FFFFFFFF";
  const GRAY  = "FFF2F2F2";

  function styleHeader(ws: ExcelJS.Worksheet) {
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: WHITE } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      cell.alignment = { vertical: "middle", wrapText: false };
    });
    ws.getRow(1).height = 20;
  }

  function shadeAlt(ws: ExcelJS.Worksheet, fromRow: number) {
    ws.eachRow((row, rn) => {
      if (rn <= fromRow) return;
      if (rn % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
        });
      }
    });
  }

  // ── Sheet 1: Ringkasan Tim ──────────────────────────────────────────────────

  const totalEst     = mrRows.reduce((s, r) => s + r.estimasi, 0);
  const totalPssp    = mrRows.reduce((s, r) => s + r.psspTotal, 0);
  const totalDisc    = mrRows.reduce((s, r) => s + r.discountTotal, 0);
  const totalEnt     = mrRows.reduce((s, r) => s + r.entertainTotal, 0);
  const totalBudget  = mrRows.reduce((s, r) => s + r.budgetTotal, 0);
  const totalCust    = new Set(lineItems.map(li => li.namaCust)).size;
  const totalFokus   = new Set(lineItems.filter(li => getAllPakets(li.namaProduk).length > 0).map(li => li.kodeProduk)).size;
  const totalPengaj  = lineItems.length;
  const totalSudah   = mrRows.reduce((s, r) => s + r.sudahStandar, 0);
  const totalProses  = mrRows.reduce((s, r) => s + r.prosesStandar, 0);
  const totalBelum   = mrRows.reduce((s, r) => s + r.belumStandar, 0);
  const mrSubmitted  = mrRows.filter(r => r.status !== "BELUM_SUBMIT").length;

  const ws1 = wb.addWorksheet("Ringkasan Tim");
  ws1.columns = [
    { key: "label", width: 36 },
    { key: "value", width: 28 },
  ];

  function addKv(label: string, value: string | number, bold = false) {
    const row = ws1.addRow([label, value]);
    row.getCell(2).alignment = { horizontal: "right" };
    if (bold) row.font = { bold: true };
  }
  function addDivider(title: string) {
    ws1.addRow([]);
    const row = ws1.addRow([title]);
    ws1.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    row.height = 18;
  }

  ws1.addRow(["Laporan Rekap POA"]);
  ws1.getRow(1).font = { bold: true, size: 14 };
  ws1.addRow(["Diekspor oleh", `${session.name} (${session.role})`]);
  ws1.addRow(["Tanggal export", new Date().toLocaleDateString("id-ID")]);
  if (period) ws1.addRow(["Periode", period]);
  ws1.addRow([]);

  addDivider("Progres Submit");
  addKv("Total MR", mrUsers.length);
  addKv("Sudah submit", mrSubmitted);
  addKv("Belum submit", mrUsers.length - mrSubmitted);

  addDivider("Estimasi & Anggaran");
  addKv("Total Estimasi POA",       fmtRp(totalEst), true);
  addKv("Total PSSP",               fmtRp(totalPssp));
  addKv("Total Discount + DPL/DPF", fmtRp(totalDisc));
  addKv("Total Entertain",          fmtRp(totalEnt));
  addKv("Total Budget",             fmtRp(totalBudget), true);
  addKv("% Budget / Estimasi",      totalEst > 0 ? `${((totalBudget / totalEst) * 100).toFixed(1)}%` : "—");

  addDivider("Cakupan");
  addKv("Total Customer (unik)",     totalCust);
  addKv("Variasi Produk Fokus (unik)", totalFokus);
  addKv("Total Baris Pengajuan",    totalPengaj);

  addDivider("Listing Produk");
  addKv("Sudah Listing",            totalSudah);
  addKv("Proses Pengajuan",         totalProses);
  addKv("Belum Listing",            totalBelum);

  // ── Sheet 2: Per MR ─────────────────────────────────────────────────────────

  const ws2 = wb.addWorksheet("Per MR");
  ws2.columns = [
    { header: "NIP MR",           key: "nip",            width: 12 },
    { header: "Nama MR",          key: "name",           width: 28 },
    { header: "NIP ASM",          key: "asmNip",         width: 12 },
    { header: "Nama ASM",         key: "asmName",        width: 24 },
    { header: "NIP SM",           key: "smNip",          width: 12 },
    { header: "Nama SM",          key: "smName",         width: 24 },
    { header: "NIP NSM",          key: "nsmNip",         width: 12 },
    { header: "Nama NSM",         key: "nsmName",        width: 24 },
    { header: "Periode",          key: "period",         width: 12 },
    { header: "Status",           key: "status",         width: 22 },
    { header: "Estimasi",         key: "estimasi",       width: 20 },
    { header: "PSSP",             key: "pssp",           width: 18 },
    { header: "Discount",         key: "discount",       width: 18 },
    { header: "Entertain",        key: "entertain",      width: 18 },
    { header: "Total Budget",     key: "budget",         width: 18 },
    { header: "% Budget",         key: "budgetPct",      width: 12 },
    { header: "Customer",         key: "customer",       width: 12 },
    { header: "Produk Fokus",     key: "fokus",          width: 14 },
    { header: "Total Pengajuan",  key: "pengajuan",      width: 16 },
    { header: "Sudah Listing",    key: "sudah",          width: 14 },
    { header: "Proses",           key: "proses",         width: 12 },
    { header: "Belum Listing",    key: "belum",          width: 14 },
  ];
  styleHeader(ws2);

  for (const r of mrRows) {
    ws2.addRow({
      nip: r.nip, name: r.name,
      asmNip: r.asmNip, asmName: r.asmName,
      smNip: r.smNip, smName: r.smName,
      nsmNip: r.nsmNip, nsmName: r.nsmName,
      period: r.period ?? "—", status: r.status.replace(/_/g, " "),
      estimasi: Math.round(r.estimasi),
      pssp: Math.round(r.psspTotal), discount: Math.round(r.discountTotal), entertain: Math.round(r.entertainTotal),
      budget: Math.round(r.budgetTotal), budgetPct: parseFloat(r.budgetPct.toFixed(1)),
      customer: r.customerCount, fokus: r.variasiProdukFokus, pengajuan: r.totalPengajuan,
      sudah: r.sudahStandar, proses: r.prosesStandar, belum: r.belumStandar,
    });
  }

  // Format currency columns
  ["estimasi","pssp","discount","entertain","budget"].forEach(key => {
    const col = ws2.getColumn(key);
    col.numFmt = '#,##0';
  });
  ws2.getColumn("budgetPct").numFmt = '0.0"%"';
  shadeAlt(ws2, 1);

  // ── Sheet 3: Semua Pengajuan ─────────────────────────────────────────────────

  const ws3 = wb.addWorksheet("Semua Pengajuan");
  ws3.columns = [
    { header: "NIP NSM",              key: "nsmNip",           width: 12 },
    { header: "Nama NSM",             key: "nsmName",          width: 24 },
    { header: "NIP SM",               key: "smNip",            width: 12 },
    { header: "Nama SM",              key: "smName",           width: 24 },
    { header: "NIP ASM",              key: "asmNip",           width: 12 },
    { header: "Nama ASM",             key: "asmName",          width: 24 },
    { header: "NIP MR",               key: "nipMR",            width: 12 },
    { header: "Nama MR",              key: "namaMR",           width: 24 },
    { header: "Periode POA",          key: "periodPoa",        width: 12 },
    { header: "Nama Customer",        key: "namaCust",         width: 28 },
    { header: "Spesialisasi",         key: "spesialisasi",     width: 18 },
    { header: "Kode PI",              key: "kodePI",           width: 12 },
    { header: "Nama Outlet",          key: "namaOutlet",       width: 28 },
    { header: "Kode Produk",          key: "kodeProduk",       width: 12 },
    { header: "Nama Produk",          key: "namaProduk",       width: 28 },
    { header: "Periode Awal",         key: "periodeAwal",      width: 14 },
    { header: "Periode Akhir",        key: "periodeAkhir",     width: 14 },
    { header: "Hari Kerja/Bln",       key: "hariKerja",        width: 14 },
    { header: "Resep/Hari",           key: "resep",            width: 12 },
    { header: "Qty/Resep",            key: "qty",              width: 10 },
    { header: "Estimasi",             key: "estimasi",         width: 18 },
    { header: "% PSSP User",          key: "psspDokter",       width: 16 },
    { header: "% PSSP KPDM",          key: "psspKpdm",         width: 14 },
    { header: "% Discount",           key: "diskon",           width: 12 },
    { header: "% DP",                 key: "dp",               width: 10 },
    { header: "% Listing Fee",        key: "listingFee",       width: 14 },
    { header: "% Entertain",          key: "entertain",        width: 14 },
    { header: "Total Budget",         key: "totalBudget",      width: 18 },
    { header: "Warning Budget",       key: "warningBudget",    width: 20 },
    { header: "Status Standarisasi",  key: "standarisasi",     width: 22 },
    { header: "Produk Kompetitor",    key: "kompetitor",       width: 22 },
  ];
  styleHeader(ws3);

  // Build POA id → MR row map
  const poaMRMap = new Map(mrRows.map(r => {
    const poa = poaByMR.get(r.nip);
    if (!poa) return [null, r] as const;
    return [poa.id, r] as const;
  }).filter(([id]) => id !== null) as [string, MrRow][]);

  for (const li of lineItems) {
    const mr = poaMRMap.get(li.poaId);
    if (!mr) continue;

    const base     = parseFloat(li.rencanaTotalBiaya.toString());
    const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
    const psspPct  = toNum(li.persenPsspDokter) * pengaliNilaiR + toNum(li.persenPsspKpdm);
    const discPct  = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
    const entPct   = toNum(li.persenEntertain);
    const rowBudget = base * (psspPct + discPct + entPct);
    const rowBudgetPct = base > 0 ? (rowBudget / base) * 100 : 0;
    const warningBudget = rowBudgetPct > 42.5
      ? "Melebihi batas (>42.5%)"
      : rowBudgetPct > 38
        ? "Mendekati batas (38–42.5%)"
        : rowBudgetPct > 0
          ? "Aman (<38%)"
          : "—";

    ws3.addRow({
      nsmNip: mr.nsmNip, nsmName: mr.nsmName,
      smNip: mr.smNip,   smName: mr.smName,
      asmNip: mr.asmNip, asmName: mr.asmName,
      nipMR: mr.nip, namaMR: mr.name,
      periodPoa: mr.period ?? "—",
      namaCust: li.namaCust,
      spesialisasi: spesLabel(li.spesialisasi),
      kodePI: li.kodePI ?? "—", namaOutlet: li.namaOutlet,
      kodeProduk: li.kodeProduk, namaProduk: li.namaProduk,
      periodeAwal: safePeriode(li.periodeAwal),
      periodeAkhir: safePeriode(computePeriodeAkhir(li.periodeAwal, li.lamaPeriode)),
      hariKerja: li.hariKerjaBulan ?? "—",
      resep: li.jumlahResepHari ?? "—",
      qty: li.qtyProdukResep ?? "—",
      estimasi: Math.round(base),
      psspDokter: toNum(li.persenPsspDokter) * 100,
      psspKpdm: toNum(li.persenPsspKpdm) * 100,
      diskon: toNum(li.persenDiskon) * 100,
      dp: toNum(li.persenDp) * 100,
      listingFee: toNum(li.persenListingFee) * 100,
      entertain: toNum(li.persenEntertain) * 100,
      totalBudget: Math.round(rowBudget),
      warningBudget,
      standarisasi: li.statusStandarisasi?.replace(/_/g, " ") ?? "—",
      kompetitor: li.produkKompetitor ?? "—",
    });
  }

  ws3.getColumn("estimasi").numFmt = '#,##0';
  ws3.getColumn("totalBudget").numFmt = '#,##0';
  ["psspDokter","psspKpdm","diskon","dp","listingFee","entertain"].forEach(k => {
    ws3.getColumn(k).numFmt = '0.00"%"';
  });
  shadeAlt(ws3, 1);

  if (lineItems.length === 0) ws3.addRow(["(Belum ada data pengajuan)"]);

  // ── Response ─────────────────────────────────────────────────────────────────

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = period
    ? `Rekap_POA_${period}_${session.name.replace(/\s+/g, "_")}.xlsx`
    : `Rekap_POA_${session.name.replace(/\s+/g, "_")}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
