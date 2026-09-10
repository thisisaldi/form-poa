/**
 * GET /api/export/team?period=2026-Q3
 *
 * Bulk Excel export for NSM/SM/ASM/ADMIN/GM/SFE/VIEWER — all POA data for
 * their subordinate MRs (or company-wide for the latter 4).
 * `period` defaults to the CURRENT quarter when omitted (2026-08-26 —
 * previously unbounded/all-history by default, which caused live 502s for
 * ADMIN/GM/SFE/VIEWER's company-wide scope; see the `period` assignment
 * below for the full history).
 *
 * Sheets 1/2/5-10 are gated behind `fullReportScope` (ASM/SM/NSM only,
 * 2026-08-28) — ADMIN/GM/SFE/VIEWER's company-wide scope made those sheets'
 * extra queries (esp. the per-outlet Nexus spesialisasi lookup ahead of
 * Sheet 9, measured ~96s company-wide) this route's reported 502/500 cause,
 * so those roles get just Sheets 3-4 (Semua Pengajuan + PSSP Aktif).
 * Sheets:
 *   1. Ringkasan Tim     — aggregate totals                          [ASM/SM/NSM only]
 *   2. Per MR            — one row per MR with key metrics           [ASM/SM/NSM only]
 *   3. Semua Pengajuan   — all line items across all POAs
 *   4. PSSP Aktif        — every still-running PSSP contract + Hospinet snapshot
 *   5. Summary Per Outlet — same metrics as the /summary "Per Outlet" tab (#47),
 *                           scoped to this export's team (2026-07-27, #55)   [ASM/SM/NSM only]
 *   6. Summary by Produk  — same metrics as the /summary "Per Produk" tab,
 *                           scoped to this export's team (2026-07-28, #6)   [ASM/SM/NSM only]
 *   7. Summary Ringkasan  — grand-total cards from the /summary "Ringkasan" tab,
 *                           scoped to this export's team + a single quarter
 *                           (2026-08-13, stakeholder #15)   [ASM/SM/NSM only]
 *   8. Summary Per Personil    — "Per Personil" tab, same Outlet/Produk-sheet
 *                                metric shape, grouped by MR instead (#15)   [ASM/SM/NSM only]
 *   9. Summary Per Customer    — "Per Customer" tab, ditto, grouped by customer (#15)   [ASM/SM/NSM only]
 *  10. Summary Per Spesialisasi — "Per Spesialisasi" tab, ditto, grouped by
 *                                 spesialisasi label (#15)   [ASM/SM/NSM only]
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateOwnerNips } from "@/lib/authz";
import { getActivePsspByOutlets, getHospinetSnapshotsByOutlets, getPsspHistoryByCustomers, getSurveyRekomendasiByCustomers, getDiskonByOutlets, getDiskonHistoryByOutlets, getNexusSpesialisasiByOutlets, type PsspKontrakSummary, type DiskonByProduct, type DiskonHistoryByProduct } from "@/app/actions/customer";
import { getAllPakets } from "@/lib/paketProduk";
import { computePeriodeAkhir, formatPeriode, computeMonthlyBreakdown, computeJumlahPeriode } from "@/lib/poaUtils";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { spesLabel } from "@/lib/spesialisasi";
import { displayRole } from "@/lib/role";

// Canonical display order for the "Estimasi PSSP per Bulan" level breakdown
// — matches the KPI memo's personnel levels (MR, SPV, ASM, SM Hospital), not
// necessarily who actually owns POAs in this export's scope (see sheet
// comment below: this export is MR-subtree-only, so ASM/SM rows are normally
// empty unless a vacant-team ASM/SM owns a POA directly, see canCreatePoa).
const PSSP_LEVEL_ORDER = ["MR", "SPV", "ASM", "SM", "NSM"];

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
// Export Excel TETAP pakai angka asli (bukan skala ÷1.000.000 yang dipakai
// tampilan in-app) — dikonfirmasi pengguna 2026-08-10, membatalkan asumsi
// OQ-2 sebelumnya di docs/label-currency-format-updates/01-business-rules.md.
const fmtRp = (n: number) => Math.round(n).toLocaleString("id-ID");

// "Jenis PSSP" export label — mirrors the same map in /api/poa/[id]/export
// (BentukPssp enum, schema.prisma).
const BENTUK_PSSP_LABELS: Record<string, string> = {
  CASH: "Cash",
  BARANG: "Barang",
  JASA: "Jasa",
  PRIMATAX: "Primatax",
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
  //
  // `?period=all` (2026-08-31, explicit user action per docs/PERFORMANCE.md
  // §2 point 3 — "opsi lihat semua harus eksplisit, bukan default") opts back
  // into unbounded history, for every role including ADMIN/GM/SFE/VIEWER's
  // company-wide scope (explicit stakeholder request, accepting the risk
  // flagged in PERFORMANCE.md). The `fullReportScope` trim below (2 sheets
  // only for company-wide roles, same as the current-quarter default) is the
  // guard that keeps this from reintroducing the ~96s/502 case #47 already
  // fixed — if "Semua Periode" turns out too slow for company-wide roles even
  // trimmed, the next step is the snapshot approach PERFORMANCE.md §2.5
  // describes, not widening the on-demand query further.
  const fullReportScope = (["ASM", "SM", "NSM"] as string[]).includes(session.role);
  const periodParam = req.nextUrl.searchParams.get("period");
  const period = periodParam === "all" ? null : (periodParam ?? currentQuarter());

  // ── Query data ──────────────────────────────────────────────────────────────
  //
  // Restructured 2026-08-31 (still hitting 502 for ADMIN's company-wide scope
  // even after the earlier trim-to-2-sheets fix): every query below used to
  // be a single sequential `await` chain even where two branches had NO data
  // dependency on each other (e.g. `poas` never needed `assignments`/
  // `mrUsers` — it only needs `mrNips`, known from the top of the function;
  // `auditLogsAll` only needs `poaIds`, not `lineItems`/the history/diskon
  // chain that came before it). Measured live company-wide: mrOutletAssignment
  // ~4200 outlets, poaLineItem ~8000 rows, psspKontrak ~6000+6000 rows,
  // surveyRekomendasi ~9000 rows — each a few seconds, and purely additive
  // when awaited one after another (13-15s+ before any Excel work even
  // starts). Grouping the truly-independent branches into `Promise.all`
  // (same fan-out pattern as the existing PSSP/history/diskon pairs below)
  // cuts that to the length of the LONGEST chain instead of the SUM of all
  // of them — no change to what's queried or how rows are computed.

  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips } };
  if (period) poaWhere.period = period;

  // Both narrowed to a `select` (2026-08-31, were full-row fetches — `owner:
  // true` in particular pulled every User column, e.g. sippAbsPtId/syncedAt/
  // kodeWilayah, for each POA row) — matters most with `?period=all`, where
  // `poas` can be every non-draft POA a team has ever submitted.
  const [mrUsers, poas] = await Promise.all([
    prisma.user.findMany({
      where: { nip: { in: mrNips } },
      select: { nip: true, name: true, nipAtasan: true, isDummy: true },
      orderBy: { name: "asc" },
    }) as Promise<{ nip: string; name: string; nipAtasan: string | null; isDummy: boolean }[]>,
    // Unlike the web UI's canView (which keeps DRAFT/REVISI private to the MR
    // until submitted), this team rekap includes every status — a manager
    // exporting their team's numbers wants to see real in-progress work too,
    // not "BELUM SUBMIT" with everything at 0 (2026-07-22, business owner:
    // "jangan [sengaja 0-in], tampilkan saja" re-scoping this specifically
    // for the export, not the rest of the app's approval-flow visibility
    // rules). Only needs `mrNips`/`poaWhere` — independent of `mrUsers`.
    prisma.poaForm.findMany({
      where: poaWhere,
      select: {
        id: true, ownerId: true, period: true, status: true, createdAt: true, updatedAt: true, target: true,
        owner: { select: { nip: true, name: true, role: true, jabatan: true } },
      },
      orderBy: { updatedAt: "desc" },
    }) as Promise<{ id: string; ownerId: string; period: string; status: string; createdAt: Date; updatedAt: Date; target: { toString(): string } | null; owner: { nip: string; name: string; role: string; jabatan: string | null } }[]>,
  ]);

  const poaIds = poas.map(p => p.id);

  // ── Branch 1: active PSSP contracts + org-struktur text across every
  //    subordinate MR's outlet territory — depends on `mrUsers` only.
  const outletBranch = (async () => {
    const realMrNips = mrUsers.filter(m => !m.isDummy).map(m => m.nip);
    const assignments = realMrNips.length > 0
      ? await prisma.mrOutletAssignment.findMany({
          where: { nipMR: { in: realMrNips }, periode: (() => { const now = new Date(); return now.getFullYear() * 100 + (now.getMonth() + 1); })() },
          select: { kodePI: true, nipMR: true },
        })
      : [];
    const assignedOutlets = assignments.map((a: { kodePI: string }) => a.kodePI);
    type StrukturRow = { kodePI: string; asmNama: string | null; smNama: string | null; nsmNama: string | null };
    const [activePsspAll, hospinetSnapshotsAll, strukturRows] = assignedOutlets.length > 0
      ? await Promise.all([
          getActivePsspByOutlets(assignedOutlets),
          getHospinetSnapshotsByOutlets(assignedOutlets),
          // Raw org-structure text per outlet (includes "(VACANT) ..."/"DUMMY ..."
          // placeholder names for unfilled ASM/SM/NSM positions) — OutletStrukturBaru
          // is the staging copy of the source file, refreshed wholesale on import,
          // and unlike the User table it does NOT skip placeholder rows (see
          // importStrukturVerifiedKAM.ts). Used below as a fallback so a genuinely
          // vacant level shows its real placeholder label instead of "—" (2026-07-24
          // request) — the nipAtasan hierarchy chain itself skip-links straight past
          // vacant levels by design (that's what makes approval-routing skip them),
          // so it alone can never recover this text.
          prisma.outletStrukturBaru.findMany({
            where: { kodePI: { in: assignedOutlets } },
            select: { kodePI: true, asmNama: true, smNama: true, nsmNama: true },
          }) as Promise<StrukturRow[]>,
        ])
      : [[], [], [] as StrukturRow[]];
    return { assignments, assignedOutlets, activePsspAll, hospinetSnapshotsAll, strukturRows };
  })();

  // ── Branch 2: ASM → SM → NSM hierarchy walk — depends on `mrUsers` only,
  //    independent of the outlet/PSSP branch above and the POA/line-item
  //    branch below.
  const hierarchyBranch = (async () => {
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

    return hierMap;
  })();

  // ── Branch 3: line items + everything derived from them (PSSP history,
  //    survey recommendations, diskon, product master) + per-POA audit logs
  //    — depends on `poaIds` only.
  const lineItemBranch = (async () => {
    // Explicit `select` (2026-08-31, was a full-row fetch — the `as` cast
    // below already documented exactly which columns are used; PoaLineItem
    // has several more columns than that — kodeRequest, historisPSSP,
    // jenisPssp, pihakPssp, jenisPsSp, surveyPasienHarian, etc — that were
    // being pulled and serialized over the wire for nothing. Matters most
    // here: with `?period=all` (added same day) this can be every line item
    // company-wide across all history, not just one quarter.
    const lineItems = poaIds.length > 0
      ? await prisma.poaLineItem.findMany({
          where: { poaId: { in: poaIds } },
          select: {
            id: true, poaId: true, kodePI: true, namaOutlet: true,
            namaCust: true, kodeCust: true, spesialisasi: true, role: true,
            isManualCustomer: true,
            kodeProduk: true, namaProduk: true, itemKode: true, satuanTerkecil: true,
            periodeAwal: true, lamaPeriode: true,
            statusStandarisasi: true, rencanaTotalBiaya: true,
            rencanaVisitMinggu: true, hariKerjaBulan: true,
            jumlahResepHari: true, qtyProdukResep: true, jumlahPasienHari: true,
            persenPsspDokter: true,
            persenDiskon: true, persenDp: true,
            persenListingFee: true, persenEntertain: true,
            pengaliNilaiR: true,
            hargaSatuanTerkecil: true,
            historySales3Bln: true,
            rasioEstimasiGrowth: true,
            labelCustomer: true,
            produkKompetitor: true,
            bentukPssp: true,
            kriteriaProduk: true,
          },
        }) as {
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

    // PSSP history + survey recommendations (for "Historis PSSP" / "Jenis
    // PSSP" / "Keterangan Produk" columns on "Semua Pengajuan") + "Periode
    // Diskon" column data + product master (hna/nilaiRPersen) — all batched
    // (2026-08-18/08-05 fixes, see getPsspHistoryByCustomers/
    // getSurveyRekomendasiByCustomers/getDiskonByOutlets doc comments for the
    // per-row-loop incidents these replaced), and all independent of each
    // other once `lineItems` is known, so they fan out together too.
    const distinctKodeCust = [...new Set(lineItems.map((li) => li.kodeCust).filter((k): k is string => !!k))];
    const distinctKodePI = [...new Set(lineItems.map((li) => li.kodePI).filter((k): k is string => !!k))];
    const productCodesInLineItems = [...new Set(lineItems.map((li) => li.kodeProduk))];

    const [psspHistoryMap, surveyRowsByKey, diskonByOutletMap, diskonHistoryByOutletMap, productRowsForPengajuan] = await Promise.all([
      getPsspHistoryByCustomers(distinctKodeCust),
      getSurveyRekomendasiByCustomers(distinctKodeCust),
      getDiskonByOutlets(distinctKodePI),
      getDiskonHistoryByOutlets(distinctKodePI),
      productCodesInLineItems.length > 0
        ? prisma.product.findMany({
            where: { kodeProduk: { in: productCodesInLineItems } },
            select: { kodeProduk: true, hna: true, nilaiRPersen: true },
          }) as Promise<{ kodeProduk: string; hna: { toString(): string }; nilaiRPersen: { toString(): string } | null }[]>
        : Promise.resolve([]),
    ]);

    return { lineItems, psspHistoryMap, surveyRowsByKey, diskonByOutletMap, diskonHistoryByOutletMap, productRowsForPengajuan };
  })();

  // approvalLabel() below only ever looks at action="APPROVE" rows and only
  // reads toStatus/createdAt/actor.name — narrowed from a full-row + full-actor
  // fetch (2026-08-21 fix, docs/PERFORMANCE.md §2 point 3: company-wide scope
  // was pulling 35k+ audit rows — including every non-APPROVE action ever
  // logged, unbounded by period — for just 406 POAs, timing out as a 502 on
  // the reverse proxy). Filtering action="APPROVE" server-side plus a narrow
  // `select` cuts both row count and per-row payload. Depends on `poaIds`
  // only — independent of `lineItemBranch`, so it runs alongside it instead
  // of after it.
  const auditLogsPromise = poaIds.length > 0
    ? prisma.poaAuditLog.findMany({
        where: { poaId: { in: poaIds }, action: "APPROVE" },
        select: { poaId: true, action: true, toStatus: true, createdAt: true, actor: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }) as Promise<{ poaId: string; action: string; toStatus: string; createdAt: Date; actor: { name: string } }[]>
    : Promise.resolve([]);

  const [outlet, hierMap, lineItemData, auditLogsAll] = await Promise.all([
    outletBranch, hierarchyBranch, lineItemBranch, auditLogsPromise,
  ]);
  const { assignments, assignedOutlets, activePsspAll, hospinetSnapshotsAll, strukturRows } = outlet;
  const { lineItems, psspHistoryMap, surveyRowsByKey, diskonByOutletMap, diskonHistoryByOutletMap, productRowsForPengajuan } = lineItemData;

  const outletToMR = new Map<string, string>(assignments.map((a: { kodePI: string; nipMR: string }) => [a.kodePI, a.nipMR]));
  const mrToOutlets = new Map<string, string[]>();
  for (const a of assignments as { kodePI: string; nipMR: string }[]) {
    const list = mrToOutlets.get(a.nipMR) ?? [];
    list.push(a.kodePI);
    mrToOutlets.set(a.nipMR, list);
  }
  const strukturByOutlet = new Map<string, typeof strukturRows[number]>(strukturRows.map((r) => [r.kodePI, r]));

  const surveyByOutletMap = new Map<string, Set<string>>();
  for (const [key, rows] of surveyRowsByKey) {
    surveyByOutletMap.set(key, new Set(rows.map((r) => r.kodeProduk)));
  }

  const productMapForPengajuan = new Map(productRowsForPengajuan.map((p) => [p.kodeProduk, p]));

  const hospinetByDoctor = new Map(
    hospinetSnapshotsAll.map((s) => [`${s.kodePI}|${s.namaCustomer.trim().toUpperCase()}`, s])
  );

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

  // ── ASM → SM → NSM hierarchy map ────────────────────────────────────────────
  // Built above in `hierarchyBranch` (runs in parallel with the outlet/PSSP
  // and line-item branches) — `hierMap` is already in scope here.

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

  // Shared style objects, reused by reference across every cell they're
  // applied to (2026-09-04 fix — shadeAlt previously allocated a brand-new
  // `{ type, pattern, fgColor: {...} }` object PER CELL, e.g. ~450k
  // allocations for Sheet3 alone at company-wide row/column counts, which is
  // real CPU/GC cost under the prod pod's 500m CPU / 512Mi memory limit
  // (k8s/values.yaml) — root cause of `/api/export/team` timing out for
  // ADMIN/GM/SFE/VIEWER's company-wide scope while MR/ASM/SM/NSM's small-team
  // scope stayed fine. ExcelJS only ever reads this object at serialize time,
  // never mutates it, so every cell/row can safely share one instance.
  const HEADER_FONT = { bold: true, color: { argb: WHITE } };
  const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  const HEADER_ALIGN: Partial<ExcelJS.Alignment> = { vertical: "middle", wrapText: false };
  const ALT_ROW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };

  function styleHeader(ws: ExcelJS.Worksheet) {
    ws.getRow(1).eachCell(cell => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = HEADER_ALIGN;
    });
    ws.getRow(1).height = 20;
  }

  function shadeAlt(ws: ExcelJS.Worksheet, fromRow: number) {
    ws.eachRow((row, rn) => {
      if (rn <= fromRow) return;
      if (rn % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = ALT_ROW_FILL;
        });
      }
    });
  }

  // Shared by Sheet 1 (Ringkasan Tim) and Sheet 7 (Summary Ringkasan) — kept
  // at this scope (not nested in the fullReportScope block below) so both
  // gated sections can use them.
  function addKv(ws: ExcelJS.Worksheet, label: string, value: string | number, bold = false) {
    const row = ws.addRow([label, value]);
    row.getCell(2).alignment = { horizontal: "right" };
    if (bold) row.font = { bold: true };
  }
  function addDivider(ws: ExcelJS.Worksheet, title: string) {
    ws.addRow([]);
    const row = ws.addRow([title]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, color: { argb: WHITE } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    row.height = 18;
  }

  // Sheets 1/2/"Estimasi PSSP per Bulan" below are ASM/SM/NSM-only (see
  // fullReportScope above) — skipped entirely for ADMIN/GM/SFE/VIEWER.
  if (fullReportScope) {

  // ── Sheet 1: Ringkasan Tim ──────────────────────────────────────────────────

  const totalEst     = mrRows.reduce((s, r) => s + r.estimasi, 0);
  const totalPssp    = mrRows.reduce((s, r) => s + r.psspTotal, 0);
  const totalDisc    = mrRows.reduce((s, r) => s + r.discountTotal, 0);
  const totalEnt     = mrRows.reduce((s, r) => s + r.entertainTotal, 0);
  const totalBudget  = mrRows.reduce((s, r) => s + r.budgetTotal, 0);
  const totalCust    = new Set(lineItems.map(li => li.namaCust)).size;
  const totalKontes  = new Set(lineItems.filter(li => getAllPakets(li.namaProduk).length > 0).map(li => li.kodeProduk)).size;
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

  ws1.addRow(["Laporan Rekap POA"]);
  ws1.getRow(1).font = { bold: true, size: 14 };
  ws1.addRow(["Diekspor oleh", `${session.name} (${session.role})`]);
  ws1.addRow(["Tanggal export", new Date().toLocaleDateString("id-ID")]);
  if (period) ws1.addRow(["Periode", period]);
  ws1.addRow([]);

  addDivider(ws1, "Progres Submit");
  addKv(ws1, "Total MR", mrUsers.length);
  addKv(ws1, "Sudah submit", mrSubmitted);
  addKv(ws1, "Belum submit", mrUsers.length - mrSubmitted);

  addDivider(ws1, "Estimasi & Anggaran");
  addKv(ws1, "Total Estimasi POA",       fmtRp(totalEst), true);
  addKv(ws1, "Total PSSP",               fmtRp(totalPssp));
  addKv(ws1, "Total Campaign / DPL / DPF", fmtRp(totalDisc));
  addKv(ws1, "Total ENT",                fmtRp(totalEnt));
  addKv(ws1, "Total Budget",             fmtRp(totalBudget), true);
  addKv(ws1, "% Budget / Estimasi",      totalEst > 0 ? `${((totalBudget / totalEst) * 100).toFixed(1)}%` : "—");

  addDivider(ws1, "Cakupan");
  addKv(ws1, "Total Customer (unik)",     totalCust);
  addKv(ws1, "Variasi Produk Kontes (unik)", totalKontes);
  addKv(ws1, "Total Baris Pengajuan",    totalPengaj);

  addDivider(ws1, "Listing Produk");
  addKv(ws1, "Sudah Listing",            totalSudah);
  addKv(ws1, "Proses Pengajuan",         totalProses);
  addKv(ws1, "Belum Listing",            totalBelum);

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
    { header: "Campaign / DPL / DPF", key: "discount",    width: 22 },
    { header: "ENT",              key: "entertain",      width: 18 },
    { header: "Total Budget",     key: "budget",         width: 18 },
    { header: "% Budget",         key: "budgetPct",      width: 12 },
    { header: "Customer",         key: "customer",       width: 12 },
    { header: "Produk Kontes",    key: "kontes",         width: 14 },
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
      customer: r.customerCount, kontes: r.variasiProdukKontes, pengajuan: r.totalPengajuan,
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

  // ── Sheet: Estimasi PSSP per Bulan ────────────────────────────────────────
  // Breaks each line item's Estimasi (rencanaTotalBiaya) and Nilai PSSP
  // (rencanaTotalBiaya × %PSSP dokter × pengaliNilaiR — same formula as the
  // "PSSP" column on "Per MR" above, just not yet summed across the whole
  // lamaPeriode) evenly across every month in its periodeAwal–periodeAkhir
  // span, then rolls up by the owning POA's personnel level (MR/SPV/ASM/SM —
  // jabatan-aware via displayRole, see src/lib/role.ts). No other basis
  // exists to distribute non-uniformly (2026-08-03, confirmed with business:
  // rata rata per bulan is the accepted approximation, not a real monthly
  // run-rate). Shared computeMonthlyBreakdown() also backs the same table in
  // the app's "Ringkasan POA" panel (StatsPanel) so this isn't Excel-only.
  const poaIdToLevel = new Map(poas.map((p) => [p.id, displayRole(p.owner.role, p.owner.jabatan)]));
  const itemsByLevel = new Map<string, typeof lineItems>();
  for (const li of lineItems) {
    const level = poaIdToLevel.get(li.poaId);
    if (!level) continue;
    const arr = itemsByLevel.get(level) ?? [];
    arr.push(li);
    itemsByLevel.set(level, arr);
  }
  const breakdownByLevel = new Map<string, Map<string, { estimasi: number; nilaiPssp: number }>>();
  const allPsspMonths = new Set<string>();
  for (const [level, items] of itemsByLevel) {
    const monthMap = computeMonthlyBreakdown(items);
    breakdownByLevel.set(level, monthMap);
    for (const m of monthMap.keys()) allPsspMonths.add(m);
  }
  const psspMonthsSorted = [...allPsspMonths].sort();
  const psspLevelsPresent = PSSP_LEVEL_ORDER.filter((lv) => breakdownByLevel.has(lv));

  const wsPssp = wb.addWorksheet("Estimasi PSSP per Bulan");
  wsPssp.columns = [
    { header: "Level", key: "level", width: 14 },
    { header: "Metrik", key: "metrik", width: 14 },
    ...psspMonthsSorted.map((m) => ({ header: formatPeriode(m), key: m, width: 16 })),
  ];
  styleHeader(wsPssp);
  for (const level of psspLevelsPresent) {
    const monthMap = breakdownByLevel.get(level)!;
    const estimasiRow: Record<string, string | number> = { level, metrik: "Estimasi" };
    const nilaiPsspRow: Record<string, string | number> = { level, metrik: "Nilai PSSP" };
    for (const m of psspMonthsSorted) {
      const v = monthMap.get(m) ?? { estimasi: 0, nilaiPssp: 0 };
      estimasiRow[m] = Math.round(v.estimasi);
      nilaiPsspRow[m] = Math.round(v.nilaiPssp);
    }
    wsPssp.addRow(estimasiRow);
    wsPssp.addRow(nilaiPsspRow);
  }
  psspMonthsSorted.forEach((m) => { wsPssp.getColumn(m).numFmt = '#,##0'; });
  shadeAlt(wsPssp, 1);
  if (psspLevelsPresent.length === 0) wsPssp.addRow(["(Tidak ada data Estimasi PSSP)"]);

  } // end fullReportScope (Sheets 1/2/Estimasi PSSP per Bulan)

  // ── Sheet 3: Semua Pengajuan ─────────────────────────────────────────────────

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
    { header: "ESTIMASI PS/SP RENCANA Sebelumnya", key: "estimasiSebelumnya", width: 18 },
    { header: "History Sales \n(B-12)", key: "historySales",  width: 16 },
    { header: "Status Listing Corporate", key: "statusStandarisasi", width: 20 },
    { header: "Jumlah Hari Praktek(Bulan)", key: "hariKerjaBulan", width: 14 },
    { header: "Jumlah R / Hari",      key: "jumlahResepHari",  width: 12 },
    { header: "Jumlah \nSatuan Terkecil (ST)\n/R", key: "qtyProdukResep", width: 14 },
    { header: "Satuan Terkecil\n(ST)", key: "satuanTerkecil",  width: 12 },
    { header: "Harga Satuan Terkecil Produk", key: "hargaSatuanTerkecil", width: 16 },
    { header: "Jumlah \nSatuan Jual(SJ)", key: "jumlahSJ",     width: 14 },
    { header: "ESTIMASI PS/SP RENCANA Produk\n/Bulan", key: "estimasiBulan", width: 16 },
    { header: "Growth ESTIMASI PS/SP RENCANA per Produk/ Bulan", key: "growthEstimasi", width: 16 },
    { header: "Total ESTIMASI PS/SP RENCANA Produk \n/Bulan", key: "totalEstimasiBulan", width: 18 },
    { header: "Nilai R (%)",          key: "nilaiR",           width: 12 },
    { header: "Pengali PS/SP",        key: "pengaliPssp",      width: 12 },
    { header: "Nilai PS/SP Produk \n/Bulan", key: "nilaiPsspBulan", width: 16 },
    { header: "Total Nilai PS/SP Produk \n/Bulan", key: "totalNilaiPsspBulan", width: 18 },
    { header: "Jumlah Periode PS/SP (Bulan)", key: "periodePssp",     width: 16 },
    { header: "Periode Awal PS/SP (YYYYMM, contoh: 202601)", key: "periodeAwal", width: 16 },
    { header: "Periode Akhir PS/SP (YYYYMM, contoh: 202612)", key: "periodeAkhir", width: 16 },
    { header: "ESTIMASI PS/SP RENCANA Produk \n/Periode", key: "estimasiPeriode", width: 18 },
    { header: "Total ESTIMASI PS/SP RENCANA Produk \n/Periode", key: "totalEstimasiPeriode", width: 18 },
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

  // Sheets 5-10 below are ASM/SM/NSM-only (see fullReportScope above) —
  // skipped entirely for ADMIN/GM/SFE/VIEWER, whose company-wide scope made
  // these queries (esp. the per-outlet Nexus spesialisasi lookup ahead of
  // Sheet 9, measured ~96s company-wide) this route's reported 502/500 cause.
  if (fullReportScope) {

  // ── Sheet 5: Summary Per Outlet ──────────────────────────────────────────────
  // Same metrics as the /summary "Per Outlet" tab (src/app/(app)/summary/page.tsx,
  // #47 2026-07-27) — reused here scoped to THIS export's team instead of
  // globally: Estimasi Aktif+Pengajuan, Jumlah User PSSP (Aktif+Estimasi),
  // Variasi Produk (Kontes/Non-Kontes), Budget, Cost Ratio, Sales Aktif (2026),
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
    variasiProduk: number; variasiProdukKontes: number;
    budgetTotal: number; biayaAktif: number; salesAktif: number; listingFeeTotal: number;
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
    // PsspKontrak.biaya is a flat per-CONTRACT total repeated on every product
    // row of that contract — dedupe by cUrut before summing (same fix as
    // Biaya Aktif in the produk sheet below / src/app/(app)/summary/page.tsx).
    // Missing here entirely was the bug (2026-07-30 report: "cost ratio di
    // excel ada yang salah") — Cost Ratio below used to divide
    // Pengajuan-only budgetTotal/estimasi, silently dropping the Aktif side
    // out of both the numerator and denominator instead of matching the web
    // Summary "Per Outlet" tab's combined (biayaAktif+budgetTotal)/(estimasiAktif+estimasi).
    const seenContracts = new Set<string>();
    let biayaAktif = 0;
    for (const r of activeRows) {
      if (seenContracts.has(r.cUrut)) continue;
      seenContracts.add(r.cUrut);
      biayaAktif += r.biaya;
    }
    const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
    const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
    const userCount = new Set([...activeCustKeys, ...draftCustKeys]).size;
    return {
      kodePI, namaOutlet,
      estimasi, estimasiAktif, userCount,
      variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
      variasiProdukKontes: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      biayaAktif,
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
    { header: "Variasi Produk Kontes",        key: "variasiProdukKontes",    width: 16 },
    { header: "Variasi Produk Non-Kontes",    key: "variasiProdukNonKontes", width: 18 },
    { header: "Budget",                       key: "budget",                width: 18 },
    { header: "Cost Ratio",                   key: "costRatio",             width: 12 },
    { header: "Sales Aktif (2026)",           key: "salesAktif",            width: 18 },
    { header: "Estimasi Per User",            key: "estimasiPerUser",       width: 18 },
    { header: "Listing Fee",                  key: "listingFee",            width: 16 },
  ];
  styleHeader(ws5);

  for (const r of outletSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const biayaAktifPengajuan = r.biayaAktif + r.budgetTotal;
    const costRatio = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : 0;
    ws5.addRow({
      kodePI: r.kodePI, namaOutlet: r.namaOutlet,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      userCount: r.userCount,
      variasiProdukKontes: r.variasiProdukKontes,
      variasiProdukNonKontes: r.variasiProduk - r.variasiProdukKontes,
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

  // ── Sheet 7: Summary Ringkasan ──────────────────────────────────────────────
  // Mirrors the /summary "Ringkasan" tab's grand-total cards (docs/summary-ringkasan),
  // scoped to this export's team. Unlike every tab/sheet above, the live Ringkasan
  // tab is filtered to exactly ONE quarter (`RingkasanQuarterFilter`), not a period
  // range — this route only ever accepts a single `?period=` value already (never a
  // range), so the fit is direct: reuse that SAME param as the Ringkasan quarter.
  // ASSUMPTION (stakeholder #15, no range→quarter rule specified): when `?period=`
  // is omitted (this export's "all periods" default), Ringkasan falls back to the
  // real calendar current quarter — same default `/summary` itself uses when its
  // own filter is unset — rather than trying to collapse an unbounded multi-quarter
  // export into one card.
  const RINGKASAN_QUARTER = period && /^\d{4}-Q[1-4]$/.test(period) ? period : currentQuarter();
  const ringkasanQMonths = quarterToMonths(RINGKASAN_QUARTER);

  // Duplicated from src/app/(app)/summary/page.tsx (same file-wide convention as
  // BENTUK_PSSP_LABELS/resolveDiskonPeriodLabel above — no shared lib module yet).
  function monthsInRangeExport(prdAwal: string, prdAkhir: string): string[] {
    const months: string[] = [];
    let y = parseInt(prdAwal.slice(0, 4), 10), m = parseInt(prdAwal.slice(4), 10);
    const ey = parseInt(prdAkhir.slice(0, 4), 10), em = parseInt(prdAkhir.slice(4), 10);
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard < 240) {
      months.push(`${y}${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
      guard++;
    }
    return months;
  }
  function elapsedFractionExport(prdAwal: string, prdAkhir: string): number {
    const now = new Date();
    const currentYYYYMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const sy = parseInt(prdAwal.slice(0, 4), 10), sm = parseInt(prdAwal.slice(4), 10);
    const ey = parseInt(prdAkhir.slice(0, 4), 10), em = parseInt(prdAkhir.slice(4), 10);
    const total = (ey - sy) * 12 + (em - sm) + 1;
    if (total <= 0) return 0;
    const cappedEnd = currentYYYYMM < prdAkhir ? currentYYYYMM : prdAkhir;
    const cy = parseInt(cappedEnd.slice(0, 4), 10), cm = parseInt(cappedEnd.slice(4), 10);
    const elapsed = Math.max(0, Math.min(total, (cy - sy) * 12 + (cm - sm) + 1));
    return elapsed / total;
  }

  // Derived from `poas`/`itemsByPoa` already fetched above (2026-08-31 fix —
  // this used to be two fresh `findMany` round-trips scoped to `mrNips` +
  // `RINGKASAN_QUARTER`, which duplicated the main `poas`/`lineItems` fetch
  // at the top of this route EXACTLY whenever `?period=` is a single quarter
  // (the common case — `poaWhere.period` and `RINGKASAN_QUARTER` are then the
  // same value), and was a redundant subset query even for `?period=all`.
  // Both fetches share the same `ownerId in mrNips` + every-status scope, so
  // filtering in memory is equivalent, not an approximation.
  const ringkasanPoas = poas.filter((p) => p.period === RINGKASAN_QUARTER);
  const ringkasanPoaIds = ringkasanPoas.map((p) => p.id);
  const ringkasanTargetTotal = ringkasanPoas.reduce((s, p) => s + toNum(p.target), 0);

  const ringkasanLineItems = ringkasanPoaIds.flatMap((id) => itemsByPoa.get(id) ?? []);

  let ringkasanEstimasi = 0, ringkasanPssp = 0, ringkasanDisc = 0, ringkasanEnt = 0;
  for (const li of ringkasanLineItems) {
    const base = toNum(li.rencanaTotalBiaya);
    const pengali = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
    ringkasanEstimasi += base;
    ringkasanPssp += base * toNum(li.persenPsspDokter) * pengali;
    ringkasanDisc += base * (toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee));
    ringkasanEnt += base * toNum(li.persenEntertain);
  }
  const ringkasanBudget = ringkasanPssp + ringkasanDisc + ringkasanEnt;

  // Tercacah (apportioned to this quarter's own 3 months) — same
  // computeMonthlyBreakdown apportionment /summary's Ringkasan tab uses for
  // its headline "Estimasi Rencana"/"Nilai PSSP" figures, rather than the
  // plain full-value sums above (which can include months outside the quarter).
  const ringkasanMonthlyBreakdown = computeMonthlyBreakdown(ringkasanLineItems);
  const ringkasanEstimasiTercacah = ringkasanQMonths.reduce((s, m) => s + (ringkasanMonthlyBreakdown.get(m)?.estimasi ?? 0), 0);

  const ringkasanCustCount = new Set(ringkasanLineItems.map((li) => li.kodeCust ?? li.namaCust)).size;
  const ringkasanKontesCount = new Set(
    ringkasanLineItems.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)
  ).size;

  // PSSP Aktif tercacah for the quarter, scoped to this team's outlets — bounded
  // to a SINGLE quarter window (not /summary's 2-quarter Q-Berjalan+Q-Sebelumnya
  // window), since this sheet has no Q-Sebelumnya comparison column.
  const ringkasanAktifRows = assignedOutlets.length > 0
    ? await prisma.psspKontrak.findMany({
        where: {
          kdOutlet: { in: assignedOutlets },
          prdAwal: { lte: ringkasanQMonths[ringkasanQMonths.length - 1] },
          prdAkhir: { gte: ringkasanQMonths[0] },
        },
        select: { kdCust: true, cUrut: true, prdAwal: true, prdAkhir: true, estBaris: true, totalLunas: true },
      }) as { kdCust: string; cUrut: string; prdAwal: string; prdAkhir: string; estBaris: { toString(): string } | null; totalLunas: { toString(): string } | null }[]
    : [];
  function tercacahForQuarterExport(rows: typeof ringkasanAktifRows, months: string[]): { jumlah: number; value: number } {
    const monthSet = new Set(months);
    const contractKeys = new Set<string>();
    let value = 0;
    for (const r of rows) {
      const rMonths = monthsInRangeExport(r.prdAwal, r.prdAkhir);
      if (rMonths.length === 0) continue;
      if (rMonths.some((m) => monthSet.has(m))) contractKeys.add(`${r.kdCust}|${r.cUrut}`);
      const perMonth = toNum(r.estBaris) / rMonths.length;
      for (const m of rMonths) if (monthSet.has(m)) value += perMonth;
    }
    return { jumlah: contractKeys.size, value };
  }
  const ringkasanAktifQ = tercacahForQuarterExport(ringkasanAktifRows, ringkasanQMonths);

  const ringkasanPctRencana = ringkasanTargetTotal > 0 ? (ringkasanEstimasiTercacah / ringkasanTargetTotal) * 100 : null;
  const ringkasanPctAktif = ringkasanTargetTotal > 0 ? (ringkasanAktifQ.value / ringkasanTargetTotal) * 100 : null;

  // Pelunasan — expected (estBaris × elapsed fraction of the contract's OWN
  // period) vs actual (totalLunas), deduped by contract — same Running Rate
  // formula /summary's Ringkasan §4 Pelunasan card uses.
  const ringkasanContractRep = new Map<string, typeof ringkasanAktifRows[number]>();
  for (const r of ringkasanAktifRows) {
    const key = `${r.kdCust}|${r.cUrut}`;
    if (!ringkasanContractRep.has(key)) ringkasanContractRep.set(key, r);
  }
  let ringkasanExpectedLunas = 0, ringkasanActualLunas = 0;
  for (const r of ringkasanContractRep.values()) {
    ringkasanExpectedLunas += toNum(r.estBaris) * elapsedFractionExport(r.prdAwal, r.prdAkhir);
    ringkasanActualLunas += toNum(r.totalLunas);
  }
  const ringkasanPelunasanPct = ringkasanExpectedLunas > 0 ? (ringkasanActualLunas / ringkasanExpectedLunas) * 100 : null;

  const ringkasanSalesRaw = (assignedOutlets.length > 0
    ? await prisma.outletSalesValueMonthly.groupBy({
        by: ["kodePI"],
        where: { kodePI: { in: assignedOutlets }, periode: { in: ringkasanQMonths } },
        _sum: { valueSales: true },
      })
    : []) as { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[];
  const ringkasanSalesTotal = ringkasanSalesRaw.reduce((s, r) => s + toNum(r._sum.valueSales), 0);

  // ListingFeeKontrak has no periode column to scope to this quarter specifically
  // (same limitation the Per Outlet/Per Produk sheets above already accept for
  // Listing Fee) — reuses the whole-team total already computed for Sheet 5.
  const ringkasanListingFeeTotal = [...listingFeeByOutlet.values()].reduce((s, v) => s + v, 0);

  const ws7 = wb.addWorksheet("Summary Ringkasan");
  ws7.columns = [
    { key: "label", width: 40 },
    { key: "value", width: 26 },
  ];
  ws7.addRow(["Ringkasan POA — Kuartal " + RINGKASAN_QUARTER]);
  ws7.getRow(1).font = { bold: true, size: 14 };
  addKv(ws7, "Diekspor oleh", `${session.name} (${session.role})`);
  addKv(ws7, "Tanggal export", new Date().toLocaleDateString("id-ID"));
  addKv(ws7, "Kuartal Ringkasan", RINGKASAN_QUARTER + (period ? "" : " (default kuartal berjalan — tidak ada ?period= pada request ini)"));
  ws7.addRow([]);

  addDivider(ws7, "Target & Pencapaian");
  addKv(ws7, "Total Target", fmtRp(ringkasanTargetTotal), true);
  addKv(ws7, "Estimasi Rencana (Tercacah)", fmtRp(ringkasanEstimasiTercacah));
  addKv(ws7, "PSSP Aktif (Tercacah)", `${fmtRp(ringkasanAktifQ.value)} (${ringkasanAktifQ.jumlah} kontrak)`);
  addKv(ws7, "% Rencana thd Target", ringkasanPctRencana != null ? `${ringkasanPctRencana.toFixed(1)}%` : "Tidak tersedia (Target 0)");
  addKv(ws7, "% Aktif thd Target", ringkasanPctAktif != null ? `${ringkasanPctAktif.toFixed(1)}%` : "Tidak tersedia (Target 0)");

  addDivider(ws7, "Estimasi & Anggaran (Kuartal)");
  addKv(ws7, "Total Estimasi POA", fmtRp(ringkasanEstimasi), true);
  addKv(ws7, "Total PSSP", fmtRp(ringkasanPssp));
  addKv(ws7, "Total Campaign / DPL / DPF / DP / Listing Fee", fmtRp(ringkasanDisc));
  addKv(ws7, "Total ENT", fmtRp(ringkasanEnt));
  addKv(ws7, "Total Budget", fmtRp(ringkasanBudget), true);
  addKv(ws7, "% Budget / Estimasi", ringkasanEstimasi > 0 ? `${((ringkasanBudget / ringkasanEstimasi) * 100).toFixed(1)}%` : "—");

  addDivider(ws7, "Cakupan");
  addKv(ws7, "Total Customer (unik)", ringkasanCustCount);
  addKv(ws7, "Variasi Produk Kontes (unik)", ringkasanKontesCount);
  addKv(ws7, "Total Baris Pengajuan", ringkasanLineItems.length);

  addDivider(ws7, "Sales & Pelunasan");
  addKv(ws7, "Sales Aktif (Kuartal)", fmtRp(ringkasanSalesTotal));
  addKv(ws7, "Listing Fee (Total, seluruh outlet tim — tidak per-kuartal)", fmtRp(ringkasanListingFeeTotal));
  addKv(ws7, "% Pelunasan PSSP Aktif", ringkasanPelunasanPct != null ? `${ringkasanPelunasanPct.toFixed(1)}%` : "Tidak tersedia");

  // ── Sheet 8: Summary Per Personil ────────────────────────────────────────────
  // Same metric shape as Sheet 5 "Summary Per Outlet" (Estimasi Aktif+Pengajuan,
  // User count, Variasi Produk Kontes/Non-Kontes, Budget, Cost Ratio, Sales
  // Aktif, Listing Fee), grouped by MR instead of outlet — mirrors the /summary
  // "Per Personil" tab (2026-08-13, stakeholder #15). Reuses activePsspByOutlet/
  // salesValueByOutlet/listingFeeByOutlet already built for Sheet 5 (no new
  // per-row queries) via each MR's own outlet list (`mrToOutlets`, built earlier
  // for the org-hierarchy lookup).

  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));
  const itemsByMrNip = new Map<string, typeof lineItems>();
  for (const mr of mrUsers) itemsByMrNip.set(mr.nip, []);
  for (const li of lineItems) {
    const ownerNip = poaOwnerMap.get(li.poaId);
    if (!ownerNip) continue;
    const list = itemsByMrNip.get(ownerNip) ?? [];
    list.push(li);
    itemsByMrNip.set(ownerNip, list);
  }

  interface PersonilSummaryRow {
    nip: string; name: string;
    estimasi: number; estimasiAktif: number; userCount: number;
    variasiProduk: number; variasiProdukKontes: number;
    budgetTotal: number; biayaAktif: number; salesAktif: number; listingFeeTotal: number;
  }
  const personilSummaryRows: PersonilSummaryRow[] = mrUsers.map((mr) => {
    const items = itemsByMrNip.get(mr.nip) ?? [];
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
    const outletsForMr = mrToOutlets.get(mr.nip) ?? [];
    const activeRows = outletsForMr.flatMap((o) => activePsspByOutlet.get(o) ?? []);
    const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);
    const seenContracts = new Set<string>();
    let biayaAktif = 0;
    for (const r of activeRows) {
      if (seenContracts.has(r.cUrut)) continue;
      seenContracts.add(r.cUrut);
      biayaAktif += r.biaya;
    }
    const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
    const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
    const userCount = new Set([...activeCustKeys, ...draftCustKeys]).size;
    const salesAktif = outletsForMr.reduce((s, o) => s + (salesValueByOutlet.get(o) ?? 0), 0);
    const listingFeeTotal = outletsForMr.reduce((s, o) => s + (listingFeeByOutlet.get(o) ?? 0), 0);
    return {
      nip: mr.nip, name: mr.name,
      estimasi, estimasiAktif, userCount,
      variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
      variasiProdukKontes: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      biayaAktif, salesAktif, listingFeeTotal,
    };
  }).sort((a, b) => (b.estimasi + b.estimasiAktif) - (a.estimasi + a.estimasiAktif));

  const ws8 = wb.addWorksheet("Summary Per Personil");
  ws8.columns = [
    { header: "NIP MR",                       key: "nip",                    width: 12 },
    { header: "Nama MR",                      key: "name",                   width: 28 },
    { header: "Estimasi Aktif+Pengajuan",     key: "estimasiAktifPengajuan", width: 22 },
    { header: "User PSSP (Aktif+Estimasi)",   key: "userCount",              width: 20 },
    { header: "Variasi Produk Kontes",        key: "variasiProdukKontes",    width: 16 },
    { header: "Variasi Produk Non-Kontes",    key: "variasiProdukNonKontes", width: 18 },
    { header: "Budget",                       key: "budget",                 width: 18 },
    { header: "Cost Ratio",                   key: "costRatio",              width: 12 },
    { header: "Sales Aktif (2026)",           key: "salesAktif",             width: 18 },
    { header: "Estimasi Per User",            key: "estimasiPerUser",        width: 18 },
    { header: "Listing Fee",                  key: "listingFee",             width: 16 },
  ];
  styleHeader(ws8);
  for (const r of personilSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const biayaAktifPengajuan = r.biayaAktif + r.budgetTotal;
    const costRatio = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : 0;
    ws8.addRow({
      nip: r.nip, name: r.name,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      userCount: r.userCount,
      variasiProdukKontes: r.variasiProdukKontes,
      variasiProdukNonKontes: r.variasiProduk - r.variasiProdukKontes,
      budget: Math.round(r.budgetTotal),
      costRatio: parseFloat(costRatio.toFixed(1)),
      salesAktif: Math.round(r.salesAktif),
      estimasiPerUser: r.userCount > 0 ? Math.round(estimasiAktifPengajuan / r.userCount) : 0,
      listingFee: Math.round(r.listingFeeTotal),
    });
  }
  ["estimasiAktifPengajuan", "budget", "salesAktif", "estimasiPerUser", "listingFee"].forEach((key) => {
    ws8.getColumn(key).numFmt = '#,##0';
  });
  ws8.getColumn("costRatio").numFmt = '0.0"%"';
  shadeAlt(ws8, 1);
  if (personilSummaryRows.length === 0) ws8.addRow(["(Belum ada data pengajuan)"]);

  // ── Sheet 9: Summary Per Customer ────────────────────────────────────────────
  // Same metric shape again, grouped by customer — mirrors /summary "Per
  // Customer" tab. Sales Aktif/Listing Fee are outlet-level-only figures with no
  // clean per-customer join anywhere in this data model, so (unlike Sheets 5/8)
  // they're omitted here rather than approximated. Customers with no kodeCust
  // are excluded, same "no synthetic no-code row" convention /summary's own
  // Per Customer tab uses (see comment on `custIdentity`/getTerritoryKey in
  // src/app/(app)/summary/page.tsx).

  // Shared by Sheet 9 (Spesialisasi column) and Sheet 10 (grouping/Aktif figures)
  // — Nexus-sourced as of 2026-08-13 ("customer full pakai Nexus"), one
  // get_customer_by_outlet call per outlet touched by this team's line items
  // + active PSSP, replacing the old batched prisma.customer lookup by
  // kodeCustomer. Chosen as a deliberate latency/reliability tradeoff over a
  // local snapshot — but that decision assumed ASM/SM/NSM-sized scopes.
  // Measured 2026-08-21 for ADMIN/company-wide scope: 749 outlets took ~96s
  // (concurrency 10) — the dominant cost behind this route's reported 502/500
  // for ADMIN. Above SPESIALISASI_NEXUS_OUTLET_CAP, skip the fetch entirely
  // rather than let one column on 2 of 10 sheets take the whole export down —
  // spesByCustCode stays empty, "Spesialisasi" cells fall back to "-" (Sheet
  // 9) and Sheet 10's Aktif figures show 0 (its Rencana figures are unaffected,
  // sourced from PoaLineItem.spesialisasi directly, not this Nexus lookup).
  const SPESIALISASI_NEXUS_OUTLET_CAP = 100;
  const custCodesForSpes = [...new Set([
    ...lineItems.map((li) => li.kodeCust).filter((k): k is string => !!k),
    ...activePsspAll.map((r) => r.kdCust),
  ])];
  const outletCodesForSpes = [...new Set([
    ...lineItems.map((li) => li.kodePI).filter((k): k is string => !!k),
    ...activePsspAll.map((r) => r.kdOutlet).filter((k): k is string => !!k),
  ])];
  const nexusSpesByKodeForExport = outletCodesForSpes.length > 0 && outletCodesForSpes.length <= SPESIALISASI_NEXUS_OUTLET_CAP
    ? await getNexusSpesialisasiByOutlets(outletCodesForSpes)
    : new Map<string, string>();
  const spesByCustCode = new Map(
    custCodesForSpes
      .map((code) => [code, nexusSpesByKodeForExport.get(code.toUpperCase())] as const)
      .filter((entry): entry is [string, string] => !!entry[1])
      .map(([code, spes]) => [code, spesLabel(spes)] as const)
  );

  const custGroups = new Map<string, { namaCust: string; items: typeof lineItems }>();
  for (const li of lineItems) {
    if (!li.kodeCust) continue;
    if (!custGroups.has(li.kodeCust)) custGroups.set(li.kodeCust, { namaCust: li.namaCust, items: [] });
    custGroups.get(li.kodeCust)!.items.push(li);
  }
  const activePsspByCustCode = new Map<string, typeof activePsspAll>();
  for (const r of activePsspAll) {
    const list = activePsspByCustCode.get(r.kdCust) ?? [];
    list.push(r);
    activePsspByCustCode.set(r.kdCust, list);
  }
  // Customers with an active contract but no planned line item this export
  // period still deserve a row (same "Aktif-only" inclusion Sheets 5/6 give
  // outlets/products) — seed from activePssp too.
  for (const r of activePsspAll) {
    if (!custGroups.has(r.kdCust)) custGroups.set(r.kdCust, { namaCust: r.nmCust ?? r.kdCust, items: [] });
  }

  interface CustomerSummaryRow {
    kodeCust: string; namaCust: string; spesialisasi: string;
    estimasi: number; estimasiAktif: number;
    variasiProduk: number; variasiProdukKontes: number;
    budgetTotal: number; biayaAktif: number;
  }
  const customerSummaryRows: CustomerSummaryRow[] = [...custGroups.entries()].map(([kodeCust, { namaCust, items }]) => {
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
    const activeRows = activePsspByCustCode.get(kodeCust) ?? [];
    const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);
    const seenContracts = new Set<string>();
    let biayaAktif = 0;
    for (const r of activeRows) {
      if (seenContracts.has(r.cUrut)) continue;
      seenContracts.add(r.cUrut);
      biayaAktif += r.biaya;
    }
    const namaResolved = namaCust || activeRows[0]?.nmCust || kodeCust;
    return {
      kodeCust, namaCust: namaResolved,
      spesialisasi: spesByCustCode.get(kodeCust) ?? "-",
      estimasi, estimasiAktif,
      variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
      variasiProdukKontes: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      biayaAktif,
    };
  }).sort((a, b) => (b.estimasi + b.estimasiAktif) - (a.estimasi + a.estimasiAktif));

  const ws9 = wb.addWorksheet("Summary Per Customer");
  ws9.columns = [
    { header: "Kode Customer",                key: "kodeCust",               width: 14 },
    { header: "Nama Customer",                key: "namaCust",               width: 30 },
    { header: "Spesialisasi",                 key: "spesialisasi",           width: 22 },
    { header: "Estimasi Aktif+Pengajuan",     key: "estimasiAktifPengajuan", width: 22 },
    { header: "Variasi Produk Kontes",        key: "variasiProdukKontes",    width: 16 },
    { header: "Variasi Produk Non-Kontes",    key: "variasiProdukNonKontes", width: 18 },
    { header: "Budget",                       key: "budget",                 width: 18 },
    { header: "Cost Ratio",                   key: "costRatio",              width: 12 },
  ];
  styleHeader(ws9);
  for (const r of customerSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const biayaAktifPengajuan = r.biayaAktif + r.budgetTotal;
    const costRatio = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : 0;
    ws9.addRow({
      kodeCust: r.kodeCust, namaCust: r.namaCust, spesialisasi: r.spesialisasi,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      variasiProdukKontes: r.variasiProdukKontes,
      variasiProdukNonKontes: r.variasiProduk - r.variasiProdukKontes,
      budget: Math.round(r.budgetTotal),
      costRatio: parseFloat(costRatio.toFixed(1)),
    });
  }
  ["estimasiAktifPengajuan", "budget"].forEach((key) => { ws9.getColumn(key).numFmt = '#,##0'; });
  ws9.getColumn("costRatio").numFmt = '0.0"%"';
  shadeAlt(ws9, 1);
  if (customerSummaryRows.length === 0) ws9.addRow(["(Belum ada data pengajuan)"]);

  // ── Sheet 10: Summary Per Spesialisasi ───────────────────────────────────────
  // Grouped by spesLabel(li.spesialisasi) — a raw field already on every line
  // item (no customer join needed for the Rencana side). The Aktif side has no
  // spesialisasi field on PsspKontrak at all, so it's joined via `spesByCustCode`
  // (built above for Sheet 9) — contracts whose customer has no Customer-table
  // match are excluded from the Aktif figures here, same limitation /summary's
  // own "Per Spesialisasi" tab (`kesesuaianAktifBySpes`/`activePsspBySpes`) has.

  const spesGroups = new Map<string, { items: typeof lineItems }>();
  for (const li of lineItems) {
    const label = spesLabel(li.spesialisasi);
    if (!spesGroups.has(label)) spesGroups.set(label, { items: [] });
    spesGroups.get(label)!.items.push(li);
  }
  const activePsspBySpesLabel = new Map<string, typeof activePsspAll>();
  for (const r of activePsspAll) {
    const label = spesByCustCode.get(r.kdCust);
    if (!label) continue;
    const list = activePsspBySpesLabel.get(label) ?? [];
    list.push(r);
    activePsspBySpesLabel.set(label, list);
  }

  interface SpesialisasiSummaryRow {
    spesialisasi: string;
    estimasi: number; estimasiAktif: number; userCount: number;
    variasiProduk: number; variasiProdukKontes: number;
    budgetTotal: number; biayaAktif: number;
  }
  const spesialisasiSummaryRows: SpesialisasiSummaryRow[] = [...spesGroups.entries()].map(([label, { items }]) => {
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
    const activeRows = activePsspBySpesLabel.get(label) ?? [];
    const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);
    const seenContracts = new Set<string>();
    let biayaAktif = 0;
    for (const r of activeRows) {
      if (seenContracts.has(r.cUrut)) continue;
      seenContracts.add(r.cUrut);
      biayaAktif += r.biaya;
    }
    const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
    const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
    const userCount = new Set([...activeCustKeys, ...draftCustKeys]).size;
    return {
      spesialisasi: label,
      estimasi, estimasiAktif, userCount,
      variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
      variasiProdukKontes: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
      budgetTotal: psspTotal + discountTotal + entertainTotal,
      biayaAktif,
    };
  }).sort((a, b) => (b.estimasi + b.estimasiAktif) - (a.estimasi + a.estimasiAktif));

  const ws10 = wb.addWorksheet("Summary Per Spesialisasi");
  ws10.columns = [
    { header: "Spesialisasi",                 key: "spesialisasi",           width: 24 },
    { header: "Estimasi Aktif+Pengajuan",     key: "estimasiAktifPengajuan", width: 22 },
    { header: "User PSSP (Aktif+Estimasi)",   key: "userCount",              width: 20 },
    { header: "Variasi Produk Kontes",        key: "variasiProdukKontes",    width: 16 },
    { header: "Variasi Produk Non-Kontes",    key: "variasiProdukNonKontes", width: 18 },
    { header: "Budget",                       key: "budget",                 width: 18 },
    { header: "Cost Ratio",                   key: "costRatio",              width: 12 },
  ];
  styleHeader(ws10);
  for (const r of spesialisasiSummaryRows) {
    const estimasiAktifPengajuan = r.estimasi + r.estimasiAktif;
    const biayaAktifPengajuan = r.biayaAktif + r.budgetTotal;
    const costRatio = estimasiAktifPengajuan > 0 ? (biayaAktifPengajuan / estimasiAktifPengajuan) * 100 : 0;
    ws10.addRow({
      spesialisasi: r.spesialisasi,
      estimasiAktifPengajuan: Math.round(estimasiAktifPengajuan),
      userCount: r.userCount,
      variasiProdukKontes: r.variasiProdukKontes,
      variasiProdukNonKontes: r.variasiProduk - r.variasiProdukKontes,
      budget: Math.round(r.budgetTotal),
      costRatio: parseFloat(costRatio.toFixed(1)),
    });
  }
  ["estimasiAktifPengajuan", "budget"].forEach((key) => { ws10.getColumn(key).numFmt = '#,##0'; });
  ws10.getColumn("costRatio").numFmt = '0.0"%"';
  shadeAlt(ws10, 1);
  if (spesialisasiSummaryRows.length === 0) ws10.addRow(["(Belum ada data pengajuan)"]);

  } // end fullReportScope (Sheets 5-10)

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
