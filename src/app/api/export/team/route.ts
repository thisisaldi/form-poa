/**
 * GET /api/export/team?period=2026-Q3
 *
 * Bulk Excel export for NSM/SM/ASM — all POA data for their subordinate MRs.
 * Sheets:
 *   1. Ringkasan Tim     — aggregate totals
 *   2. Per MR            — one row per MR with key metrics
 *   3. Semua Pengajuan   — all line items across all POAs
 *   4. PSSP Aktif        — every still-running PSSP contract + Hospinet snapshot
 *   5. Summary Per Outlet — same metrics as the /summary "Per Outlet" tab (#47),
 *                           scoped to this export's team (2026-07-27, #55)
 *   6. Summary by Produk  — same metrics as the /summary "Per Produk" tab,
 *                           scoped to this export's team (2026-07-28, #6)
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateMRNips } from "@/lib/authz";
import { getActivePsspByOutlets, getHospinetSnapshotsByOutlets } from "@/app/actions/customer";
import { getAllPakets } from "@/lib/paketProduk";
import { computePeriodeAkhir } from "@/lib/poaUtils";
import { spesLabel } from "@/lib/spesialisasi";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // SFE is monitoring-only (2026-07-24: "hanya monitor summarynya saja") —
  // this export goes well past the /summary aggregate (full per-line-item +
  // PSSP contract detail), so it's blocked same as MR.
  if (session.role === "MR" || session.role === "SFE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);
  if (mrNips.length === 0) return NextResponse.json({ error: "Tidak ada MR di bawah Anda." }, { status: 404 });

  const period = req.nextUrl.searchParams.get("period") ?? null;

  // ── Query data ──────────────────────────────────────────────────────────────

  const mrUsers = await prisma.user.findMany({
    where: { nip: { in: mrNips } },
    orderBy: { name: "asc" },
  }) as { nip: string; name: string; nipAtasan: string | null; isDummy: boolean }[];

  // ── Active PSSP contracts across every subordinate MR's outlet territory ──
  const realMrNips = mrUsers.filter(m => !m.isDummy).map(m => m.nip);
  const assignments = realMrNips.length > 0
    ? await prisma.mrOutletAssignment.findMany({
        where: { nipMR: { in: realMrNips }, periode: (() => { const now = new Date(); return now.getFullYear() * 100 + (now.getMonth() + 1); })() },
        select: { kodePI: true, nipMR: true },
      })
    : [];
  const outletToMR = new Map<string, string>(assignments.map((a: { kodePI: string; nipMR: string }) => [a.kodePI, a.nipMR]));
  const assignedOutlets = assignments.map((a: { kodePI: string }) => a.kodePI);
  const [activePsspAll, hospinetSnapshotsAll] = assignedOutlets.length > 0
    ? await Promise.all([getActivePsspByOutlets(assignedOutlets), getHospinetSnapshotsByOutlets(assignedOutlets)])
    : [[], []];

  // Raw org-structure text per outlet (includes "(VACANT) ..."/"DUMMY ..."
  // placeholder names for unfilled ASM/SM/NSM positions) — OutletStrukturBaru
  // is the staging copy of the source file, refreshed wholesale on import,
  // and unlike the User table it does NOT skip placeholder rows (see
  // importStrukturVerifiedKAM.ts). Used below as a fallback so a genuinely
  // vacant level shows its real placeholder label instead of "—" (2026-07-24
  // request) — the nipAtasan hierarchy chain itself skip-links straight past
  // vacant levels by design (that's what makes approval-routing skip them),
  // so it alone can never recover this text.
  const mrToOutlets = new Map<string, string[]>();
  for (const a of assignments as { kodePI: string; nipMR: string }[]) {
    const list = mrToOutlets.get(a.nipMR) ?? [];
    list.push(a.kodePI);
    mrToOutlets.set(a.nipMR, list);
  }
  type StrukturRow = { kodePI: string; asmNama: string | null; smNama: string | null; nsmNama: string | null };
  const strukturRows: StrukturRow[] = assignedOutlets.length > 0
    ? await prisma.outletStrukturBaru.findMany({
        where: { kodePI: { in: assignedOutlets } },
        select: { kodePI: true, asmNama: true, smNama: true, nsmNama: true },
      })
    : [];
  const strukturByOutlet = new Map<string, StrukturRow>(strukturRows.map((r) => [r.kodePI, r]));

  // Unlike the web UI's canView (which keeps DRAFT/REVISI private to the MR
  // until submitted), this team rekap includes every status — a manager
  // exporting their team's numbers wants to see real in-progress work too,
  // not "BELUM SUBMIT" with everything at 0 (2026-07-22, business owner:
  // "jangan [sengaja 0-in], tampilkan saja" re-scoping this specifically for
  // the export, not the rest of the app's approval-flow visibility rules).
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
        isManualCustomer: boolean;
        kodeProduk: string; namaProduk: string; periodeAwal: string; lamaPeriode: number;
        statusStandarisasi: string | null; rencanaTotalBiaya: { toString(): string };
        rencanaVisitMinggu: number; hariKerjaBulan: number | null;
        jumlahResepHari: number | null; qtyProdukResep: number | null; jumlahPasienHari: number | null;
        persenPsspDokter: { toString(): string } | null;
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

  function getAncestors(nipAtasan: string | null, mrNip?: string) {
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
    // Fill remaining "—" levels from the raw struktur text at this MR's own
    // outlet(s) — e.g. "(VACANT) MALANG" instead of a bare dash. First
    // outlet with a non-blank value for that level wins.
    if (mrNip) {
      for (const kodePI of mrToOutlets.get(mrNip) ?? []) {
        const s = strukturByOutlet.get(kodePI);
        if (!s) continue;
        if (result.asmName === "—" && s.asmNama) result.asmName = s.asmNama;
        if (result.smName === "—" && s.smNama) result.smName = s.smNama;
        if (result.nsmName === "—" && s.nsmNama) result.nsmName = s.nsmNama;
      }
    }
    return result;
  }

  // ── Build per-MR stats ──────────────────────────────────────────────────────

  // An MR can have MORE THAN ONE non-draft POA when no ?period= filter is
  // applied (one per quarter they've submitted) — earlier this collapsed to
  // a single "representative" POA per MR (first by updatedAt desc), which
  // silently DROPPED every other period's real data. A freshly-created,
  // still-empty POA for the newest quarter would then shadow an older
  // quarter's fully-submitted-with-real-numbers POA, rendering as
  // "SUBMITTED TO ASM" with everything showing 0 (2026-07-22 fix — found via
  // a live export where an MR with real Q2 AND Q3 submissions showed all
  // zeros because only one of the two was ever surfaced). Fix: don't collapse
  // at all — every non-draft POA gets its own row below, grouped by MR.
  // "YYYY-Qn" → sortable number (20263, 20262, ...) so an MR with several
  // periods lists newest-quarter-first within their own block of rows.
  function periodSortKey(period: string): number {
    const m = period.match(/^(\d{4})-Q(\d)$/);
    return m ? parseInt(m[1], 10) * 10 + parseInt(m[2], 10) : 0;
  }

  const poasByMR = new Map<string, typeof poas>();
  for (const p of poas) {
    const list = poasByMR.get(p.ownerId) ?? [];
    list.push(p);
    poasByMR.set(p.ownerId, list);
  }
  for (const list of poasByMR.values()) {
    list.sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
  }

  const itemsByPoa = new Map<string, typeof lineItems>();
  for (const li of lineItems) {
    const list = itemsByPoa.get(li.poaId) ?? [];
    list.push(li);
    itemsByPoa.set(li.poaId, list);
  }

  interface MrRow {
    poaId: string | null;
    nip: string; name: string; nipAtasan: string | null;
    asmNip: string; asmName: string; smNip: string; smName: string; nsmNip: string; nsmName: string;
    period: string | null; status: string;
    estimasi: number; psspTotal: number; discountTotal: number; entertainTotal: number; budgetTotal: number;
    budgetPct: number;
    customerCount: number; variasiProdukFokus: number; totalPengajuan: number;
    sudahStandar: number; prosesStandar: number; belumStandar: number;
    items: typeof lineItems;
  }

  function buildRow(mr: typeof mrUsers[number], poa: typeof poas[number] | null): MrRow {
    const items = poa ? (itemsByPoa.get(poa.id) ?? []) : [];
    const anc   = getAncestors(mr.nipAtasan, mr.nip);

    let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
    const fokusProduk = new Set<string>();
    let sudah = 0, proses = 0;

    for (const it of items) {
      const base  = toNum(it.rencanaTotalBiaya);
      const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      const psspp = toNum(it.persenPsspDokter) * pengaliNilaiR;
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
      poaId: poa?.id ?? null,
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
  }

  // One row per (MR, POA) — an MR with 3 submitted quarters gets 3 rows, an
  // MR with none gets a single "BELUM SUBMIT" placeholder row.
  const mrRows: MrRow[] = mrUsers.flatMap(mr => {
    const mrPoas = poasByMR.get(mr.nip) ?? [];
    if (mrPoas.length === 0) return [buildRow(mr, null)];
    return mrPoas.map(poa => buildRow(mr, poa));
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
  // "Sudah submit" means actually submitted at least once — DRAFT/REVISI rows
  // (included above so their real numbers show instead of forced 0) don't count,
  // same as BELUM_SUBMIT (no POA at all) doesn't.
  const mrSubmitted  = new Set(
    mrRows.filter(r => r.status !== "BELUM_SUBMIT" && r.status !== "DRAFT" && r.status !== "REVISI").map(r => r.nip)
  ).size;

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
    { header: "Periode POA",          key: "periodPoa",        width: 12 },
    { header: "Status Approval",      key: "statusApproval",   width: 22 },
    { header: "NIP NSM",              key: "nsmNip",           width: 12 },
    { header: "Nama NSM",             key: "nsmName",          width: 24 },
    { header: "NIP SM",               key: "smNip",            width: 12 },
    { header: "Nama SM",              key: "smName",           width: 24 },
    { header: "NIP ASM",              key: "asmNip",           width: 12 },
    { header: "Nama ASM",             key: "asmName",          width: 24 },
    { header: "NIP MR",               key: "nipMR",            width: 12 },
    { header: "Nama MR",              key: "namaMR",           width: 24 },
    { header: "Nama Customer",        key: "namaCust",         width: 28 },
    { header: "Kode Customer",        key: "kodeCust",         width: 14 },
    { header: "Sumber User",          key: "sumberUser",       width: 16 },
    { header: "Spesialisasi",         key: "spesialisasi",     width: 18 },
    { header: "Kode PI",              key: "kodePI",           width: 12 },
    { header: "Nama Outlet",          key: "namaOutlet",       width: 28 },
    { header: "Kode Produk",          key: "kodeProduk",       width: 12 },
    { header: "Nama Produk",          key: "namaProduk",       width: 28 },
    { header: "Status Produk Fokus",  key: "statusFokus",      width: 16 },
    { header: "Periode Awal",         key: "periodeAwal",      width: 14 },
    { header: "Periode Akhir",        key: "periodeAkhir",     width: 14 },
    { header: "Hari Kerja/Bln",       key: "hariKerja",        width: 14 },
    { header: "Resep/Hari",           key: "resep",            width: 12 },
    { header: "Qty/Resep",            key: "qty",              width: 10 },
    { header: "Estimasi",             key: "estimasi",         width: 18 },
    { header: "Pengali Nilai R",      key: "pengaliNilaiR",    width: 14 },
    { header: "% PSSP User",          key: "psspDokter",       width: 16 },
    { header: "% Discount",           key: "diskon",           width: 12 },
    { header: "% DP",                 key: "dp",               width: 10 },
    { header: "% Listing Fee",        key: "listingFee",       width: 14 },
    { header: "% Entertain",          key: "entertain",        width: 14 },
    { header: "Total Budget",         key: "totalBudget",      width: 18 },
    { header: "Ratio Budget",         key: "ratioBudget",      width: 14 },
    { header: "Warning Budget",       key: "warningBudget",    width: 20 },
    { header: "Status Listing Corporate", key: "standarisasi", width: 22 },
    { header: "Produk Kompetitor Utama", key: "kompetitor",    width: 22 },
    { header: "Total Estimasi (Dokter)", key: "totalEstimasiDokter", width: 20 },
    { header: "Total Nilai PSSP (Dokter)", key: "totalNilaiPsspDokter", width: 20 },
  ];
  styleHeader(ws3);

  // Build POA id → MR row map — one mrRows entry per actual POA now (see above),
  // so this covers every non-draft POA's line items, not just one per MR.
  const poaMRMap = new Map(
    mrRows.filter((r): r is MrRow & { poaId: string } => r.poaId !== null).map(r => [r.poaId, r])
  );

  // Newest quarter first, same as "Per MR" above.
  const sortedLineItems = [...lineItems].sort((a, b) => {
    const pa = poaMRMap.get(a.poaId)?.period;
    const pb = poaMRMap.get(b.poaId)?.period;
    return periodSortKey(pb ?? "") - periodSortKey(pa ?? "");
  });

  // Doctor-group totals — same (poaId, kodePI, namaCust) grouping as
  // LineItemEditor's own doctorKey(), so an MR's multiple products for one
  // doctor share one total (2026-07-24 request: "harusnya ada [total per
  // dokter], bukan cuma per produk" — this sheet only ever had per-product
  // rows before).
  function doctorKey(li: (typeof lineItems)[number]): string {
    return `${li.poaId}|${li.kodePI ?? ""}|${li.namaCust}`;
  }
  const doctorTotals = new Map<string, { estimasi: number; nilaiPssp: number }>();
  for (const li of lineItems) {
    const base = parseFloat(li.rencanaTotalBiaya.toString());
    const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
    const nilaiPssp = base * toNum(li.persenPsspDokter) * pengaliNilaiR;
    const key = doctorKey(li);
    const acc = doctorTotals.get(key) ?? { estimasi: 0, nilaiPssp: 0 };
    acc.estimasi += base;
    acc.nilaiPssp += nilaiPssp;
    doctorTotals.set(key, acc);
  }

  const manualCustomerRows: number[] = [];
  for (const li of sortedLineItems) {
    const mr = poaMRMap.get(li.poaId);
    if (!mr) continue;

    const base     = parseFloat(li.rencanaTotalBiaya.toString());
    const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
    const psspPct  = toNum(li.persenPsspDokter) * pengaliNilaiR;
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
    const dTotal = doctorTotals.get(doctorKey(li))!;

    const row = ws3.addRow({
      nsmNip: mr.nsmNip, nsmName: mr.nsmName,
      smNip: mr.smNip,   smName: mr.smName,
      asmNip: mr.asmNip, asmName: mr.asmName,
      nipMR: mr.nip, namaMR: mr.name,
      periodPoa: mr.period ?? "—",
      statusApproval: mr.status.replace(/_/g, " "),
      namaCust: li.namaCust,
      kodeCust: li.kodeCust ?? "—",
      sumberUser: li.isManualCustomer ? "Manual (Belum Terdaftar)" : "Terdaftar",
      spesialisasi: spesLabel(li.spesialisasi),
      kodePI: li.kodePI ?? "—", namaOutlet: li.namaOutlet,
      kodeProduk: li.kodeProduk, namaProduk: li.namaProduk,
      statusFokus: getAllPakets(li.namaProduk).length > 0 ? "Y" : "N",
      periodeAwal: li.periodeAwal,
      periodeAkhir: computePeriodeAkhir(li.periodeAwal, li.lamaPeriode),
      hariKerja: li.hariKerjaBulan ?? "—",
      resep: li.jumlahResepHari ?? "—",
      qty: li.qtyProdukResep ?? "—",
      estimasi: Math.round(base),
      pengaliNilaiR: li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1,
      psspDokter: toNum(li.persenPsspDokter) * 100,
      diskon: toNum(li.persenDiskon) * 100,
      dp: toNum(li.persenDp) * 100,
      listingFee: toNum(li.persenListingFee) * 100,
      entertain: toNum(li.persenEntertain) * 100,
      totalBudget: Math.round(rowBudget),
      ratioBudget: parseFloat(rowBudgetPct.toFixed(2)),
      warningBudget,
      standarisasi: li.statusStandarisasi?.replace(/_/g, " ") ?? "—",
      kompetitor: li.produkKompetitor ?? "—",
      totalEstimasiDokter: Math.round(dTotal.estimasi),
      totalNilaiPsspDokter: Math.round(dTotal.nilaiPssp),
    });
    if (li.isManualCustomer) manualCustomerRows.push(row.number);
  }

  ws3.getColumn("estimasi").numFmt = '#,##0';
  ws3.getColumn("totalBudget").numFmt = '#,##0';
  ws3.getColumn("totalEstimasiDokter").numFmt = '#,##0';
  ws3.getColumn("totalNilaiPsspDokter").numFmt = '#,##0';
  ws3.getColumn("ratioBudget").numFmt = '0.00"%"';
  ["psspDokter","diskon","dp","listingFee","entertain"].forEach(k => {
    ws3.getColumn(k).numFmt = '0.00"%"';
  });
  shadeAlt(ws3, 1);
  // Applied after shadeAlt so the manual-doctor highlight isn't overwritten by
  // the alternating-row shading above.
  for (const rowNum of manualCustomerRows) {
    for (const key of ["namaCust", "sumberUser"]) {
      const cell = ws3.getRow(rowNum).getCell(key);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
      cell.font = { color: { argb: "FF856404" }, bold: key === "sumberUser" };
    }
  }

  if (lineItems.length === 0) ws3.addRow(["(Belum ada data pengajuan)"]);

  // ── Sheet 4: PSSP Aktif ──────────────────────────────────────────────────────
  // Every still-running PSSP contract (PsspKontrak) PLUS every Hospinet
  // aggregate snapshot, across all subordinate MRs' outlet territories —
  // one combined sheet (2026-07-24: "kok PSSP Aktif sama PSSP Hospinet
  // dipisah? disatuin aja") distinguished by a "Sumber" column, since the
  // two sources have different granularity (Kontrak is per-contract-product,
  // Hospinet is one aggregate row per customer — no per-product breakdown,
  // hence "—" in the product/contract columns for those rows).

  // Only used for hierarchy names (asm/sm/nsm) below, which are identical across
  // all of an MR's rows regardless of which POA — collapsing duplicates here is safe.
  const mrRowByNip = new Map(mrRows.map(r => [r.nip, r]));

  const ws4 = wb.addWorksheet("PSSP Aktif");
  ws4.columns = [
    { header: "NIP MR",       key: "nipMR",        width: 12 },
    { header: "Nama MR",      key: "namaMR",        width: 24 },
    { header: "NIP ASM",      key: "asmNip",        width: 12 },
    { header: "Nama ASM",     key: "asmName",       width: 24 },
    { header: "NIP SM",       key: "smNip",         width: 12 },
    { header: "Nama SM",      key: "smName",        width: 24 },
    { header: "NIP NSM",      key: "nsmNip",        width: 12 },
    { header: "Nama NSM",     key: "nsmName",       width: 24 },
    { header: "Sumber",       key: "sumber",        width: 14 },
    { header: "No. Kontrak",  key: "cUrut",         width: 14 },
    { header: "Nama User",    key: "namaUser",      width: 28 },
    { header: "Kode Customer",key: "kodeCustomer",  width: 14 },
    { header: "Kode Outlet",  key: "kodeOutlet",    width: 12 },
    { header: "Nama Outlet",  key: "namaOutlet",    width: 28 },
    { header: "Kode Produk",  key: "kodeProduk",    width: 12 },
    { header: "Nama Produk",  key: "namaProduk",    width: 28 },
    { header: "Periode Awal", key: "periodeAwal",   width: 14 },
    { header: "Periode Akhir",key: "periodeAkhir",  width: 14 },
    { header: "Biaya / Value PSSP", key: "biaya",   width: 18 },
    { header: "Estimasi Sales",  key: "estBaris",   width: 16 },
    { header: "Total Lunas / Pelunasan", key: "totalLunas", width: 18 },
    { header: "% Lunas / RR", key: "pctLunas",      width: 14 },
    { header: "Sisa Estimasi",key: "sisaEstimasi",  width: 16 },
    { header: "Status Customer", key: "statusCustomer", width: 16 },
    { header: "PSSP Berjalan (Hospinet)", key: "psspBerjalan", width: 18 },
  ];
  styleHeader(ws4);

  for (const r of activePsspAll) {
    const mrNip = r.kdOutlet ? outletToMR.get(r.kdOutlet) : undefined;
    const mr = mrNip ? mrRowByNip.get(mrNip) : undefined;
    ws4.addRow({
      nipMR: mrNip ?? "—", namaMR: mr?.name ?? "—",
      asmNip: mr?.asmNip ?? "—", asmName: mr?.asmName ?? "—",
      smNip: mr?.smNip ?? "—", smName: mr?.smName ?? "—",
      nsmNip: mr?.nsmNip ?? "—", nsmName: mr?.nsmName ?? "—",
      sumber: "PSSP Kontrak",
      cUrut: r.cUrut,
      namaUser: r.nmCust ?? "—",
      kodeCustomer: r.kdCust ?? "—",
      kodeOutlet: r.kdOutlet ?? "—", namaOutlet: r.nmOutlet ?? "—",
      kodeProduk: r.kdProduk ?? "—", namaProduk: r.nmProduk ?? "—",
      periodeAwal: r.prdAwal, periodeAkhir: r.prdAkhir,
      biaya: Math.round(r.biaya), estBaris: Math.round(r.estBaris), totalLunas: Math.round(r.totalLunas),
      pctLunas: r.estBaris > 0 ? parseFloat(((r.totalLunas / r.estBaris) * 100).toFixed(1)) : 0,
      sisaEstimasi: Math.round(Math.max(r.estBaris - r.totalLunas, 0)),
      statusCustomer: "—", psspBerjalan: "—",
    });
  }

  for (const r of hospinetSnapshotsAll) {
    const mrNip = outletToMR.get(r.kodePI);
    const mr = mrNip ? mrRowByNip.get(mrNip) : undefined;
    ws4.addRow({
      nipMR: mrNip ?? "—", namaMR: mr?.name ?? "—",
      asmNip: mr?.asmNip ?? "—", asmName: mr?.asmName ?? "—",
      smNip: mr?.smNip ?? "—", smName: mr?.smName ?? "—",
      nsmNip: mr?.nsmNip ?? "—", nsmName: mr?.nsmName ?? "—",
      sumber: "PSSP Hospinet",
      cUrut: "—",
      namaUser: r.namaCustomer,
      kodeCustomer: r.kodeCustomer ?? "—",
      kodeOutlet: r.kodePI, namaOutlet: r.namaOutlet ?? "—",
      kodeProduk: "—", namaProduk: "—",
      periodeAwal: r.periodeAwal ?? "—", periodeAkhir: r.periodeAkhir ?? "—",
      biaya: Math.round(r.valuePssp), estBaris: "—", totalLunas: Math.round(r.pelunasan),
      pctLunas: r.rr != null ? parseFloat((r.rr * 100).toFixed(1)) : 0,
      sisaEstimasi: "—",
      statusCustomer: r.statusCustomer, psspBerjalan: r.psspBerjalan ? "Ya" : "Tidak",
    });
  }

  ["biaya", "estBaris", "totalLunas", "sisaEstimasi"].forEach(key => { ws4.getColumn(key).numFmt = '#,##0'; });
  ws4.getColumn("pctLunas").numFmt = '0.0"%"';
  shadeAlt(ws4, 1);

  if (activePsspAll.length === 0 && hospinetSnapshotsAll.length === 0) ws4.addRow(["(Tidak ada data PSSP aktif)"]);

  // ── Sheet 5: Summary Per Outlet ──────────────────────────────────────────────
  // Same metrics as the /summary "Per Outlet" tab (src/app/(app)/summary/page.tsx,
  // #47 2026-07-27) — reused here scoped to THIS export's team instead of
  // globally: Estimasi Aktif+Pengajuan, Jumlah User PSSP (Aktif+Estimasi),
  // Variasi Produk (Fokus/Non-Fokus), Budget, Cost Ratio, Sales Aktif (2026),
  // Estimasi Per User, Listing Fee. Uses lineItems/activePsspAll/assignedOutlets
  // already fetched above for the other sheets — no new per-line-item queries,
  // just two new groupBy calls (Listing Fee, Sales Value) scoped to
  // assignedOutlets. Deliberately includes DRAFT/REVISI rows same as the rest
  // of this export (see "this team rekap includes every status" comment above).

  const [listingFeeRows, salesValueRaw] = (assignedOutlets.length > 0
    ? await Promise.all([
        prisma.listingFeeKontrak.findMany({ where: { kdOutlet: { in: assignedOutlets } }, select: { kdOutlet: true, noreq: true, value: true } }),
        prisma.outletSalesValueMonthly.groupBy({ by: ["kodePI"], where: { kodePI: { in: assignedOutlets }, periode: { gte: "202601" } }, _sum: { valueSales: true } }),
      ])
    : [[], []]) as [
      { kdOutlet: string | null; noreq: string; value: { toString(): string } }[],
      { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[],
    ];
  // ListingFeeKontrak.value is the CONTRACT's total, repeated on every one of
  // its product rows (same shape as PsspKontrak.biaya) — dedupe by (outlet,
  // noreq) before summing, or a multi-product contract multiply-counts its
  // own value. See matching fix + bug note in src/app/(app)/summary/page.tsx.
  const seenListingFeeContract = new Set<string>();
  const listingFeeByOutlet = new Map<string, number>();
  for (const r of listingFeeRows) {
    if (!r.kdOutlet) continue;
    const key = `${r.kdOutlet}|${r.noreq}`;
    if (seenListingFeeContract.has(key)) continue;
    seenListingFeeContract.add(key);
    listingFeeByOutlet.set(r.kdOutlet, (listingFeeByOutlet.get(r.kdOutlet) ?? 0) + toNum(r.value));
  }
  const salesValueByOutlet = new Map(salesValueRaw.map((r) => [r.kodePI, toNum(r._sum.valueSales)]));

  const activePsspByOutlet = new Map<string, typeof activePsspAll>();
  for (const r of activePsspAll) {
    if (!r.kdOutlet) continue;
    const list = activePsspByOutlet.get(r.kdOutlet) ?? [];
    list.push(r);
    activePsspByOutlet.set(r.kdOutlet, list);
  }

  const outletGroups = new Map<string, { namaOutlet: string; items: typeof lineItems }>();
  for (const li of lineItems) {
    const key = li.kodePI ?? "—";
    if (!outletGroups.has(key)) outletGroups.set(key, { namaOutlet: li.namaOutlet, items: [] });
    outletGroups.get(key)!.items.push(li);
  }

  interface OutletSummaryRow {
    kodePI: string; namaOutlet: string;
    estimasi: number; estimasiAktif: number; userCount: number;
    variasiProduk: number; variasiProdukFokus: number;
    budgetTotal: number; salesAktif: number; listingFeeTotal: number;
  }
  const outletSummaryRows: OutletSummaryRow[] = [...outletGroups.entries()].map(([kodePI, { namaOutlet, items }]) => {
    let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
    for (const li of items) {
      const base = toNum(li.rencanaTotalBiaya);
      const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
      const psspPct = toNum(li.persenPsspDokter) * pengaliNilaiR;
      const discPct = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
      const entPct = toNum(li.persenEntertain);
      estimasi += base;
      psspTotal += base * psspPct;
      discountTotal += base * discPct;
      entertainTotal += base * entPct;
    }
    const activeRows = kodePI !== "—" ? (activePsspByOutlet.get(kodePI) ?? []) : [];
    const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);
    const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
    const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
    const userCount = new Set([...activeCustKeys, ...draftCustKeys]).size;
    return {
      kodePI, namaOutlet,
      estimasi, estimasiAktif, userCount,
      variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
      variasiProdukFokus: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      salesAktif: kodePI !== "—" ? (salesValueByOutlet.get(kodePI) ?? 0) : 0,
      listingFeeTotal: kodePI !== "—" ? (listingFeeByOutlet.get(kodePI) ?? 0) : 0,
    };
  }).sort((a, b) => (b.estimasi + b.estimasiAktif) - (a.estimasi + a.estimasiAktif));

  const ws5 = wb.addWorksheet("Summary Per Outlet");
  ws5.columns = [
    { header: "Kode Outlet",                  key: "kodePI",                width: 14 },
    { header: "Nama Outlet",                  key: "namaOutlet",            width: 28 },
    { header: "Estimasi Aktif+Pengajuan",     key: "estimasiAktifPengajuan", width: 22 },
    { header: "User PSSP (Aktif+Estimasi)",   key: "userCount",             width: 20 },
    { header: "Variasi Produk Fokus",         key: "variasiProdukFokus",    width: 16 },
    { header: "Variasi Produk Non-Fokus",     key: "variasiProdukNonFokus", width: 18 },
    { header: "Budget",                       key: "budget",                width: 18 },
    { header: "Cost Ratio",                   key: "costRatio",             width: 12 },
    { header: "Sales Aktif (2026)",           key: "salesAktif",            width: 18 },
    { header: "Estimasi Per User",            key: "estimasiPerUser",       width: 18 },
    { header: "Listing Fee",                  key: "listingFee",            width: 16 },
  ];
  styleHeader(ws5);

  for (const r of outletSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const costRatio = r.estimasi > 0 ? (r.budgetTotal / r.estimasi) * 100 : 0;
    ws5.addRow({
      kodePI: r.kodePI, namaOutlet: r.namaOutlet,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      userCount: r.userCount,
      variasiProdukFokus: r.variasiProdukFokus,
      variasiProdukNonFokus: r.variasiProduk - r.variasiProdukFokus,
      budget: Math.round(r.budgetTotal),
      costRatio: parseFloat(costRatio.toFixed(1)),
      salesAktif: Math.round(r.salesAktif),
      estimasiPerUser: r.userCount > 0 ? Math.round(estimasiAktifPengajuan / r.userCount) : 0,
      listingFee: Math.round(r.listingFeeTotal),
    });
  }

  ["estimasiAktifPengajuan", "budget", "salesAktif", "estimasiPerUser", "listingFee"].forEach((key) => {
    ws5.getColumn(key).numFmt = '#,##0';
  });
  ws5.getColumn("costRatio").numFmt = '0.0"%"';
  shadeAlt(ws5, 1);

  if (outletSummaryRows.length === 0) ws5.addRow(["(Belum ada data pengajuan)"]);

  // ── Sheet 6: Summary by Produk ────────────────────────────────────────────────
  // Same metrics as the /summary "Per Produk" tab (src/app/(app)/summary/page.tsx),
  // scoped to this export's team (2026-07-28, #6). PsspKontrak keys products by
  // NAME only (Procode ≠ Item Kode across systems), so active-PSSP matching here
  // must normalize on namaProduk same as the web tab's normName/activePsspByProdName.

  function normName(s: string): string {
    return s.toLowerCase().trim();
  }

  const activePsspByProdName = new Map<string, typeof activePsspAll>();
  for (const r of activePsspAll) {
    if (!r.nmProduk) continue;
    const key = normName(r.nmProduk);
    const list = activePsspByProdName.get(key) ?? [];
    list.push(r);
    activePsspByProdName.set(key, list);
  }

  // "Sales Aktif" per product is DERIVED (qty × HNA), same as the web tab —
  // OutletSalesMonthly is a quantity feed, there's no per-product Rupiah sales
  // value model. itemKode matches Product.kodeProduk directly.
  const salesQtyRaw = (assignedOutlets.length > 0
    ? await prisma.outletSalesMonthly.groupBy({ by: ["itemKode"], where: { kodePI: { in: assignedOutlets }, periode: { gte: "202601" } }, _sum: { qty: true } })
    : []) as { itemKode: string; _sum: { qty: { toString(): string } | null } }[];
  const qtyByItemKode = new Map(salesQtyRaw.map((r) => [r.itemKode, toNum(r._sum.qty)]));
  const produkCodesForSales = [...qtyByItemKode.keys()];
  const hnaProducts = (produkCodesForSales.length > 0
    ? await prisma.product.findMany({ where: { kodeProduk: { in: produkCodesForSales } }, select: { kodeProduk: true, hna: true } })
    : []) as { kodeProduk: string; hna: { toString(): string } }[];
  const hnaByKodeProduk = new Map(hnaProducts.map((p) => [p.kodeProduk, toNum(p.hna)]));
  const salesValueByProduk = new Map<string, number>();
  for (const [itemKode, qty] of qtyByItemKode) {
    salesValueByProduk.set(itemKode, qty * (hnaByKodeProduk.get(itemKode) ?? 0));
  }

  const produkGroups = new Map<string, { namaProduk: string; items: typeof lineItems }>();
  for (const li of lineItems) {
    if (!produkGroups.has(li.kodeProduk)) produkGroups.set(li.kodeProduk, { namaProduk: li.namaProduk, items: [] });
    produkGroups.get(li.kodeProduk)!.items.push(li);
  }

  interface ProdukSummaryRow {
    kodeProduk: string; namaProduk: string;
    estimasi: number; estimasiAktif: number; userAktifPssp: number;
    budgetTotal: number; biayaAktif: number; salesAktif: number;
    avgPasienPerUser: number | null; avgStPerPasien: number | null;
  }
  const produkSummaryRows: ProdukSummaryRow[] = [...produkGroups.entries()].map(([kodeProduk, { namaProduk, items }]) => {
    let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
    for (const li of items) {
      const base = toNum(li.rencanaTotalBiaya);
      const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
      const psspPct = toNum(li.persenPsspDokter) * pengaliNilaiR;
      const discPct = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
      const entPct = toNum(li.persenEntertain);
      estimasi += base;
      psspTotal += base * psspPct;
      discountTotal += base * discPct;
      entertainTotal += base * entPct;
    }
    const activeRows = activePsspByProdName.get(normName(namaProduk)) ?? [];
    const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);
    // PsspKontrak.biaya is a flat per-CONTRACT total repeated on every product
    // row of that contract — dedupe by cUrut before summing (same fix as
    // Biaya Aktif in src/app/(app)/summary/page.tsx).
    const seenContracts = new Set<string>();
    let biayaAktif = 0;
    for (const r of activeRows) {
      if (seenContracts.has(r.cUrut)) continue;
      seenContracts.add(r.cUrut);
      biayaAktif += r.biaya;
    }
    const pasienRows = items.filter((li) => li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
    const avgPasienPerUser = pasienRows.length > 0
      ? pasienRows.reduce((s, li) => s + li.jumlahPasienHari!, 0) / pasienRows.length
      : null;
    const stRows = items.filter((li) => li.qtyProdukResep != null && li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
    const avgStPerPasien = stRows.length > 0
      ? stRows.reduce((s, li) => s + li.qtyProdukResep! / li.jumlahPasienHari!, 0) / stRows.length
      : null;
    return {
      kodeProduk, namaProduk,
      estimasi, estimasiAktif,
      userAktifPssp: new Set(activeRows.map((r) => r.kdCust)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      biayaAktif,
      salesAktif: salesValueByProduk.get(kodeProduk) ?? 0,
      avgPasienPerUser, avgStPerPasien,
    };
  }).sort((a, b) => (b.estimasi + b.estimasiAktif) - (a.estimasi + a.estimasiAktif));

  const ws6 = wb.addWorksheet("Summary by Produk");
  ws6.columns = [
    { header: "Kode Produk",              key: "kodeProduk",          width: 14 },
    { header: "Nama Produk",               key: "namaProduk",          width: 32 },
    { header: "Estimasi Aktif+Pengajuan",  key: "estimasiAktifPengajuan", width: 22 },
    { header: "User Aktif PSSP",           key: "userAktifPssp",       width: 14 },
    { header: "Biaya Aktif+Pengajuan",     key: "biayaAktifPengajuan", width: 20 },
    { header: "Cost Ratio",                key: "costRatio",           width: 12 },
    { header: "Sales Aktif (2026)",        key: "salesAktif",          width: 18 },
    { header: "Sales Per User",            key: "salesPerUser",        width: 16 },
    { header: "AVG Pasien/User",           key: "avgPasienPerUser",    width: 16 },
    { header: "AVG ST/Pasien",             key: "avgStPerPasien",      width: 14 },
  ];
  styleHeader(ws6);

  for (const r of produkSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const biayaAktifPengajuan = r.biayaAktif + r.budgetTotal;
    const costRatio = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : 0;
    ws6.addRow({
      kodeProduk: r.kodeProduk, namaProduk: r.namaProduk,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      userAktifPssp: r.userAktifPssp,
      biayaAktifPengajuan: Math.round(biayaAktifPengajuan),
      costRatio: parseFloat(costRatio.toFixed(1)),
      salesAktif: Math.round(r.salesAktif),
      salesPerUser: r.userAktifPssp > 0 ? Math.round(r.salesAktif / r.userAktifPssp) : 0,
      avgPasienPerUser: r.avgPasienPerUser != null ? parseFloat(r.avgPasienPerUser.toFixed(1)) : "",
      avgStPerPasien: r.avgStPerPasien != null ? parseFloat(r.avgStPerPasien.toFixed(1)) : "",
    });
  }

  ["estimasiAktifPengajuan", "biayaAktifPengajuan", "salesAktif", "salesPerUser"].forEach((key) => {
    ws6.getColumn(key).numFmt = '#,##0';
  });
  ws6.getColumn("costRatio").numFmt = '0.0"%"';
  shadeAlt(ws6, 1);

  if (produkSummaryRows.length === 0) ws6.addRow(["(Belum ada data pengajuan)"]);

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
