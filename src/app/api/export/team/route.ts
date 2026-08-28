/**
 * GET /api/export/team?period=2026-Q3
 *
 * Bulk Excel export for NSM/SM/ASM — all POA data for their subordinate MRs.
 * `period` defaults to the CURRENT quarter when omitted (2026-08-26 —
 * previously unbounded/all-history by default, which caused live 502s for
 * ADMIN/GM/SFE/VIEWER's company-wide scope; see the `period` assignment
 * below for the full history).
 * Sheets:
 *   1. Semua Pengajuan   — all line items across all POAs
 *   2. PSSP Aktif        — every still-running PSSP contract + Hospinet snapshot
 *
 * Trimmed to just these 2 sheets (2026-08-28, "export excel terlalu berat") —
 * used to also carry Ringkasan Tim/Per MR/Estimasi PSSP per Bulan/5 Summary-*
 * rollup sheets, whose queries (esp. the per-outlet Nexus spesialisasi lookup,
 * measured ~96s for ADMIN/company-wide scope) were the dominant cost behind
 * this route's reported 502/500s. Add them back only if a lighter data source
 * shows up — see git history for the removed sheet-building code.
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateOwnerNips } from "@/lib/authz";
import { getActivePsspByOutlets, getHospinetSnapshotsByOutlets, getPsspHistoryByCustomers, getSurveyRekomendasiByCustomers, getDiskonByOutlets, getDiskonHistoryByOutlets, type PsspKontrakSummary, type DiskonByProduct, type DiskonHistoryByProduct } from "@/app/actions/customer";
import { getAllPakets } from "@/lib/paketProduk";
import { computePeriodeAkhir, computeJumlahPeriode } from "@/lib/poaUtils";
import { currentQuarter } from "@/lib/quarterUtils";
import { spesLabel } from "@/lib/spesialisasi";

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// "Jenis PSSP" export label — mirrors the same map in /api/poa/[id]/export
// (BentukPssp enum, schema.prisma).
const BENTUK_PSSP_LABELS: Record<string, string> = {
  CASH: "Cash",
  BARANG: "Barang",
  JASA: "Jasa",
};

// "Periode Diskon" — mirrors resolveDiskonPeriodLabel in
// /api/poa/[id]/export/route.ts exactly (same formula, duplicated per this
// file's existing convention — see BENTUK_PSSP_LABELS above).
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

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // SFE used to be blocked here too (2026-07-24: "hanya monitor summarynya
  // saja") — reversed 2026-08-14 per explicit request: SFE and VIEWER (the
  // latter never blocked here) should be able to bulk-export, not just pull
  // one POA at a time via canView's per-POA access. MR stays blocked — this
  // is a team-wide rollup, an MR has no team.
  if (session.role === "MR") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  // mrNips despite the name now also includes the actor's own nip plus any
  // vacant-team ASM/SM/NSM in scope who own a POA directly (2026-08-27 fix,
  // see getSubordinateOwnerNips) — NOT MR-role-only. Everything below (the
  // "Per MR" sheet, poaWhere.ownerId, org-hierarchy walk) already works
  // unmodified for a non-MR row here: the `mrUsers` query below has no
  // `role:` filter of its own, so a self-owning ASM/SM/NSM just shows up as
  // a normal row, and getAncestors correctly walks up from THEIR OWN
  // nipAtasan same as any MR's.
  const mrNips = await getSubordinateOwnerNips(actor);
  if (mrNips.length === 0) return NextResponse.json({ error: "Tidak ada tim di bawah Anda." }, { status: 404 });

  // Defaults to the CURRENT quarter (2026-08-26 fix) — was `?? null` (no
  // bound at all) per a 2026-08-04 request ("default export is every quarter
  // the team has data for"). That's fine for an ASM/SM/NSM's modest team, but
  // for ADMIN/GM/SFE/VIEWER (company-wide scope via getSubordinateOwnerNips
  // above) it meant every non-draft POA + line item EVER created, company-
  // wide, in one synchronous request — the same unbounded-history class of
  // bug docs/PERFORMANCE.md already documents (#47), and the reported cause
  // of this route's live 502s. Explicit ?period=YYYY-QN still works for
  // anyone who wants a different single quarter; there's just no more
  // "everything, forever" default for anyone.
  const period = req.nextUrl.searchParams.get("period") ?? currentQuarter();

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
  }) as { id: string; ownerId: string; period: string; status: string; createdAt: Date; updatedAt: Date; target: { toString(): string } | null; owner: { nip: string; name: string; role: string; jabatan: string | null } }[];

  const poaIds = poas.map(p => p.id);

  // No `select:` — full row fetch, the `as` cast below just narrows which
  // columns TypeScript knows about. Widened 2026-08-05 (itemKode/satuanTerkecil/
  // hargaSatuanTerkecil/historySales3Bln/rasioEstimasiGrowth/labelCustomer) to
  // reach full column parity with /api/poa/[id]/export's "Pengisian" sheet —
  // the data was always there, just not exposed to this file's types before.
  const lineItems = poaIds.length > 0
    ? await prisma.poaLineItem.findMany({ where: { poaId: { in: poaIds } } }) as {
        id: string; poaId: string; kodePI: string | null; namaOutlet: string;
        namaCust: string; kodeCust: string | null; spesialisasi: string; role: string;
        isManualCustomer: boolean;
        kodeProduk: string; namaProduk: string; itemKode: string; satuanTerkecil: string;
        periodeAwal: string; lamaPeriode: number;
        statusStandarisasi: string | null; rencanaTotalBiaya: { toString(): string };
        rencanaVisitMinggu: number; hariKerjaBulan: number | null;
        jumlahResepHari: number | null; qtyProdukResep: number | null; jumlahPasienHari: number | null;
        persenPsspDokter: { toString(): string } | null;
        persenDiskon: { toString(): string } | null; persenDp: { toString(): string } | null;
        persenListingFee: { toString(): string } | null; persenEntertain: { toString(): string } | null;
        pengaliNilaiR: { toString(): string } | null;
        hargaSatuanTerkecil: { toString(): string } | null;
        historySales3Bln: { toString(): string } | null;
        rasioEstimasiGrowth: { toString(): string } | null;
        labelCustomer: string | null;
        produkKompetitor: string | null;
        bentukPssp: string | null;
        kriteriaProduk: string | null;
      }[]
    : [];

  // ── PSSP history + survey recommendations (for "Historis PSSP" / "Jenis
  //    PSSP" / "Keterangan Produk" columns on "Semua Pengajuan" — same
  //    columns already on the single-POA export, missing here) ──────────────
  // Batched (2026-08-18 fix — was one getPsspHistory/getSurveyRekomendasiByOutlet
  // call PER DISTINCT customer/outlet-pair in a sequential loop: ~1,400+ extra
  // round trips company-wide, long enough to trip the reverse proxy's timeout
  // (502 Bad Gateway) for ADMIN/SFE/VIEWER's full-scope export). See
  // getPsspHistoryByCustomers/getSurveyRekomendasiByCustomers doc comments.
  const distinctKodeCust = [...new Set(lineItems.map((li) => li.kodeCust).filter((k): k is string => !!k))];
  const [psspHistoryMap, surveyRowsByKey] = await Promise.all([
    getPsspHistoryByCustomers(distinctKodeCust),
    getSurveyRekomendasiByCustomers(distinctKodeCust),
  ]);
  const surveyByOutletMap = new Map<string, Set<string>>();
  for (const [key, rows] of surveyRowsByKey) {
    surveyByOutletMap.set(key, new Set(rows.map((r) => r.kodeProduk)));
  }

  // ── Product master (hna/nilaiRPersen) + Hospinet-by-doctor + per-POA audit
  //    logs — added 2026-08-05 to reach full column parity with the
  //    single-POA "Pengisian" sheet ("Jumlah Satuan Jual", "Nilai R (%)",
  //    "% Pelunasan Sebelumnya"/"Estimasi ... Sebelumnya" Hospinet fallback,
  //    "Approval SM"/"Approval NSM"). One batched query each, not per-row.
  const productCodesInLineItems = [...new Set(lineItems.map((li) => li.kodeProduk))];
  const productRowsForPengajuan = productCodesInLineItems.length > 0
    ? await prisma.product.findMany({
        where: { kodeProduk: { in: productCodesInLineItems } },
        select: { kodeProduk: true, hna: true, nilaiRPersen: true },
      }) as { kodeProduk: string; hna: { toString(): string }; nilaiRPersen: { toString(): string } | null }[]
    : [];
  const productMapForPengajuan = new Map(productRowsForPengajuan.map((p) => [p.kodeProduk, p]));

  const hospinetByDoctor = new Map(
    hospinetSnapshotsAll.map((s) => [`${s.kodePI}|${s.namaCustomer.trim().toUpperCase()}`, s])
  );

  // approvalLabel() below only ever looks at action="APPROVE" rows and only
  // reads toStatus/createdAt/actor.name — narrowed from a full-row + full-actor
  // fetch (2026-08-21 fix, docs/PERFORMANCE.md §2 point 3: company-wide scope
  // was pulling 35k+ audit rows — including every non-APPROVE action ever
  // logged, unbounded by period — for just 406 POAs, timing out as a 502 on
  // the reverse proxy). Filtering action="APPROVE" server-side plus a narrow
  // `select` cuts both row count and per-row payload.
  const auditLogsAll = poaIds.length > 0
    ? await prisma.poaAuditLog.findMany({
        where: { poaId: { in: poaIds }, action: "APPROVE" },
        select: { poaId: true, action: true, toStatus: true, createdAt: true, actor: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }) as { poaId: string; action: string; toStatus: string; createdAt: Date; actor: { name: string } }[]
    : [];
  const auditLogsByPoa = new Map<string, typeof auditLogsAll>();
  for (const log of auditLogsAll) {
    const list = auditLogsByPoa.get(log.poaId) ?? [];
    list.push(log);
    auditLogsByPoa.set(log.poaId, list);
  }
  function approvalLabel(poaId: string, toStatus: string): string {
    const log = (auditLogsByPoa.get(poaId) ?? []).find((l) => l.action === "APPROVE" && l.toStatus === toStatus);
    return log ? `${log.actor.name} (${log.createdAt.toLocaleDateString("id-ID")})` : "-";
  }

  // "Periode Diskon" column data — batched across every distinct outlet in
  // scope (2026-08-18 fix, same class of bug as the PSSP/survey loops above:
  // this used to be 2 sequential getDiskonByOutlet/getDiskonHistoryByOutlet
  // calls PER DISTINCT OUTLET, ~800+ extra round trips company-wide).
  const distinctKodePI = [...new Set(lineItems.map((li) => li.kodePI).filter((k): k is string => !!k))];
  const [diskonByOutletMap, diskonHistoryByOutletMap] = await Promise.all([
    getDiskonByOutlets(distinctKodePI),
    getDiskonHistoryByOutlets(distinctKodePI),
  ]);

  // Mirrors computePelunasanPct/computeOldEstPerMonth in
  // /api/poa/[id]/export/route.ts exactly (same formulas) — duplicated
  // rather than imported since neither file shares a lib module for these
  // yet (matches this codebase's existing per-export-file convention, see
  // BENTUK_PSSP_LABELS above already being duplicated the same way).
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
    customerCount: number; variasiProdukKontes: number; totalPengajuan: number;
    sudahStandar: number; prosesStandar: number; belumStandar: number;
    items: typeof lineItems;
  }

  function buildRow(mr: typeof mrUsers[number], poa: typeof poas[number] | null): MrRow {
    const items = poa ? (itemsByPoa.get(poa.id) ?? []) : [];
    const anc   = getAncestors(mr.nipAtasan, mr.nip);

    let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
    const kontesProduk = new Set<string>();
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
      if (getAllPakets(it.namaProduk).length > 0) kontesProduk.add(it.kodeProduk);
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
      variasiProdukKontes: kontesProduk.size,
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

  // ── Sheet 1: Semua Pengajuan ─────────────────────────────────────────────────

  // Column structure/headers match /api/poa/[id]/export/route.ts's
  // "Pengisian" sheet EXACTLY (2026-08-05, stakeholder request: "excelnya ASM
  // ... headernya samain sama header yang pengajuan versi MR juga") — same
  // header text, same combined-cell columns (KodePI - Nama Outlet, Nama User,
  // Item Kode - Nama Produk), same order. Only "Periode POA"/"Status
  // Approval" are prepended beyond the MR sheet's set: this sheet spans MANY
  // POAs (multiple MRs × multiple quarters) where the MR sheet covers
  // exactly one, so those two columns are the minimum needed to tell rows
  // apart — everything else lines up 1:1.
  const ws3 = wb.addWorksheet("Semua Pengajuan");
  const PCT_FMT = "0.0%";
  const RP_FMT = "#,##0";
  ws3.columns = [
    { header: "Periode POA",          key: "periodPoa",        width: 12 },
    { header: "Status Approval",      key: "statusApproval",   width: 22 },
    { header: "Nomor Rencana Pengajuan", key: "nomorRencana",  width: 12 },
    { header: "NIP MR/ SPV",          key: "nipMr",            width: 14 },
    { header: "Nama MR / SPV",        key: "namaMr",           width: 24 },
    { header: "Nama ASM",             key: "namaAsm",          width: 24 },
    { header: "Nama SM",              key: "namaSm",           width: 24 },
    { header: "Nama NSM",             key: "namaNsm",          width: 24 },
    { header: "KodePI - Nama Outlet", key: "outlet",           width: 32 },
    { header: "Spesialisasi",         key: "spesialisasi",     width: 22 },
    { header: "Nama User",            key: "namaUser",         width: 32 },
    { header: "Sumber User",          key: "sumberUser",       width: 14 },
    { header: "Label User",           key: "labelUser",        width: 20 },
    { header: "Nama Produk Kompetitor Utama", key: "produkKompetitor", width: 22 },
    { header: "Item Kode - Nama Produk ", key: "produk",       width: 32 },
    { header: "Kriteria Produk",      key: "kriteriaProduk",   width: 18 },
    { header: "Kategori/ Status Produk Kontes", key: "statusKontes", width: 16 },
    { header: "% Pelunasan Sebelumnya", key: "pelunasanSebelumnya", width: 16 },
    { header: "Estimasi PS/SP Sebelumnya", key: "estimasiSebelumnya", width: 18 },
    { header: "History Sales \n(B-12)", key: "historySales",  width: 16 },
    { header: "Status Listing Corporate", key: "statusStandarisasi", width: 20 },
    { header: "Jumlah Hari Praktek(Bulan)", key: "hariKerjaBulan", width: 14 },
    { header: "Jumlah R / Hari",      key: "jumlahResepHari",  width: 12 },
    { header: "Jumlah \nSatuan Terkecil (ST)\n/R", key: "qtyProdukResep", width: 14 },
    { header: "Satuan Terkecil\n(ST)", key: "satuanTerkecil",  width: 12 },
    { header: "Harga Satuan Terkecil Produk", key: "hargaSatuanTerkecil", width: 16 },
    { header: "Jumlah \nSatuan Jual(SJ)", key: "jumlahSJ",     width: 14 },
    { header: "Estimasi PS/SP Produk\n/Bulan", key: "estimasiBulan", width: 16 },
    { header: "Growth Estimasi PS/SP per Produk/ Bulan", key: "growthEstimasi", width: 16 },
    { header: "Total Estimasi PS/SP Produk \n/Bulan", key: "totalEstimasiBulan", width: 18 },
    { header: "Nilai R (%)",          key: "nilaiR",           width: 12 },
    { header: "Pengali PS/SP",        key: "pengaliPssp",      width: 12 },
    { header: "Nilai PS/SP Produk \n/Bulan", key: "nilaiPsspBulan", width: 16 },
    { header: "Total Nilai PS/SP Produk \n/Bulan", key: "totalNilaiPsspBulan", width: 18 },
    { header: "Jumlah Periode PS/SP (Bulan)", key: "periodePssp",     width: 16 },
    { header: "Periode Awal PS/SP (YYYYMM, contoh: 202601)", key: "periodeAwal", width: 16 },
    { header: "Periode Akhir PS/SP (YYYYMM, contoh: 202612)", key: "periodeAkhir", width: 16 },
    { header: "Estimasi PS/SP Produk \n/Periode", key: "estimasiPeriode", width: 18 },
    { header: "Total Estimasi PS/SP Produk \n/Periode", key: "totalEstimasiPeriode", width: 18 },
    { header: "Nilai PS/SP Produk \n/Periode", key: "nilaiPsspPeriode", width: 18 },
    { header: "Total Nilai PS/SP Produk \n/Periode", key: "totalNilaiPsspPeriode", width: 18 },
    { header: "Rasio Total Biaya(%Estimasi Sales)", key: "rasioTotalBiaya", width: 14 },
    { header: "Rencana Kunjungan/ Bulan", key: "rencanaKunjungan", width: 14 },
    { header: "% PS/SP User",         key: "persenPsspUser",   width: 12 },
    { header: "% Campaign (DPL/DPF)", key: "persenDiskon",     width: 14 },
    { header: "Periode Diskon",       key: "periodeDiskon",    width: 14 },
    { header: "% DP",                 key: "persenDp",         width: 10 },
    { header: "% Listing Fee",        key: "persenListingFee", width: 12 },
    { header: "% Entertaint",         key: "persenEntertain",  width: 12 },
    { header: "Total % Budget",       key: "totalPersenBudget", width: 14 },
    { header: "Warning/ Tagging",     key: "warning",          width: 16 },
    { header: "Approval SM",          key: "approvalSm",       width: 22 },
    { header: "Approval NSM",         key: "approvalNsm",      width: 22 },
    { header: "Status User",          key: "statusUser",       width: 12 },
    { header: "Historis PSSP",        key: "historisPssp",     width: 16 },
    { header: "Jenis PSSP",           key: "jenisPsspBentuk",  width: 12 },
    { header: "Keterangan Produk",    key: "statusProdukRekomendasi", width: 26 },
  ];
  styleHeader(ws3);

  // Build POA id → MR row map — one mrRows entry per actual POA now (see above),
  // so this covers every non-draft POA's line items, not just one per MR.
  const poaMRMap = new Map(
    mrRows.filter((r): r is MrRow & { poaId: string } => r.poaId !== null).map(r => [r.poaId, r])
  );

  // Doctor grouping — mirrors doctorKey() in /api/poa/[id]/export/route.ts,
  // scoped per-POA (poaId is part of the key) so multi-product rows for the
  // same doctor share one "Nomor Rencana Pengajuan" and the same group
  // totals, AND numbering restarts at 1 for each POA — same as what an MR
  // sees downloading their own POA solo, not one long climbing count across
  // every MR's submissions.
  function doctorKey(li: (typeof lineItems)[number]): string {
    return `${li.poaId}|${li.kodePI ?? ""}|${li.namaCust}`;
  }
  const groupNumberByKey = new Map<string, number>();
  const nextGroupNumberByPoa = new Map<string, number>();
  const groupTotals = new Map<string, { estimasiBulan: number; nilaiPsspBulan: number; estimasiPeriode: number; nilaiPsspPeriode: number }>();

  function computeItemValues(li: (typeof lineItems)[number]) {
    const totalBiaya = toNum(li.rencanaTotalBiaya);
    const lama = li.lamaPeriode || 1;
    const persenPsspDokter = toNum(li.persenPsspDokter);
    const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
    const nilaiPsspPeriode = totalBiaya * persenPsspDokter * pengaliNilaiR;
    return {
      estimasiBulan: totalBiaya / lama,
      nilaiPsspBulan: nilaiPsspPeriode / lama,
      estimasiPeriode: totalBiaya,
      nilaiPsspPeriode,
    };
  }

  for (const li of lineItems) {
    const key = doctorKey(li);
    if (!groupNumberByKey.has(key)) {
      const next = nextGroupNumberByPoa.get(li.poaId) ?? 1;
      groupNumberByKey.set(key, next);
      nextGroupNumberByPoa.set(li.poaId, next + 1);
    }
    const v = computeItemValues(li);
    const totals = groupTotals.get(key) ?? { estimasiBulan: 0, nilaiPsspBulan: 0, estimasiPeriode: 0, nilaiPsspPeriode: 0 };
    totals.estimasiBulan += v.estimasiBulan;
    totals.nilaiPsspBulan += v.nilaiPsspBulan;
    totals.estimasiPeriode += v.estimasiPeriode;
    totals.nilaiPsspPeriode += v.nilaiPsspPeriode;
    groupTotals.set(key, totals);
  }

  // Newest quarter first (same as "Per MR" above), then grouped by POA, then
  // by doctor group number within that POA — so products for the same
  // doctor stay adjacent instead of scattered by DB fetch order.
  const sortedLineItems = [...lineItems].sort((a, b) => {
    const pa = poaMRMap.get(a.poaId)?.period;
    const pb = poaMRMap.get(b.poaId)?.period;
    const periodDiff = periodSortKey(pb ?? "") - periodSortKey(pa ?? "");
    if (periodDiff !== 0) return periodDiff;
    if (a.poaId !== b.poaId) return a.poaId.localeCompare(b.poaId);
    return groupNumberByKey.get(doctorKey(a))! - groupNumberByKey.get(doctorKey(b))!;
  });

  const manualCustomerRows: number[] = [];
  for (const li of sortedLineItems) {
    const mr = poaMRMap.get(li.poaId);
    if (!mr) continue;

    const key = doctorKey(li);
    const v = computeItemValues(li);
    const totals = groupTotals.get(key)!;
    const product = productMapForPengajuan.get(li.kodeProduk) ?? null;

    const history = li.kodeCust ? psspHistoryMap.get(li.kodeCust) ?? [] : [];
    const hospinetPct = hospinetByDoctor.get(`${li.kodePI ?? ""}|${li.namaCust.trim().toUpperCase()}`)?.rr ?? null;
    const pelunasanPct = history.length > 0 ? computePelunasanPct(history) : hospinetPct;
    const estimasiSebelumnya = computeOldEstPerMonth(history, li.namaProduk);

    const statusUser = history.length === 0 ? "Baru" : "Retensi";
    const historisPssp = history.length === 0
      ? "Belum Pernah PSSP"
      : `PSSP ke-${new Set(history.map((r) => r.cUrut)).size}`;
    const jenisPsspBentuk = li.bentukPssp ? BENTUK_PSSP_LABELS[li.bentukPssp] ?? li.bentukPssp : "-";
    const namaProdukNorm = li.namaProduk.toLowerCase().trim();
    const surveyKodeProduk = li.kodeCust && li.kodePI ? surveyByOutletMap.get(`${li.kodeCust}|${li.kodePI}`) : undefined;
    const statusProdukRekomendasi = history.some((r) => r.nmProduk?.toLowerCase().trim() === namaProdukNorm)
      ? "Pernah PSSP"
      : getAllPakets(li.namaProduk).length > 0
      ? "Rekomendasi PM"
      : surveyKodeProduk?.has(li.kodeProduk)
      ? "Produk Survey"
      : li.kriteriaProduk?.startsWith("Produk Sudah Terstandarisasi")
      ? "Corporate Listing"
      : "Lainnya";
    // Same stale-snapshot fix as /api/poa/[id]/export/route.ts's labelUser
    // (2026-08-04/05) — li.labelCustomer is set once at line-item creation
    // and never recomputed, so a customer with no PSSP yet then but a real
    // contract synced in since keeps showing "Dokter Baru"/blank forever
    // otherwise.
    const labelUser = history.length > 0 && (!li.labelCustomer || li.labelCustomer === "Dokter Baru")
      ? "Pernah PSSP"
      : li.labelCustomer ?? "-";

    const hna = product ? parseFloat(product.hna.toString()) : 0;
    const jumlahSJ = hna > 0 ? v.estimasiPeriode / hna : null;
    // Nilai R (%) — Product.nilaiRPersen ONLY, same fix as the single-POA
    // export (2026-08-05): PoaLineItem.nilaiR is a different-scale field
    // (rupiah snapshot, not percent) and must never feed this cell.
    const nilaiR = product?.nilaiRPersen != null ? parseFloat(product.nilaiRPersen.toString()) : null;

    const periodeDiskon = li.kodePI
      ? resolveDiskonPeriodLabel(diskonByOutletMap.get(li.kodePI), diskonHistoryByOutletMap.get(li.kodePI), li.kodeProduk, li.periodeAwal)
      : "-";

    const persenPsspUser = toNum(li.persenPsspDokter);
    const persenDiskon = toNum(li.persenDiskon);
    const persenDp = toNum(li.persenDp);
    const persenListingFee = toNum(li.persenListingFee);
    const persenEntertain = toNum(li.persenEntertain);
    const totalPersenBudget = persenPsspUser + persenDiskon + persenDp + persenListingFee + persenEntertain;

    const row = ws3.addRow({
      periodPoa: mr.period ?? "-",
      statusApproval: mr.status.replace(/_/g, " "),
      nomorRencana: groupNumberByKey.get(key),
      nipMr: mr.nip,
      namaMr: mr.name,
      namaAsm: mr.asmName,
      namaSm: mr.smName,
      namaNsm: mr.nsmName,
      outlet: `${li.kodePI ?? "-"} - ${li.namaOutlet}`,
      spesialisasi: spesLabel(li.spesialisasi),
      namaUser: `${li.kodeCust ?? "-"} - ${li.namaCust}`,
      sumberUser: li.isManualCustomer ? "Manual (Belum Terdaftar)" : "Terdaftar",
      labelUser,
      produkKompetitor: li.produkKompetitor ?? "-",
      produk: `${li.itemKode} - ${li.namaProduk}`,
      kriteriaProduk: li.kriteriaProduk ?? "-",
      statusKontes: getAllPakets(li.namaProduk).length > 0 ? "Y" : "N",
      pelunasanSebelumnya: pelunasanPct,
      estimasiSebelumnya,
      historySales: li.historySales3Bln != null ? parseFloat(li.historySales3Bln.toString()) : null,
      statusStandarisasi: li.statusStandarisasi?.replace(/_/g, " ") ?? "-",
      hariKerjaBulan: li.hariKerjaBulan,
      jumlahResepHari: li.jumlahResepHari,
      qtyProdukResep: li.qtyProdukResep,
      satuanTerkecil: li.satuanTerkecil,
      hargaSatuanTerkecil: li.hargaSatuanTerkecil != null ? parseFloat(li.hargaSatuanTerkecil.toString()) : null,
      jumlahSJ,
      estimasiBulan: v.estimasiBulan,
      growthEstimasi: li.rasioEstimasiGrowth != null ? parseFloat(li.rasioEstimasiGrowth.toString()) : null,
      totalEstimasiBulan: totals.estimasiBulan,
      nilaiR,
      pengaliPssp: li.pengaliNilaiR != null ? parseFloat(li.pengaliNilaiR.toString()) : null,
      nilaiPsspBulan: v.nilaiPsspBulan,
      totalNilaiPsspBulan: totals.nilaiPsspBulan,
      periodePssp: li.lamaPeriode,
      periodeAwal: li.periodeAwal,
      periodeAkhir: computePeriodeAkhir(li.periodeAwal, li.lamaPeriode),
      estimasiPeriode: v.estimasiPeriode,
      totalEstimasiPeriode: totals.estimasiPeriode,
      nilaiPsspPeriode: v.nilaiPsspPeriode,
      totalNilaiPsspPeriode: totals.nilaiPsspPeriode,
      rasioTotalBiaya: v.estimasiPeriode > 0 ? v.nilaiPsspPeriode / v.estimasiPeriode : null,
      rencanaKunjungan: li.rencanaVisitMinggu,
      persenPsspUser,
      persenDiskon,
      periodeDiskon,
      persenDp,
      persenListingFee,
      persenEntertain,
      totalPersenBudget,
      warning: totalPersenBudget > 0.425 ? "OVER BUDGET" : totalPersenBudget > 0 ? "SAFE" : "-",
      approvalSm: approvalLabel(li.poaId, "APPROVED_BY_SM"),
      approvalNsm: approvalLabel(li.poaId, "APPROVED_BY_NSM"),
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
    if (li.isManualCustomer) manualCustomerRows.push(row.number);
  }

  // Applied after the per-cell numFmt loop above so the manual-doctor
  // highlight isn't overwritten by the alternating-row shading below.
  shadeAlt(ws3, 1);
  for (const rowNum of manualCustomerRows) {
    for (const key of ["namaUser", "sumberUser"]) {
      const cell = ws3.getRow(rowNum).getCell(key);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
      cell.font = { color: { argb: "FF856404" }, bold: key === "sumberUser" };
    }
  }

  if (lineItems.length === 0) ws3.addRow(["(Belum ada data pengajuan)"]);

  // ── Sheet 2: PSSP Aktif ──────────────────────────────────────────────────────
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
    { header: "Jumlah Periode (Bulan)", key: "jumlahPeriode", width: 16 },
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
      jumlahPeriode: computeJumlahPeriode(r.prdAwal, r.prdAkhir),
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
      jumlahPeriode: r.periodeAwal && r.periodeAkhir ? computeJumlahPeriode(r.periodeAwal, r.periodeAkhir) : "—",
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
