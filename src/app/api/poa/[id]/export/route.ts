/**
 * GET /api/poa/[id]/export
 *
 * Returns a single-POA Excel workbook using ExcelJS.
 * Sheet "Line Items" exports all PoaLineItem rows for the POA.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { PoaLineItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canView } from "@/lib/authz";
import { computePeriodeAkhir, formatPeriode, computeMonthlyBreakdown } from "@/lib/poaUtils";
import { displayRole } from "@/lib/role";
import { getAllPakets } from "@/lib/paketProduk";
import { getPsspHistory, getActivePsspByOutlets, getHospinetSnapshotsByOutlets, getSurveyRekomendasiByOutlet, getDiskonByOutlet, getDiskonHistoryByOutlet, type PsspKontrakSummary, type DiskonByProduct, type DiskonHistoryByProduct } from "@/app/actions/customer";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
  TIDAK_TAHU: "Tidak Tahu",
};

// "Jenis PSSP" export label — see BentukPssp enum (schema.prisma) / the
// "Jenis PSSP" dropdown next to PS/SP in LineItemEditor.tsx.
const BENTUK_PSSP_LABELS: Record<string, string> = {
  CASH: "Cash",
  BARANG: "Barang",
  JASA: "Jasa",
};

// Fraction of the most recent PSSP contract (active if any, else most recent expired) that has been paid off.
// Mirrors the pct used by computeLabelCustomer() in LineItemEditor.tsx.
function computePelunasanPct(history: PsspKontrakSummary[]): number | null {
  if (history.length === 0) return null;
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byContract = new Map<string, PsspKontrakSummary[]>();
  for (const row of history) {
    const bucket = byContract.get(row.cUrut) ?? [];
    bucket.push(row);
    byContract.set(row.cUrut, bucket);
  }
  let hasActive = false;
  let activeEst = 0, activeLunas = 0, allEst = 0, allLunas = 0;
  for (const rows of byContract.values()) {
    const est = rows.reduce((s, r) => s + r.estBaris, 0);
    const lunas = rows.reduce((s, r) => s + r.totalLunas, 0);
    allEst += est; allLunas += lunas;
    if (rows[0].prdAkhir >= currentPeriod) { hasActive = true; activeEst += est; activeLunas += lunas; }
  }
  if (hasActive) return activeEst > 0 ? activeLunas / activeEst : 0;
  return allEst > 0 ? allLunas / allEst : 0;
}

// Per-month estimate from the most recent COMPLETED PSSP contract for this product, matched by name
// (Procode ≠ Item Kode across systems). Mirrors computeOldEstPerMonth() in LineItemEditor.tsx.
function computeOldEstPerMonth(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const norm = namaProduk.toLowerCase().trim();
  const rows = history.filter((r) => r.nmProduk?.toLowerCase().trim() === norm && r.prdAkhir < currentPeriod);
  if (rows.length === 0) return null;
  const latest = rows[0];
  const sy = parseInt(latest.prdAwal.slice(0, 4)), sm = parseInt(latest.prdAwal.slice(4));
  const ey = parseInt(latest.prdAkhir.slice(0, 4)), em = parseInt(latest.prdAkhir.slice(4));
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return months > 0 && latest.estBaris > 0 ? latest.estBaris / months : null;
}

function doctorKey(item: { kodePI: string | null; namaCust: string }): string {
  return `${item.kodePI ?? ""}|${item.namaCust}`;
}

// "Periode Diskon" — mirrors resolveDiskonContract/resolveDiskonPeriodLabel in
// LineItemEditor.tsx (the "% Diskon (DPL/DPF)" field's period hint). DPL
// (DiskonKontrak) always wins when a contract covers this outlet+product+
// period; DiskonHistory (max historical %, not period-scoped) is only ever
// a fallback note when no DPL contract does. Was previously left as a
// hardcoded "-" here, never actually resolved (2026-07-28 bug report: "kok
// yang ada DPL nya tidak ke populate?").
function resolveDiskonPeriodLabel(
  diskonList: DiskonByProduct[] | undefined,
  diskonHistoryList: DiskonHistoryByProduct[] | undefined,
  kodeProduk: string,
  periodeAwal: string
): string {
  const candidates = (diskonList ?? []).filter((d) =>
    d.kodeProduk === kodeProduk && d.prdAwal <= periodeAwal && d.prdAkhir >= periodeAwal
  );
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.newOnPi > a.newOnPi ? b : a));
    return `DPL periode ${best.prdAwal}-${best.prdAkhir}`;
  }
  const fromHistory = diskonHistoryList?.find((d) => d.kodeProduk === kodeProduk);
  if (fromHistory) return "Historis (tidak terikat periode kontrak)";
  return "-";
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

  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: { owner: true, items: { orderBy: { createdAt: "asc" } } },
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

  // ─── Active PSSP contracts across the MR's whole outlet territory (mirrors
  // the "PSSP Aktif (Kontrak Berjalan)" card on the Detail POA page) ─────────
  let activePssp: Awaited<ReturnType<typeof getActivePsspByOutlets>> = [];
  let hospinetSnapshots: Awaited<ReturnType<typeof getHospinetSnapshotsByOutlets>> = [];
  let outletKodePIs: string[] = [];
  if (!poa.owner.isDummy) {
    const now = new Date();
    const periode = now.getFullYear() * 100 + (now.getMonth() + 1);
    const assignments = await prisma.mrOutletAssignment.findMany({
      where: { nipMR: poa.ownerId, periode },
      select: { kodePI: true },
    });
    outletKodePIs = assignments.map((a: { kodePI: string }) => a.kodePI);
    [activePssp, hospinetSnapshots] = await Promise.all([
      getActivePsspByOutlets(outletKodePIs),
      getHospinetSnapshotsByOutlets(outletKodePIs),
    ]);
  }

  // ─── Org hierarchy (MR → ASM → SM → NSM) for the "Pengisian" sheet ────────
  // Role-aware walk (not a fixed 3-hop chain) — a vacant intermediate level
  // is skip-linked at the nipAtasan data layer itself (see
  // importStrukturVerifiedKAM.ts), so e.g. a vacant ASM means owner.nipAtasan
  // already points straight to the SM; blindly treating hop 1 as "the ASM"
  // would then mislabel the SM as ASM and cascade every level down.
  type HierUser = { nip: string; name: string; role: string; nipAtasan: string | null };
  let asm: HierUser | null = null, sm: HierUser | null = null, nsm: HierUser | null = null;
  {
    let cur = poa.owner.nipAtasan;
    let hops = 0;
    while (cur && hops < 6) {
      const u: HierUser | null = await prisma.user.findUnique({
        where: { nip: cur }, select: { nip: true, name: true, role: true, nipAtasan: true },
      });
      if (!u) break;
      if (u.role === "ASM" && !asm) asm = u;
      if (u.role === "SM" && !sm) sm = u;
      if (u.role === "NSM" && !nsm) nsm = u;
      cur = u.nipAtasan;
      hops++;
    }
  }
  // Raw org-structure text (includes "(VACANT) ..."/"DUMMY ..." placeholder
  // names) as a fallback for whichever level is still unresolved — the
  // walk above can only find REAL people, never a vacant position's own
  // label (2026-07-24 request: show that label instead of "-").
  let asmNamaFallback: string | null = null, smNamaFallback: string | null = null, nsmNamaFallback: string | null = null;
  if ((!asm || !sm || !nsm) && outletKodePIs.length > 0) {
    const strukturRows = await prisma.outletStrukturBaru.findMany({
      where: { kodePI: { in: outletKodePIs } },
      select: { asmNama: true, smNama: true, nsmNama: true },
    });
    asmNamaFallback = strukturRows.find((r: { asmNama: string | null }) => r.asmNama)?.asmNama ?? null;
    smNamaFallback  = strukturRows.find((r: { smNama: string | null }) => r.smNama)?.smNama ?? null;
    nsmNamaFallback = strukturRows.find((r: { nsmNama: string | null }) => r.nsmNama)?.nsmNama ?? null;
  }

  const hospinetByDoctor = new Map(
    hospinetSnapshots.map((s) => [`${s.kodePI}|${s.namaCustomer.trim().toUpperCase()}`, s])
  );

  // ─── Batch product master + PSSP history lookups for all line items ──────
  const pengisianItems: PoaLineItem[] = poa.items;
  const productRows = await prisma.product.findMany({
    where: { kodeProduk: { in: [...new Set(pengisianItems.map((it: PoaLineItem) => it.kodeProduk))] } },
  });
  type ProductRow = (typeof productRows)[number];
  const productMap = new Map<string, ProductRow>(productRows.map((p: ProductRow): [string, ProductRow] => [p.kodeProduk, p]));
  const psspHistoryMap = new Map<string, PsspKontrakSummary[]>();
  for (const kodeCust of new Set(
    pengisianItems.map((it: PoaLineItem) => it.kodeCust).filter((k): k is string => !!k)
  )) {
    psspHistoryMap.set(kodeCust, await getPsspHistory(kodeCust));
  }
  // Survey recommendations per (kodeCust, kodePI) — for the "Status Produk
  // Rekomendasi" column's "Produk Survey" bucket, same source as the
  // "Produk Survey" section of the sidebar's Kriteria Produk panel.
  const surveyByOutletMap = new Map<string, Set<string>>();
  for (const it of pengisianItems) {
    if (!it.kodeCust || !it.kodePI) continue;
    const key = `${it.kodeCust}|${it.kodePI}`;
    if (surveyByOutletMap.has(key)) continue;
    const rows = await getSurveyRekomendasiByOutlet(it.kodeCust, it.kodePI);
    surveyByOutletMap.set(key, new Set(rows.map((r) => r.kodeProduk)));
  }
  // DPL/DPF contract + history data per outlet — for the "Periode Diskon" column.
  const diskonByOutletMap = new Map<string, DiskonByProduct[]>();
  const diskonHistoryByOutletMap = new Map<string, DiskonHistoryByProduct[]>();
  for (const kodePI of new Set(
    pengisianItems.map((it: PoaLineItem) => it.kodePI).filter((k): k is string => !!k)
  )) {
    diskonByOutletMap.set(kodePI, await getDiskonByOutlet(kodePI));
    diskonHistoryByOutletMap.set(kodePI, await getDiskonHistoryByOutlet(kodePI));
  }

  // ─── Approval history (for the Pengisian "Approval SM/NSM" columns + Audit Log sheet) ──
  const logs = await prisma.poaAuditLog.findMany({
    where: { poaId: id },
    include: { actor: true },
    orderBy: { createdAt: "asc" },
  });
  type AuditLogRow = (typeof logs)[number];
  const approveLog = (toStatus: string) =>
    logs.find((l: AuditLogRow) => l.action === "APPROVE" && l.toStatus === toStatus) ?? null;
  const approvalSm = (() => {
    const log = approveLog("APPROVED_BY_SM");
    return log ? `${log.actor.name} (${log.createdAt.toLocaleDateString("id-ID")})` : "-";
  })();
  const approvalNsm = (() => {
    const log = approveLog("APPROVED_BY_NSM");
    return log ? `${log.actor.name} (${log.createdAt.toLocaleDateString("id-ID")})` : "-";
  })();

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
  const kontesProdukSet = new Set<string>();

  for (const it of allItems) {
    const base = toNum(it.rencanaTotalBiaya);
    const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
    estimasiTotal  += base;
    psspTotal      += base * (toNum(it.persenPsspDokter) * pengaliNilaiR);
    discountTotal  += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
    doctorKeys.add(`${it.kodePI ?? ""}|${it.namaCust}`);
    if (getAllPakets(it.namaProduk).length > 0) kontesProdukSet.add(it.kodeProduk);
    if (it.statusStandarisasi === "SUDAH_STANDARISASI") sudahStandar++;
    if (it.statusStandarisasi === "PROSES_PENGAJUAN") prosesStandar++;
  }

  const budgetTotal  = psspTotal + discountTotal + entertainTotal;
  const budgetRatio  = estimasiTotal > 0 ? (budgetTotal / estimasiTotal) * 100 : 0;
  const budgetStatus = budgetRatio > 42.5 ? "Melebihi batas (>42.5%)" : budgetRatio > 38 ? "Mendekati batas (38–42.5%)" : budgetRatio > 0 ? "Aman (<38%)" : "-";
  // Export Excel TETAP pakai angka asli (bukan skala ÷1.000.000 yang dipakai
  // tampilan in-app) — dikonfirmasi pengguna 2026-08-10, membatalkan asumsi
  // OQ-2 sebelumnya di docs/label-currency-format-updates/01-business-rules.md.
  const formatRp = (n: number) => Math.round(n).toLocaleString("id-ID");

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
  addDataRow(summary, "Campaign / DPL / DPF",    formatRp(discountTotal), true);
  addDataRow(summary, "ENT",                     formatRp(entertainTotal));
  addDataRow(summary, "Total Budget",            formatRp(budgetTotal), true);
  addDataRow(summary, "% Budget dari Estimasi",  budgetRatio > 0 ? `${budgetRatio.toFixed(1)}%` : "-");
  addDataRow(summary, "Status Anggaran",         budgetStatus, true);

  summary.addRow([]);

  // — Cakupan —
  addSectionHeader(summary, "Cakupan");
  addDataRow(summary, "Jumlah User",             doctorKeys.size);
  addDataRow(summary, "Produk Kontes",           kontesProdukSet.size, true);
  addDataRow(summary, "Total Pengajuan (baris)", allItems.length);

  summary.addRow([]);

  // — Listing / Standarisasi —
  addSectionHeader(summary, "Listing Produk");
  addDataRow(summary, "Sudah Listing",           sudahStandar);
  addDataRow(summary, "Proses Pengajuan",        prosesStandar, true);
  addDataRow(summary, "Belum Listing",           allItems.length - sudahStandar);

  // Light blue header row placeholder (column headers not used, style top border instead)
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LBLUE } };

  // ─── Sheet: Estimasi PSSP per Bulan ──────────────────────────────────────
  // Estimasi (rencanaTotalBiaya) and Nilai PSSP per line item spread evenly
  // across its periodeAwal–periodeAkhir months (rata rata, no other basis
  // available), rolled up by level — one row each per metric. A single POA
  // has exactly one owner, so this is normally two rows — kept as its own
  // sheet for consistency with the team export rather than folded into
  // Summary. Shared computeMonthlyBreakdown() also backs the same table in
  // the app's "Ringkasan POA" panel (StatsPanel) so this isn't Excel-only.
  {
    const level = displayRole(poa.owner.role, poa.owner.jabatan);
    const monthMap = computeMonthlyBreakdown(allItems);
    const monthsSorted = [...monthMap.keys()].sort();
    const wsPssp = wb.addWorksheet("Estimasi PSSP per Bulan");
    wsPssp.columns = [
      { header: "Level", key: "level", width: 14 },
      { header: "Metrik", key: "metrik", width: 14 },
      ...monthsSorted.map((m) => ({ header: formatPeriode(m), key: m, width: 16 })),
    ];
    wsPssp.getRow(1).font = { bold: true, color: { argb: WHITE } };
    wsPssp.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    if (monthsSorted.length > 0) {
      const estimasiRow: Record<string, string | number> = { level, metrik: "Estimasi" };
      const nilaiPsspRow: Record<string, string | number> = { level, metrik: "Nilai PSSP" };
      for (const m of monthsSorted) {
        const v = monthMap.get(m)!;
        estimasiRow[m] = Math.round(v.estimasi);
        nilaiPsspRow[m] = Math.round(v.nilaiPssp);
      }
      wsPssp.addRow(estimasiRow);
      wsPssp.addRow(nilaiPsspRow);
      monthsSorted.forEach((m) => { wsPssp.getColumn(m).numFmt = '#,##0'; });
    } else {
      wsPssp.addRow(["(Tidak ada data Estimasi PSSP)"]);
    }
  }

  // ─── Sheet 2: Pengisian ──────────────────────────────────────────────────
  // Column set/order mirrors "Pengisian" sheet in
  // excel/Sketsa Keseluruhan (version 1).xlsb (1).xlsx (cols A–AY, incl. the
  // trailing Approval SM/NSM columns, derived from this POA's audit log).
  const formSheet = wb.addWorksheet("Pengisian");
  const PCT_FMT = "0.0%";
  const RP_FMT = "#,##0";
  formSheet.columns = [
    { header: "Nomor Rencana Pengajuan", key: "nomorRencana", width: 12 },
    { header: "NIP MR/ SPV", key: "nipMr", width: 14 },
    { header: "Nama MR / SPV", key: "namaMr", width: 24 },
    { header: "Nama ASM", key: "namaAsm", width: 24 },
    { header: "Nama SM", key: "namaSm", width: 24 },
    { header: "Nama NSM", key: "namaNsm", width: 24 },
    { header: "KodePI - Nama Outlet", key: "outlet", width: 32 },
    { header: "Spesialisasi", key: "spesialisasi", width: 22 },
    { header: "Nama User", key: "namaUser", width: 32 },
    { header: "Sumber User", key: "sumberUser", width: 14 },
    { header: "Label User", key: "labelUser", width: 20 },
    { header: "Nama Produk Kompetitor Utama", key: "produkKompetitor", width: 22 },
    { header: "Item Kode - Nama Produk ", key: "produk", width: 32 },
    { header: "Kriteria Produk", key: "kriteriaProduk", width: 18 },
    { header: "Kategori/ Status Produk Kontes", key: "statusKontes", width: 16 },
    { header: "% Pelunasan Sebelumnya", key: "pelunasanSebelumnya", width: 16 },
    { header: "Estimasi PS/SP Sebelumnya", key: "estimasiSebelumnya", width: 18 },
    { header: "History Sales \n(B-12)", key: "historySales", width: 16 },
    { header: "Status Listing Corporate", key: "statusStandarisasi", width: 20 },
    { header: "Jumlah Hari Praktek(Bulan)", key: "hariKerjaBulan", width: 14 },
    { header: "Jumlah R / Hari", key: "jumlahResepHari", width: 12 },
    { header: "Jumlah \nSatuan Terkecil (ST)\n/R", key: "qtyProdukResep", width: 14 },
    { header: "Satuan Terkecil\n(ST)", key: "satuanTerkecil", width: 12 },
    { header: "Harga Satuan Terkecil Produk", key: "hargaSatuanTerkecil", width: 16 },
    { header: "Jumlah \nSatuan Jual(SJ)", key: "jumlahSJ", width: 14 },
    { header: "Estimasi PS/SP Produk\n/Bulan", key: "estimasiBulan", width: 16 },
    { header: "Growth Estimasi PS/SP per Produk/ Bulan", key: "growthEstimasi", width: 16 },
    { header: "Total Estimasi PS/SP Produk \n/Bulan", key: "totalEstimasiBulan", width: 18 },
    { header: "Nilai R (%)", key: "nilaiR", width: 12 },
    { header: "Pengali PS/SP", key: "pengaliPssp", width: 12 },
    { header: "Nilai PS/SP Produk \n/Bulan", key: "nilaiPsspBulan", width: 16 },
    { header: "Total Nilai PS/SP Produk \n/Bulan", key: "totalNilaiPsspBulan", width: 18 },
    { header: "Periode PS/SP (Bulan)", key: "periodePssp", width: 14 },
    { header: "Periode Awal PS/SP (YYYYMM, contoh: 202601)", key: "periodeAwal", width: 16 },
    { header: "Periode Akhir PS/SP (YYYYMM, contoh: 202612)", key: "periodeAkhir", width: 16 },
    { header: "Estimasi PS/SP Produk \n/Periode", key: "estimasiPeriode", width: 18 },
    { header: "Total Estimasi PS/SP Produk \n/Periode", key: "totalEstimasiPeriode", width: 18 },
    { header: "Nilai PS/SP Produk \n/Periode", key: "nilaiPsspPeriode", width: 18 },
    { header: "Total Nilai PS/SP Produk \n/Periode", key: "totalNilaiPsspPeriode", width: 18 },
    { header: "Rasio Total Biaya(%Estimasi Sales)", key: "rasioTotalBiaya", width: 14 },
    { header: "Rencana Kunjungan/ Bulan", key: "rencanaKunjungan", width: 14 },
    { header: "% PS/SP User", key: "persenPsspUser", width: 12 },
    { header: "% Campaign (DPL/DPF)", key: "persenDiskon", width: 14 },
    { header: "Periode Diskon", key: "periodeDiskon", width: 14 },
    { header: "% DP", key: "persenDp", width: 10 },
    { header: "% Listing Fee", key: "persenListingFee", width: 12 },
    { header: "% Entertaint", key: "persenEntertain", width: 12 },
    { header: "Total % Budget", key: "totalPersenBudget", width: 14 },
    { header: "Warning/ Tagging", key: "warning", width: 16 },
    { header: "Approval SM", key: "approvalSm", width: 22 },
    { header: "Approval NSM", key: "approvalNsm", width: 22 },
    { header: "Status User", key: "statusUser", width: 12 },
    { header: "Historis PSSP", key: "historisPssp", width: 16 },
    { header: "Jenis PSSP", key: "jenisPsspBentuk", width: 12 },
    { header: "Keterangan Produk", key: "statusProdukRekomendasi", width: 26 },
  ];
  formSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  formSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0063A0" },
  };
  formSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  type PengisianItem = (typeof pengisianItems)[number];
  const toNumP = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

  // Doctor grouping — mirrors doctorKey() so multi-product rows for the same
  // doctor share one "Nomor Rencana Pengajuan" and the same group totals.
  const groupNumberByKey = new Map<string, number>();
  const groupTotals = new Map<string, { estimasiBulan: number; nilaiPsspBulan: number; estimasiPeriode: number; nilaiPsspPeriode: number }>();
  let nextGroupNumber = 1;

  function computeItemValues(item: PengisianItem) {
    const totalBiaya = toNumP(item.rencanaTotalBiaya);
    const lama = item.lamaPeriode || 1;
    const persenPsspDokter = toNumP(item.persenPsspDokter);
    const pengaliNilaiR = item.pengaliNilaiR != null ? toNumP(item.pengaliNilaiR) : 1;
    const nilaiPsspPeriode = totalBiaya * persenPsspDokter * pengaliNilaiR;
    return {
      estimasiBulan: totalBiaya / lama,
      nilaiPsspBulan: nilaiPsspPeriode / lama,
      estimasiPeriode: totalBiaya,
      nilaiPsspPeriode,
    };
  }

  for (const item of pengisianItems) {
    const key = doctorKey(item);
    if (!groupNumberByKey.has(key)) groupNumberByKey.set(key, nextGroupNumber++);
    const v = computeItemValues(item);
    const totals = groupTotals.get(key) ?? { estimasiBulan: 0, nilaiPsspBulan: 0, estimasiPeriode: 0, nilaiPsspPeriode: 0 };
    totals.estimasiBulan += v.estimasiBulan;
    totals.nilaiPsspBulan += v.nilaiPsspBulan;
    totals.estimasiPeriode += v.estimasiPeriode;
    totals.nilaiPsspPeriode += v.nilaiPsspPeriode;
    groupTotals.set(key, totals);
  }

  // Sort rows by "Nomor Rencana Pengajuan" so every doctor's products stay grouped together.
  const sortedPengisianItems = [...pengisianItems].sort(
    (a, b) => groupNumberByKey.get(doctorKey(a))! - groupNumberByKey.get(doctorKey(b))!
  );

  for (const item of sortedPengisianItems) {
    const key = doctorKey(item);
    const product = productMap.get(item.kodeProduk) ?? null;
    const v = computeItemValues(item);
    const totals = groupTotals.get(key)!;

    const history = item.kodeCust ? psspHistoryMap.get(item.kodeCust) ?? [] : [];
    // Falls back to the Hospinet snapshot's own RR only when there's no
    // PsspKontrak history at all — mirrors the UI's PsspHistoryPanel, which
    // shows the Hospinet card as a fallback rather than a duplicate figure
    // (2026-07-23, requested so Hospinet pelunasan also shows up here).
    const hospinetPct = hospinetByDoctor.get(`${item.kodePI ?? ""}|${item.namaCust.trim().toUpperCase()}`)?.rr ?? null;
    const pelunasanPct = history.length > 0 ? computePelunasanPct(history) : hospinetPct;
    const estimasiSebelumnya = computeOldEstPerMonth(history, item.namaProduk);

    // Status User: Retensi/Baru — "Baru" only when this customer has never had
    // any PSSP contract on record; everyone else counts as Retensi.
    const statusUser = history.length === 0 ? "Baru" : "Retensi";
    // Historis PSSP: total distinct contracts on record for this customer so
    // far (same "PSSP ke-N" counting convention as PsspStatusByCustomer.psspKe
    // in src/app/actions/customer.ts).
    const historisPssp = history.length === 0
      ? "Belum Pernah PSSP"
      : `PSSP ke-${new Set(history.map((r) => r.cUrut)).size}`;
    // Keterangan Produk — same priority order as the sidebar's Kriteria
    // Produk panel (Pernah PSSP -> Produk Kontes PM -> Produk Survey ->
    // Corporate Listing -> Lainnya). "Corporate Listing" mirrors the
    // KriteriaProdukPanel's own "Listing Corporate - Ada/Tidak Ada Sales"
    // sections — same kriteriaProduk prefix check.
    const namaProdukNorm = item.namaProduk.toLowerCase().trim();
    const surveyKodeProduk = item.kodeCust && item.kodePI
      ? surveyByOutletMap.get(`${item.kodeCust}|${item.kodePI}`)
      : undefined;
    const statusProdukRekomendasi = history.some((r) => r.nmProduk?.toLowerCase().trim() === namaProdukNorm)
      ? "Pernah PSSP"
      : getAllPakets(item.namaProduk).length > 0
      ? "Rekomendasi PM"
      : surveyKodeProduk?.has(item.kodeProduk)
      ? "Produk Survey"
      : item.kriteriaProduk?.startsWith("Produk Sudah Terstandarisasi")
      ? "Corporate Listing"
      : "Lainnya";
    const jenisPsspBentuk = item.bentukPssp ? BENTUK_PSSP_LABELS[item.bentukPssp] ?? item.bentukPssp : "-";
    // item.labelCustomer is a SNAPSHOT taken when the line item was created
    // (computeLabelCustomer in LineItemEditor.tsx) — never recomputed after,
    // so a customer with no PSSP yet at that moment but a real contract
    // synced in since keeps exporting the stale label forever otherwise
    // (2026-08-04, same bug as DraftChecklist.tsx's DoctorRow). `history`
    // above is the live PsspKontrak fetch — same fix, minimal override
    // rather than a full recompute: only steps in when the stored label
    // actively disagrees with "this customer has PSSP on record now".
    const labelUser = history.length > 0 && (!item.labelCustomer || item.labelCustomer === "Dokter Baru")
      ? "Pernah PSSP"
      : item.labelCustomer ?? "-";

    const hna = product ? parseFloat(product.hna.toString()) : 0;
    const jumlahSJ = hna > 0 ? v.estimasiPeriode / hna : null;
    // Nilai R (%) — must come from Product.nilaiRPersen ONLY, same as the UI
    // (LineItemEditor.tsx's nilaiRPersen tile). PoaLineItem.nilaiR is a
    // DIFFERENT field on a completely different scale (Decimal(18,2) rupiah
    // sync snapshot, not a percent) — this cell is formatted PCT_FMT below,
    // so preferring item.nilaiR here rendered garbage like "120000000.0%"
    // whenever that field happened to be populated (2026-08-05 bug report:
    // "nilai r nya di excel ga sesuai sama yang existing").
    const nilaiR = product?.nilaiRPersen != null ? parseFloat(product.nilaiRPersen.toString()) : null;

    const periodeDiskon = item.kodePI
      ? resolveDiskonPeriodLabel(diskonByOutletMap.get(item.kodePI), diskonHistoryByOutletMap.get(item.kodePI), item.kodeProduk, item.periodeAwal)
      : "-";

    const persenPsspUser = toNumP(item.persenPsspDokter);
    const persenDiskon = toNumP(item.persenDiskon);
    const persenDp = toNumP(item.persenDp);
    const persenListingFee = toNumP(item.persenListingFee);
    const persenEntertain = toNumP(item.persenEntertain);
    const totalPersenBudget = persenPsspUser + persenDiskon + persenDp + persenListingFee + persenEntertain;

    const row = formSheet.addRow({
      nomorRencana: groupNumberByKey.get(key),
      nipMr: poa.owner.nip,
      namaMr: poa.owner.name,
      namaAsm: asm?.name ?? asmNamaFallback ?? "-",
      namaSm: sm?.name ?? smNamaFallback ?? "-",
      namaNsm: nsm?.name ?? nsmNamaFallback ?? "-",
      outlet: `${item.kodePI ?? "-"} - ${item.namaOutlet}`,
      spesialisasi: item.spesialisasi,
      namaUser: `${item.kodeCust ?? "-"} - ${item.namaCust}`,
      sumberUser: item.isManualCustomer ? "Manual (Belum Terdaftar)" : "Terdaftar",
      labelUser,
      produkKompetitor: item.produkKompetitor ?? "-",
      produk: `${item.itemKode} - ${item.namaProduk}`,
      kriteriaProduk: item.kriteriaProduk ?? "-",
      statusKontes: getAllPakets(item.namaProduk).length > 0 ? "Y" : "N",
      pelunasanSebelumnya: pelunasanPct,
      estimasiSebelumnya,
      historySales: item.historySales3Bln != null ? parseFloat(item.historySales3Bln.toString()) : null,
      statusStandarisasi: item.statusStandarisasi ? STATUS_STANDARISASI_LABELS[item.statusStandarisasi] ?? item.statusStandarisasi : "-",
      hariKerjaBulan: item.hariKerjaBulan,
      jumlahResepHari: item.jumlahResepHari,
      qtyProdukResep: item.qtyProdukResep,
      satuanTerkecil: item.satuanTerkecil,
      hargaSatuanTerkecil: item.hargaSatuanTerkecil != null ? parseFloat(item.hargaSatuanTerkecil.toString()) : null,
      jumlahSJ,
      estimasiBulan: v.estimasiBulan,
      growthEstimasi: item.rasioEstimasiGrowth != null ? parseFloat(item.rasioEstimasiGrowth.toString()) : null,
      totalEstimasiBulan: totals.estimasiBulan,
      nilaiR,
      pengaliPssp: item.pengaliNilaiR != null ? parseFloat(item.pengaliNilaiR.toString()) : null,
      nilaiPsspBulan: v.nilaiPsspBulan,
      totalNilaiPsspBulan: totals.nilaiPsspBulan,
      periodePssp: item.lamaPeriode,
      periodeAwal: item.periodeAwal,
      periodeAkhir: computePeriodeAkhir(item.periodeAwal, item.lamaPeriode),
      estimasiPeriode: v.estimasiPeriode,
      totalEstimasiPeriode: totals.estimasiPeriode,
      nilaiPsspPeriode: v.nilaiPsspPeriode,
      totalNilaiPsspPeriode: totals.nilaiPsspPeriode,
      rasioTotalBiaya: v.estimasiPeriode > 0 ? v.nilaiPsspPeriode / v.estimasiPeriode : null,
      rencanaKunjungan: item.rencanaVisitMinggu,
      persenPsspUser,
      persenDiskon,
      periodeDiskon,
      persenDp,
      persenListingFee,
      persenEntertain,
      totalPersenBudget,
      warning: totalPersenBudget > 0.425 ? "OVER BUDGET" : totalPersenBudget > 0 ? "SAFE" : "-",
      approvalSm,
      approvalNsm,
      statusUser,
      historisPssp,
      jenisPsspBentuk,
      statusProdukRekomendasi,
    });

    for (const key2 of ["pelunasanSebelumnya", "nilaiR", "persenPsspUser", "persenDiskon", "persenDp", "persenListingFee", "persenEntertain", "totalPersenBudget"]) {
      row.getCell(key2).numFmt = PCT_FMT;
    }
    for (const key2 of ["estimasiSebelumnya", "historySales", "hargaSatuanTerkecil", "estimasiBulan", "totalEstimasiBulan", "nilaiPsspBulan", "totalNilaiPsspBulan", "estimasiPeriode", "totalEstimasiPeriode", "nilaiPsspPeriode", "totalNilaiPsspPeriode"]) {
      row.getCell(key2).numFmt = RP_FMT;
    }
    // Manually-registered doctor (not yet in the synced customer database) — highlight so
    // reviewers notice at a glance, on top of the "Sumber User" column text itself.
    if (item.isManualCustomer) {
      for (const key2 of ["namaUser", "sumberUser"]) {
        row.getCell(key2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
        row.getCell(key2).font = { color: { argb: "FF856404" }, bold: key2 === "sumberUser" };
      }
    }
  }
  if (pengisianItems.length === 0) formSheet.addRow(["(Belum ada line item)"]);

  // ─── Sheet 3: PSSP Aktif ─────────────────────────────────────────────────
  // Every still-running PSSP contract (PsspKontrak) PLUS every Hospinet
  // aggregate snapshot, across the MR's whole assigned territory — one
  // combined sheet (2026-07-24: "kok PSSP Aktif sama PSSP Hospinet dipisah?
  // disatuin aja"), distinguished by a "Sumber" column since the two sources
  // have different granularity (Kontrak is per-contract-product, Hospinet is
  // one aggregate row per customer — no per-product breakdown, hence "-" in
  // the product/contract columns for those rows).
  const psspSheet = wb.addWorksheet("PSSP Aktif");
  psspSheet.columns = [
    { header: "Sumber", key: "sumber", width: 14 },
    { header: "No. Kontrak", key: "cUrut", width: 14 },
    { header: "Nama User", key: "namaUser", width: 28 },
    { header: "Kode Customer", key: "kodeCustomer", width: 14 },
    { header: "Kode Outlet", key: "kodeOutlet", width: 12 },
    { header: "Nama Outlet", key: "namaOutlet", width: 28 },
    { header: "Kode Produk", key: "kodeProduk", width: 12 },
    { header: "Nama Produk", key: "namaProduk", width: 28 },
    { header: "Periode Awal", key: "periodeAwal", width: 14 },
    { header: "Periode Akhir", key: "periodeAkhir", width: 14 },
    { header: "Biaya / Value PSSP", key: "biaya", width: 18 },
    { header: "Estimasi Sales", key: "estBaris", width: 16 },
    { header: "Total Lunas / Pelunasan", key: "totalLunas", width: 20 },
    { header: "% Lunas / RR", key: "pctLunas", width: 14 },
    { header: "Sisa Estimasi", key: "sisaEstimasi", width: 16 },
    { header: "Status Customer", key: "statusCustomer", width: 16 },
    { header: "PSSP Berjalan (Hospinet)", key: "psspBerjalan", width: 18 },
  ];
  psspSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  psspSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };

  for (const r of activePssp) {
    psspSheet.addRow({
      sumber: "PSSP Kontrak",
      cUrut: r.cUrut,
      namaUser: r.nmCust ?? "-",
      kodeCustomer: r.kdCust ?? "-",
      kodeOutlet: r.kdOutlet ?? "-",
      namaOutlet: r.nmOutlet ?? "-",
      kodeProduk: r.kdProduk ?? "-",
      namaProduk: r.nmProduk ?? "-",
      periodeAwal: r.prdAwal,
      periodeAkhir: r.prdAkhir,
      biaya: r.biaya,
      estBaris: r.estBaris,
      totalLunas: r.totalLunas,
      pctLunas: r.estBaris > 0 ? r.totalLunas / r.estBaris : 0,
      sisaEstimasi: Math.max(r.estBaris - r.totalLunas, 0),
      statusCustomer: "-", psspBerjalan: "-",
    });
  }

  for (const r of hospinetSnapshots) {
    psspSheet.addRow({
      sumber: "PSSP Hospinet",
      cUrut: "-",
      namaUser: r.namaCustomer,
      kodeCustomer: r.kodeCustomer ?? "-",
      kodeOutlet: r.kodePI,
      namaOutlet: r.namaOutlet ?? "-",
      kodeProduk: "-", namaProduk: "-",
      periodeAwal: r.periodeAwal ?? "-", periodeAkhir: r.periodeAkhir ?? "-",
      biaya: r.valuePssp,
      estBaris: "-",
      totalLunas: r.pelunasan,
      pctLunas: r.rr ?? 0,
      sisaEstimasi: "-",
      statusCustomer: r.statusCustomer, psspBerjalan: r.psspBerjalan ? "Ya" : "Tidak",
    });
  }

  ["biaya", "estBaris", "totalLunas", "sisaEstimasi"].forEach(k => { psspSheet.getColumn(k).numFmt = RP_FMT; });
  psspSheet.getColumn("pctLunas").numFmt = PCT_FMT;
  if (activePssp.length === 0 && hospinetSnapshots.length === 0) psspSheet.addRow(["(Tidak ada data PSSP aktif)"]);

  // ─── Sheet 4: Audit Log ──────────────────────────────────────────────────
  const auditSheet = wb.addWorksheet("Audit Log");
  auditSheet.columns = [
    { header: "Date", key: "date", width: 22 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Action", key: "action", width: 12 },
    { header: "From Status", key: "from", width: 22 },
    { header: "To Status", key: "to", width: 22 },
  ];
  auditSheet.getRow(1).font = { bold: true };

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
