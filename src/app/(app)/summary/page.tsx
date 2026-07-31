import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips, NON_DRAFT_STATUSES } from "@/lib/authz";
import { getAllPakets, PAKET_BY_PRODUK, SPESIALISASI_TO_PAKET } from "@/lib/paketProduk";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { getActivePsspByOutlets, type ActivePsspRow } from "@/app/actions/customer";
import { Card } from "@/components/ui/Card";
import { MonitoringChecklist } from "@/components/poa/MonitoringChecklist";
import type { MonitoringGroup, MonitoringTotals } from "@/components/poa/MonitoringChecklist";
import { TerritoryTable } from "@/components/poa/TerritoryTable";
import { ProdukRekomendasiView, type PaketRekomendasiStat } from "@/components/poa/ProdukRekomendasiView";
import { SummaryFilterModal } from "@/components/poa/SummaryFilterModal";

// PSSP contract rows key products by name only (Procode ≠ Item Kode across
// systems — see computeOldEstPerMonth in LineItemEditor.tsx for the same
// convention), so matching an active PSSP row to a "produk" tab group must
// normalize on namaProduk, never kodeProduk/kdProduk.
function normName(s: string): string {
  return s.toLowerCase().trim();
}

export const metadata = { title: "Summary · Form POA" };

// ─── Types ────────────────────────────────────────────────────────────────────

// "ringkasan" and "produk-rekomendasi" are the two new tabs (2026-07-31
// rework: Ringkasan moved out of a card-above-every-tab into its own tab,
// scoped to Personil data only; Per Produk Rekomendasi is new) — everywhere
// below that already groups/queries by outlet/customer/produk/mr keeps doing
// exactly that, unchanged, by reading the narrower `tab` (GroupingTab) local
// further down instead of the raw URL param. Only the render switch at the
// bottom and the tab bar itself need to know about the two new values —
// see `rawTab` there.
type Tab = "ringkasan" | "mr" | "outlet" | "customer" | "produk-rekomendasi" | "produk";
type GroupingTab = "outlet" | "customer" | "produk" | "mr";

interface SalesFigures {
  historis2025: number;
  salesYtd: number;
  salesPlusEst: number;
  growthPct: number;
  achievementPct: number;
  // Raw components behind growthPct/achievementPct, exposed so Ringkasan can
  // sum them across groups and derive a true growth-of-totals / total
  // achievement instead of averaging each group's own percentage (2026-07-27
  // rework: averaging % masks group-size differences — Simpson's-paradox-style
  // drift from the summed historis2025/salesYtd/salesPlusEst shown alongside).
  salesComparable: number;
  achievementBase: number;
}

interface TerritoryGroup {
  code: string;
  name: string;
  pic: string;
  estimasi: number;
  variasiProduk: number;
  variasiProdukFokus: number;
  produkPssp: number;
  customer: number;
  pengajuan: number;
  terstandarisasi: number;
  prosesStandar: number;
  gap: number;
  psspTotal: number;
  discountTotal: number;
  entertainTotal: number;
  budgetTotal: number;
  realisasi: number;
  gapVsRealisasi: number;
  sales: SalesFigures;
  estimasiAktif: number;
  userPsspAktif: number;
  userPsspAktifEstimasi: number;
  salesAktif: number;
  listingFeeTotal: number;
  avgPasienPerUser: number | null;
  avgStPerPasien: number | null;
  pelunasanRunningRate: number | null;
  biayaAktif: number;
  // Growth vs Quarter Sebelumnya (2026-07-28, redefined 2026-07-30) — THIS
  // quarter's Estimasi (submitted POA plan) vs LAST quarter's REALISASI
  // (PSSP pelunasan actually recorded in those specific months), not last
  // quarter's own plan — comparing plan-to-plan told you nothing about
  // whether either plan was realistic; plan-vs-actual does. Applies
  // uniformly across all 4 tabs.
  estimasiQuarterIni: number;
  realisasiQuarterSebelumnya: number;
  growthVsQuarterSebelumnyaPct: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v: { toString(): string } | number | string | null | undefined): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

function toYYYYMM(y: number, m: number): string {
  return `${y}${String(m).padStart(2, "0")}`;
}

// Same "how far along a contract's own period has run" fraction as
// elapsedMonthsCount in LineItemEditor.tsx (ContractCard's Running Rate
// badge) — duplicated here rather than imported since that file is a
// client component. Returns 0 if the period is malformed.
function elapsedFraction(prdAwal: string, prdAkhir: string): number {
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

// Growth vs Quarter Sebelumnya (2026-07-28) — PoaForm.period is "YYYY-QN";
// this steps back exactly one quarter (wrapping Q1 to the prior year's Q4).
function previousQuarterPeriod(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10), q = parseInt(m[2], 10);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");

  // Gates the Ringkasan dashboard-visualization card (see render below) —
  // hoisted up here too so the heavy "Data Sales" query below can skip
  // itself entirely for roles that will never render the card that shows it
  // (2026-07-31 perf fix: "summary lag banget" — this query was previously
  // unconditional on every single page load regardless of role or tab).
  const showRingkasan = session.role === "NSM" || session.role === "GM" || session.role === "ADMIN";

  const params = await searchParams;
  const requestedTab: Tab = (params.tab as Tab) ?? "mr";
  // Ringkasan is gated to the same roles as before (see showRingkasan) —
  // anyone else requesting it via a raw ?tab=ringkasan URL silently falls
  // back to Per Personil instead of erroring.
  const rawTab: Tab = requestedTab === "ringkasan" && !showRingkasan ? "mr" : requestedTab;
  // Every grouping/query decision below this point (getTerritoryKey,
  // realSalesAgg, activeRows, etc.) only ever needs to know
  // outlet/customer/produk/mr — "ringkasan" reuses the "mr" grouping (it's
  // the Personil aggregate) and "produk-rekomendasi" has its own bespoke
  // data fetch further down, so neither needs a real grouping of its own.
  const tab: GroupingTab = rawTab === "ringkasan" || rawTab === "produk-rekomendasi" ? "mr" : rawTab;
  // Rentang Periode (2026-07-28) — replaces the old single `period` pill
  // selector with an inclusive from/to range over the same "YYYY-QN" period
  // strings; string comparison sorts them chronologically correctly since
  // the format is fixed-width. Either end can be left open (only periodFrom
  // = "from X onward", only periodTo = "up to Y", neither = "Semua").
  const periodFrom = params.periodFrom ?? null;
  const periodTo = params.periodTo ?? null;
  const hasPeriodFilter = !!periodFrom || !!periodTo;
  const periodQuery = `${periodFrom ? `&periodFrom=${periodFrom}` : ""}${periodTo ? `&periodTo=${periodTo}` : ""}`;

  // Default period window (2026-07-31 perf fix: "performance starts to slow
  // down... bound the unbounded queries") — with no explicit filter, this
  // page used to fetch EVERY submitted POA/line-item ever, for every MR in
  // the viewer's subtree, with no limit at all ("Semua" was the default, not
  // an opt-in). That's the one thing that keeps getting slower over time
  // regardless of query/index tuning, since the dataset itself only grows.
  // The per-row TABLE isn't the problem (it's bounded by distinct outlets/
  // customers/products/personnel, a few hundred at most) — it's the RAW
  // line-item fetch behind the aggregation that scales with history × org
  // size. Defaulting to a rolling 4-quarter window (current + 3 back) covers
  // what people actually look at day to day; "Semua" is still one click away
  // via the filter's "Lihat semua periode" link (SummaryFilterModal), which
  // sets an explicit periodFrom and so counts as hasPeriodFilter.
  let defaultPeriodFrom = currentQuarter();
  for (let i = 0; i < 3; i++) defaultPeriodFrom = previousQuarterPeriod(defaultPeriodFrom) ?? defaultPeriodFrom;
  const isDefaultBounded = !hasPeriodFilter;

  // ── Data ──────────────────────────────────────────────────────────────────

  // Shared helper (not a local reimplementation) so ADMIN/GM correctly see
  // every MR company-wide instead of walking nipAtasan from their own NIP —
  // neither role reports to/from anyone in that chain, so the old local
  // getSubordinateMRNips(nip) always returned an empty list for them
  // (2026-07-23 fix: "sebagai admin harusnya summary-nya kelihatan semua").
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({
        where: { nip: { in: mrNips } },
        orderBy: { name: "asc" },
      })) as { nip: string; name: string }[]
    : [];
  // O(1) lookup instead of mrUsers.find(...) — the latter was an O(mrUsers)
  // linear scan called once per LINE ITEM inside the grouping loop below
  // (2026-07-31 perf fix: "summary lag banget" — this compounds badly once
  // an org has hundreds of MRs and thousands of submitted line items).
  const mrUserByNip = new Map(mrUsers.map((u) => [u.nip, u]));

  // Was a local ["APPROVED_BY_ASM","APPROVED_BY_SM","APPROVED_BY_NSM"] literal
  // — those three statuses are near-unreachable (approvePoa jumps straight
  // from SUBMITTED_TO_X to SUBMITTED_TO_Y, see poaWorkflow.ts's
  // APPROVE_TRANSITIONS), so that filter matched almost nothing and every
  // Pengajuan/Estimasi figure on this page read as 0 (2026-07-30 bug report:
  // "pengajuan nya semuanya 0"). authz.ts's NON_DRAFT_STATUSES is the correct,
  // already-used-elsewhere definition of "submitted, not DRAFT/REVISI".
  const NON_DRAFT = NON_DRAFT_STATUSES;
  const poaWhere: Record<string, unknown> = { ownerId: { in: mrNips }, status: { in: NON_DRAFT } };
  // String gte/lte on "YYYY-QN" is safe — fixed-width format, lexicographic
  // order matches chronological order.
  if (hasPeriodFilter) {
    poaWhere.period = {
      ...(periodFrom ? { gte: periodFrom } : {}),
      ...(periodTo ? { lte: periodTo } : {}),
    };
  } else {
    // No explicit filter — bound to the rolling default window instead of
    // fetching all history (see isDefaultBounded above).
    poaWhere.period = { gte: defaultPeriodFrom };
  }

  const [poas, allPoasForPeriods] = await Promise.all([
    // target included (2026-07-31, Ringkasan tab's "Estimasi % Target") — same
    // real, atasan-set Rupiah quota SalesAchievementTable.tsx already sums for
    // the Monitoring page, never a fabricated stand-in.
    mrNips.length > 0 ? prisma.poaForm.findMany({ where: poaWhere }) as Promise<{ id: string; ownerId: string; period: string; target: { toString(): string } | null }[]> : Promise.resolve([]),
    // Distinct periods only, for the filter dropdown + "Lihat semua periode"
    // link — deliberately UNBOUNDED (full history) and select-only, unlike
    // poaWhere above, so the filter can still offer/jump to older quarters
    // even though the default table view no longer fetches them.
    mrNips.length > 0
      ? prisma.poaForm.findMany({ where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT } }, select: { period: true }, distinct: ["period"] }) as Promise<{ period: string }[]>
      : Promise.resolve([]),
  ]);

  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();
  const poaIds = poas.map((p) => p.id);
  const targetTotal = poas.reduce((s, p) => s + toNum(p.target), 0);

  // Growth vs Quarter Sebelumnya (2026-07-28, redefined 2026-07-30) —
  // "quarter ini" is always the REAL calendar quarter containing today,
  // never just "whichever period happens to have the most recent
  // submission" (2026-07-30 bug: a single early-submitted POA in the NEXT
  // quarter used to hijack the anchor and compare a near-empty future
  // quarter against a full prior one, reading as a false -100% company-wide
  // for every MR who simply hadn't submitted yet). Fetched independently of
  // poaWhere/lineItems above so the comparison still works even when the
  // range narrows the main query to fewer quarters.
  const quarterIni = currentQuarter();
  const quarterSebelumnya = previousQuarterPeriod(quarterIni);

  const qoqPoas = mrNips.length > 0
    ? (await prisma.poaForm.findMany({
        where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT }, period: quarterIni },
        select: { id: true, ownerId: true },
      })) as { id: string; ownerId: string }[]
    : [];
  const qoqPoaOwnerMap = new Map(qoqPoas.map((p) => [p.id, p.ownerId]));
  const qoqPoaIds = qoqPoas.map((p) => p.id);

  const qoqLineItems = qoqPoaIds.length > 0
    ? (await prisma.poaLineItem.findMany({
        where: { poaId: { in: qoqPoaIds } },
        select: { poaId: true, kodePI: true, kodeCust: true, kodeProduk: true, rencanaTotalBiaya: true },
      })) as { poaId: string; kodePI: string | null; kodeCust: string | null; kodeProduk: string; rencanaTotalBiaya: { toString(): string } | number }[]
    : [];

  // Same "code" identity as getTerritoryKey below, minus the display name —
  // this only needs to match up against the main groups by code. Customer
  // rows with no kodeCust are skipped entirely here (2026-07-30: "no-code"
  // customers aren't displayed as their own row at all anymore — see the
  // main lineItems grouping loop below — so there's nothing for this map to
  // match against for them).
  function qoqCode(li: typeof qoqLineItems[0]): string | null {
    if (tab === "outlet") return li.kodePI ?? "-";
    if (tab === "produk") return li.kodeProduk;
    if (tab === "customer") return li.kodeCust;
    return qoqPoaOwnerMap.get(li.poaId) ?? "-";
  }

  // hasIni tracks whether this code has an actual POA submitted THIS quarter
  // (not just whether its estimasi summed to something > 0) — without it, a
  // code with no Q-ini submission at all (hasn't gotten around to it yet)
  // reads identically to "estimasi genuinely collapsed to zero", both showing
  // a -100% growth. Only the latter should ever say -100%; the former should
  // show "belum ada data" (2026-07-30).
  const qoqIniByCode = new Map<string, { ini: number; hasIni: boolean }>();
  for (const li of qoqLineItems) {
    const code = qoqCode(li);
    if (!code) continue;
    const agg = qoqIniByCode.get(code) ?? { ini: 0, hasIni: false };
    agg.ini += toNum(li.rencanaTotalBiaya);
    agg.hasIni = true;
    qoqIniByCode.set(code, agg);
  }

  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({ where: { poaId: { in: poaIds } } })) as {
        poaId: string;
        kodePI: string | null;
        kodeCust: string | null;
        namaCust: string;
        namaProduk: string;
        kodeProduk: string;
        statusStandarisasi: string | null;
        rencanaTotalBiaya: { toString(): string } | number;
        persenPsspDokter: { toString(): string } | number | null;
        persenDiskon: { toString(): string } | number | null;
        persenDp: { toString(): string } | number | null;
        persenListingFee: { toString(): string } | number | null;
        persenEntertain: { toString(): string } | number | null;
        pengaliNilaiR: { toString(): string } | number | null;
        jumlahPasienHari: number | null;
        qtyProdukResep: number | null;
      }[]
    : [];

  // Outlet names for the "outlet" tab
  const outletCodes = [...new Set(lineItems.map((li) => li.kodePI).filter(Boolean) as string[])];
  const outletRows = outletCodes.length > 0
    ? (await prisma.outlet.findMany({
        where: { kodePI: { in: outletCodes } },
        select: { kodePI: true, namaOutlet: true },
      })) as { kodePI: string; namaOutlet: string }[]
    : [];
  const outletMap = new Map(outletRows.map((o) => [o.kodePI, o]));

  // Realisasi sebelumnya — every PSSP kontrak (running or already finished;
  // PsspKontrak has no separate "active" flag, prdAkhir in the past just
  // means it's done) aggregated by outlet and by customer, so the "outlet"
  // and "customer" tabs can be sorted by gap = estimasi sekarang - realisasi
  // sebelumnya (2026-07-24 request: surface "dulu jelek kok estimasinya
  // tinggi sekarang" outlets/customers at the top instead of by raw estimasi).
  const custCodes = [...new Set(lineItems.map((li) => li.kodeCust).filter(Boolean) as string[])];
  const [realisasiByOutletRaw, realisasiByCustRaw] = await Promise.all([
    outletCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdOutlet"], where: { kdOutlet: { in: outletCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
    custCodes.length > 0
      ? prisma.psspKontrak.groupBy({ by: ["kdCust"], where: { kdCust: { in: custCodes } }, _sum: { totalLunas: true } })
      : Promise.resolve([]),
  ]) as [{ kdOutlet: string | null; _sum: { totalLunas: { toString(): string } | null } }[], { kdCust: string; _sum: { totalLunas: { toString(): string } | null } }[]];
  const realisasiByOutlet = new Map(realisasiByOutletRaw.filter((r) => r.kdOutlet).map((r) => [r.kdOutlet as string, toNum(r._sum.totalLunas)]));
  const realisasiByCust = new Map(realisasiByCustRaw.map((r) => [r.kdCust, toNum(r._sum.totalLunas)]));

  // Realisasi Quarter Sebelumnya (2026-07-30, redefines the growth baseline
  // — user: "growth vs quarter sebelumnya itu estimasi vs realisasi nya").
  // "Realisasi" = PSSP pelunasan actually recorded within quarterSebelumnya's
  // 3 specific months (PsspKontrak.lunasByPeriod, keyed "YYYYMM" -> amount),
  // NOT the all-time cumulative totalLunas the "Realisasi Sebelumnya" column
  // above uses (that one intentionally spans every contract ever; this one
  // must stay scoped to exactly one quarter or it wouldn't measure
  // quarter-over-quarter growth at all). lunasByPeriod is a ROW-level figure
  // (one PsspKontrak row = one cUrut+kdProduk combination's own monthly
  // payments) — unlike `biaya`/ListingFeeKontrak.value, it is NOT duplicated
  // per product row within a contract, so no cUrut-dedup is needed before
  // summing (same assumption realisasiByOutlet/ByCust above already make
  // about totalLunas, uncommented but consistent).
  const quarterSebelumnyaMonths = quarterSebelumnya ? quarterToMonths(quarterSebelumnya) : [];
  const realisasiPsspWhere: Record<string, unknown>[] = [];
  if (outletCodes.length > 0) realisasiPsspWhere.push({ kdOutlet: { in: outletCodes } });
  if (custCodes.length > 0) realisasiPsspWhere.push({ kdCust: { in: custCodes } });
  const realisasiPsspRows = quarterSebelumnyaMonths.length > 0 && realisasiPsspWhere.length > 0
    ? (await prisma.psspKontrak.findMany({
        where: { OR: realisasiPsspWhere },
        select: { kdOutlet: true, kdCust: true, nmProduk: true, lunasByPeriod: true },
      })) as { kdOutlet: string | null; kdCust: string; nmProduk: string | null; lunasByPeriod: unknown }[]
    : [];

  function sumLunasForMonths(lunasByPeriod: unknown, months: string[]): number {
    if (!lunasByPeriod || typeof lunasByPeriod !== "object") return 0;
    const obj = lunasByPeriod as Record<string, number | string | null | undefined>;
    return months.reduce((s, m) => s + toNum(obj[m]), 0);
  }

  const realisasiSebelumnyaByOutlet = new Map<string, number>();
  const realisasiSebelumnyaByCust = new Map<string, number>();
  const realisasiSebelumnyaByProdName = new Map<string, number>();
  for (const r of realisasiPsspRows) {
    const v = sumLunasForMonths(r.lunasByPeriod, quarterSebelumnyaMonths);
    if (v === 0) continue;
    if (r.kdOutlet) realisasiSebelumnyaByOutlet.set(r.kdOutlet, (realisasiSebelumnyaByOutlet.get(r.kdOutlet) ?? 0) + v);
    if (r.kdCust) realisasiSebelumnyaByCust.set(r.kdCust, (realisasiSebelumnyaByCust.get(r.kdCust) ?? 0) + v);
    if (r.nmProduk) {
      const key = normName(r.nmProduk);
      realisasiSebelumnyaByProdName.set(key, (realisasiSebelumnyaByProdName.get(key) ?? 0) + v);
    }
  }

  // Build poa→owner map
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  // ── Global unique totals (avoids cross-group double-counting) ─────────────

  const psspProdSet = new Set<string>();
  for (const li of lineItems) {
    const psspp = toNum(li.persenPsspDokter);
    if (psspp > 0) psspProdSet.add(li.kodeProduk);
  }

  const sudahSet = new Set(
    lineItems.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").map((li) => li.kodeProduk)
  );
  const prosesSet = new Set(
    lineItems
      .filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN" && !sudahSet.has(li.kodeProduk))
      .map((li) => li.kodeProduk)
  );
  const allProductSet = new Set(lineItems.map((li) => li.kodeProduk));

  // Dedupe by kodeCust when available, falling back to namaCust only for
  // rows with no code at all — deduping by name alone (the old behaviour)
  // risked over/under-counting whenever the same customer had a code on
  // some line items and not others (2026-07-30, part of validating "customer
  // per MR" counts are correct).
  function custIdentity(li: { kodeCust: string | null; namaCust: string }): string {
    return li.kodeCust ?? li.namaCust;
  }

  const globalTotals: MonitoringTotals = {
    customer: new Set(lineItems.map(custIdentity)).size,
    variasiProdukFokus: new Set(
      lineItems.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)
    ).size,
    produkPssp: psspProdSet.size,
    sudahStandar: sudahSet.size,
    prosesStandar: prosesSet.size,
    totalUniqueProducts: allProductSet.size,
  };

  // ── Territory grouping ────────────────────────────────────────────────────

  type TerritoryKey = { code: string; name: string };

  function getTerritoryKey(li: typeof lineItems[0]): TerritoryKey {
    if (tab === "outlet") {
      const o = li.kodePI ? outletMap.get(li.kodePI) : null;
      return { code: li.kodePI ?? "-", name: o?.namaOutlet ?? "Tidak Diketahui" };
    }
    if (tab === "produk") {
      return { code: li.kodeProduk, name: li.namaProduk };
    }
    if (tab === "customer") {
      // Customers with no kodeCust are filtered out before this is ever
      // called for them (2026-07-30: "kalau customernya gaada kode... gausah
      // ditampilin aja" — no more synthetic "no-code:Name" rows) — code is
      // always real here.
      return { code: li.kodeCust!, name: li.namaCust };
    }
    const ownerNip = poaOwnerMap.get(li.poaId) ?? "-";
    const mr = mrUserByNip.get(ownerNip);
    return { code: ownerNip, name: mr?.name ?? ownerNip };
  }

  // An outlet's PIC is whichever MR(s) currently hold that specific
  // MrOutletAssignment — a SHADOW-pair outlet can have more than one holder.
  const mrOutletRows = mrNips.length > 0
    ? (await prisma.mrOutletAssignment.findMany({
        where: { nipMR: { in: mrNips } },
        select: { nipMR: true, kodePI: true },
      })) as { nipMR: string; kodePI: string }[]
    : [];
  const mrNamesByOutlet = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const mrName = mrUserByNip.get(row.nipMR)?.name ?? row.nipMR;
    const list = mrNamesByOutlet.get(row.kodePI) ?? [];
    list.push(mrName);
    mrNamesByOutlet.set(row.kodePI, list);
  }

  function findPic(code: string): string {
    if (tab === "mr") {
      const mr = mrUserByNip.get(code);
      return mr?.name ?? code;
    }
    if (tab === "outlet") {
      const names = mrNamesByOutlet.get(code);
      return names && names.length > 0 ? names.join(" / ") : "-";
    }
    return "-"; // "produk" tab — no single PIC concept for a product
  }

  // ── Matriks Summary Per Outlet / Per Produk (2026-07-27) ──────────────────
  // Fetched once regardless of which tab is active — both "outlet" and
  // "produk" need active-PSSP + real sales data, and the fetch is cheap
  // relative to the lineItems query above.
  const outletKodesForMR = [...new Set(mrOutletRows.map((r) => r.kodePI))];
  const SALES_2026_FROM = "202601";

  // ── Per Produk Rekomendasi tab (2026-07-31) — one section per Produk Fokus
  // paket, each showing doctor coverage ("X Dokter Pediatric, Y/X sudah di
  // POA") and a Low Hanging Fruit / Blue Ocean / Red Ocean / Standarisasi
  // product-count breakdown. Gated behind rawTab (only fetched when this tab
  // is actually open) — same "don't pay for what isn't rendered" principle
  // as the Data Sales query below.
  const PAKET_LIST = [...new Set(Object.values(PAKET_BY_PRODUK).flat())].sort();
  // Reverse of SPESIALISASI_TO_PAKET: paket -> every spesialisasi string
  // that's "the target audience" for it, used to find the doctor universe.
  const spesialisasiByPaket = new Map<string, string[]>();
  for (const [spesialisasi, pakets] of Object.entries(SPESIALISASI_TO_PAKET)) {
    for (const paket of pakets) {
      const list = spesialisasiByPaket.get(paket) ?? [];
      list.push(spesialisasi);
      spesialisasiByPaket.set(paket, list);
    }
  }

  const [customerOutletRows, outletProductKriteriaRows] = rawTab === "produk-rekomendasi" && outletKodesForMR.length > 0
    ? await Promise.all([
        prisma.customerOutlet.findMany({
          where: { kodePI: { in: outletKodesForMR } },
          select: { customer: { select: { kodeCustomer: true, namaCustomer: true, spesialisasi: true } } },
        }),
        prisma.outletProductKriteria.findMany({
          where: { kodePI: { in: outletKodesForMR }, paket: { in: PAKET_LIST } },
          select: { kodeProduk: true, paket: true, kategori: true, kriteriaBaru: true },
        }),
      ]) as [
        { customer: { kodeCustomer: string | null; namaCustomer: string; spesialisasi: string } }[],
        { kodeProduk: string; paket: string; kategori: string; kriteriaBaru: string }[],
      ]
    : [[], []];

  function doctorIdentity(c: { kodeCustomer: string | null; namaCustomer: string }): string {
    return c.kodeCustomer ?? c.namaCustomer;
  }

  // Denominator per paket: every distinct doctor in the visible territory
  // whose spesialisasi matches that paket's target audience — regardless of
  // whether they've been planned for at all yet.
  const doctorsByPaket = new Map<string, Set<string>>();
  for (const row of customerOutletRows) {
    const spesialisasiUpper = row.customer.spesialisasi.toUpperCase();
    for (const [paket, spesialisasiList] of spesialisasiByPaket) {
      if (!spesialisasiList.includes(spesialisasiUpper)) continue;
      const set = doctorsByPaket.get(paket) ?? new Set<string>();
      set.add(doctorIdentity(row.customer));
      doctorsByPaket.set(paket, set);
    }
  }

  // Numerator per paket: of those doctors, which ones already have >=1
  // submitted line item for a product belonging to that same paket (not
  // just any product) — reuses the already-fetched, period-filtered `lineItems`.
  const coveredDoctorsByPaket = new Map<string, Set<string>>();
  for (const li of lineItems) {
    const pakets = getAllPakets(li.namaProduk);
    if (pakets.length === 0) continue;
    const doctorId = li.kodeCust ?? li.namaCust;
    for (const paket of pakets) {
      const set = coveredDoctorsByPaket.get(paket) ?? new Set<string>();
      set.add(doctorId);
      coveredDoctorsByPaket.set(paket, set);
    }
  }

  // Kategori/Standarisasi product-count breakdown per paket. A product can be
  // classified per-OUTLET (OutletProductKriteria is keyed by kodePI+kodeProduk
  // +paket), so within one paket the same product is deduped across outlets,
  // keeping whichever outlet's row is seen first — a reasonable simplification
  // rather than picking a "majority" classification across the territory.
  interface KriteriaBucket { total: number; covered: number }
  const emptyBucket = (): KriteriaBucket => ({ total: 0, covered: 0 });
  const submittedProdukSet = new Set(lineItems.map((li) => li.kodeProduk));
  const kriteriaStatsByPaket = new Map<string, { lowHangingFruit: KriteriaBucket; blueOcean: KriteriaBucket; redOcean: KriteriaBucket; standarisasi: KriteriaBucket }>();
  const seenProdukPerPaket = new Set<string>();
  for (const row of outletProductKriteriaRows) {
    const dedupeKey = `${row.paket}|${row.kodeProduk}`;
    if (seenProdukPerPaket.has(dedupeKey)) continue;
    seenProdukPerPaket.add(dedupeKey);
    const stats = kriteriaStatsByPaket.get(row.paket) ?? { lowHangingFruit: emptyBucket(), blueOcean: emptyBucket(), redOcean: emptyBucket(), standarisasi: emptyBucket() };
    const isSubmitted = submittedProdukSet.has(row.kodeProduk);
    const bucketKey = row.kategori === "Low Hanging Fruit" ? "lowHangingFruit"
      : row.kategori === "Blue Ocean" ? "blueOcean"
      : row.kategori === "Red Ocean" ? "redOcean"
      : null;
    if (bucketKey) {
      stats[bucketKey].total++;
      if (isSubmitted) stats[bucketKey].covered++;
    }
    if (row.kriteriaBaru?.startsWith("Produk Sudah Terstandarisasi")) {
      stats.standarisasi.total++;
      if (isSubmitted) stats.standarisasi.covered++;
    }
    kriteriaStatsByPaket.set(row.paket, stats);
  }

  const paketRekomendasiStats: PaketRekomendasiStat[] = PAKET_LIST.map((paket) => {
    const doctorSet = doctorsByPaket.get(paket) ?? new Set<string>();
    const coveredSet = coveredDoctorsByPaket.get(paket) ?? new Set<string>();
    let doctorCovered = 0;
    for (const d of doctorSet) if (coveredSet.has(d)) doctorCovered++;
    const stats = kriteriaStatsByPaket.get(paket) ?? { lowHangingFruit: emptyBucket(), blueOcean: emptyBucket(), redOcean: emptyBucket(), standarisasi: emptyBucket() };
    return { paket, doctorTotal: doctorSet.size, doctorCovered, ...stats };
  });

  // "Data Sales" card in Ringkasan (2026-07-27 follow-up to the Matriks
  // Summary work above) — same DIR10001B-sourced OutletSalesValueMonthly,
  // just a wider period window (Jan last year → last completed month this
  // year) so historis/YTD/growth can be computed the same way
  // getMrSalesSummary (salesSummary.ts) already does for a single MR, just
  // generalized to whichever outlets belong to the active group.
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;
  const lastCompletedMonth = now.getMonth(); // 0 = no completed month yet (January)
  const lastYearFullFrom = toYYYYMM(lastYear, 1);
  const lastYearFullTo = toYYYYMM(lastYear, 12);
  const ytdFrom = toYYYYMM(currentYear, 1);
  const ytdTo = lastCompletedMonth > 0 ? toYYYYMM(currentYear, lastCompletedMonth) : null;
  const lastYearComparableTo = lastCompletedMonth > 0 ? toYYYYMM(lastYear, lastCompletedMonth) : null;

  const [activePssp, listingFeeRows, salesValueRaw, salesQtyRaw, salesHistoryRaw] = await Promise.all([
    outletKodesForMR.length > 0 ? getActivePsspByOutlets(outletKodesForMR) : Promise.resolve([] as ActivePsspRow[]),
    outletKodesForMR.length > 0
      ? prisma.listingFeeKontrak.findMany({ where: { kdOutlet: { in: outletKodesForMR } }, select: { kdOutlet: true, noreq: true, value: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0
      ? prisma.outletSalesValueMonthly.groupBy({ by: ["kodePI"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_2026_FROM } }, _sum: { valueSales: true } })
      : Promise.resolve([]),
    outletKodesForMR.length > 0
      ? prisma.outletSalesMonthly.groupBy({ by: ["itemKode"], where: { kodePI: { in: outletKodesForMR }, periode: { gte: SALES_2026_FROM } }, _sum: { qty: true } })
      : Promise.resolve([]),
    // Only feeds the Ringkasan card's collapsed "Data Sales" section, which
    // itself only shows real figures for tab "outlet"/"mr" (salesAvailable
    // below) — skip the fetch entirely otherwise instead of paying for a
    // findMany spanning ~19 months across every outlet in the org just to
    // discard the result.
    showRingkasan && (tab === "outlet" || tab === "mr") && outletKodesForMR.length > 0 && ytdTo
      ? prisma.outletSalesValueMonthly.findMany({
          where: { kodePI: { in: outletKodesForMR }, periode: { gte: lastYearFullFrom, lte: ytdTo } },
          select: { kodePI: true, periode: true, valueSales: true },
        })
      : Promise.resolve([]),
  ]) as [
    ActivePsspRow[],
    { kdOutlet: string | null; noreq: string; value: { toString(): string } }[],
    { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[],
    { itemKode: string; _sum: { qty: { toString(): string } | null } }[],
    { kodePI: string; periode: string; valueSales: { toString(): string } }[],
  ];

  interface SalesAgg { historisTahunLalu: number; ytd: number; comparable: number }
  const salesAggByOutlet = new Map<string, SalesAgg>();
  for (const row of salesHistoryRaw) {
    const v = toNum(row.valueSales);
    const agg = salesAggByOutlet.get(row.kodePI) ?? { historisTahunLalu: 0, ytd: 0, comparable: 0 };
    if (row.periode >= lastYearFullFrom && row.periode <= lastYearFullTo) agg.historisTahunLalu += v;
    if (ytdTo && row.periode >= ytdFrom && row.periode <= ytdTo) agg.ytd += v;
    if (lastYearComparableTo && row.periode >= lastYearFullFrom && row.periode <= lastYearComparableTo) agg.comparable += v;
    salesAggByOutlet.set(row.kodePI, agg);
  }
  const outletsByMr = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const list = outletsByMr.get(row.nipMR) ?? [];
    list.push(row.kodePI);
    outletsByMr.set(row.nipMR, list);
  }

  // Realisasi Quarter Sebelumnya, dispatched per tab (2026-07-30) — "mr" has
  // no direct PsspKontrak grouping of its own, so it's the sum of realisasi
  // across whichever outlets that MR is currently assigned (same rollup
  // pattern realSalesAgg below uses for real sales).
  function realisasiSebelumnyaFor(code: string, name: string): number {
    if (tab === "outlet") return realisasiSebelumnyaByOutlet.get(code) ?? 0;
    if (tab === "customer") return realisasiSebelumnyaByCust.get(code) ?? 0;
    if (tab === "produk") return realisasiSebelumnyaByProdName.get(normName(name)) ?? 0;
    const outlets = outletsByMr.get(code) ?? [];
    return outlets.reduce((s, o) => s + (realisasiSebelumnyaByOutlet.get(o) ?? 0), 0);
  }

  // DIR10001B is outlet-level only — no per-customer/per-product sales value
  // exists there, so "customer"/"produk" tabs have nothing real to show here
  // (produk's own "Sales Aktif" column elsewhere is a qty×HNA derivation, a
  // different metric — see salesValueByProduk above — not this card's YoY view).
  function realSalesAgg(code: string): SalesAgg {
    if (tab === "outlet") return salesAggByOutlet.get(code) ?? { historisTahunLalu: 0, ytd: 0, comparable: 0 };
    if (tab === "mr") {
      const outlets = outletsByMr.get(code) ?? [];
      return outlets.reduce((acc, o) => {
        const a = salesAggByOutlet.get(o);
        if (a) { acc.historisTahunLalu += a.historisTahunLalu; acc.ytd += a.ytd; acc.comparable += a.comparable; }
        return acc;
      }, { historisTahunLalu: 0, ytd: 0, comparable: 0 });
    }
    return { historisTahunLalu: 0, ytd: 0, comparable: 0 };
  }

  function computeRealSales(code: string, estimasi: number): SalesFigures {
    const agg = realSalesAgg(code);
    const salesPlusEst = agg.ytd + estimasi;
    const growthPct = agg.comparable > 0 ? ((agg.ytd - agg.comparable) / agg.comparable) * 100 : 0;
    const achievementBase = lastCompletedMonth > 0 && agg.historisTahunLalu > 0
      ? agg.historisTahunLalu * lastCompletedMonth / 12
      : 0;
    const achievementPct = achievementBase > 0 ? (salesPlusEst / achievementBase) * 100 : 0;
    return {
      historis2025: agg.historisTahunLalu,
      salesYtd: agg.ytd,
      salesPlusEst,
      growthPct,
      achievementPct,
      salesComparable: agg.comparable,
      achievementBase,
    };
  }

  // ListingFeeKontrak.value is the CONTRACT's total, repeated on every one of
  // its product rows (same "value duplicated per row" shape as PsspKontrak.biaya
  // — see computeActivePsspStats in activePssp.ts) — must dedupe by (outlet,
  // noreq) before summing, or a contract with N products would multiply-count
  // its own value N times (found via a live bug report: one outlet's Listing
  // Fee showed ~18x too high because its 22-product contract got summed 22
  // times instead of once).
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
  const qtyByItemKode = new Map(salesQtyRaw.map((r) => [r.itemKode, toNum(r._sum.qty)]));

  // "Sales Aktif" per product is DERIVED (qty × HNA) rather than a real observed
  // Rupiah figure like the outlet-level one above — OutletSalesMonthly is a
  // quantity feed (same one targetCalculation.ts uses), there's no per-product
  // Rupiah sales value model. itemKode matches Product.kodeProduk directly
  // (unlike PSSP's kdProduk, which is a different code namespace entirely).
  const productCodesForSales = [...qtyByItemKode.keys()];
  const hnaProducts = productCodesForSales.length > 0
    ? (await prisma.product.findMany({
        where: { kodeProduk: { in: productCodesForSales } },
        select: { kodeProduk: true, hna: true },
      })) as { kodeProduk: string; hna: { toString(): string } }[]
    : [];
  const hnaByKodeProduk = new Map(hnaProducts.map((p) => [p.kodeProduk, toNum(p.hna)]));
  const salesValueByProduk = new Map<string, number>();
  for (const [itemKode, qty] of qtyByItemKode) {
    salesValueByProduk.set(itemKode, qty * (hnaByKodeProduk.get(itemKode) ?? 0));
  }

  // Active PSSP rows grouped by outlet (kdOutlet matches kodePI directly) and
  // by normalized product NAME (kdProduk ≠ kodeProduk, see normName above).
  const activePsspByOutlet = new Map<string, ActivePsspRow[]>();
  const activePsspByProdName = new Map<string, ActivePsspRow[]>();
  for (const r of activePssp) {
    if (r.kdOutlet) {
      const list = activePsspByOutlet.get(r.kdOutlet) ?? [];
      list.push(r);
      activePsspByOutlet.set(r.kdOutlet, list);
    }
    if (r.nmProduk) {
      const key = normName(r.nmProduk);
      const list = activePsspByProdName.get(key) ?? [];
      list.push(r);
      activePsspByProdName.set(key, list);
    }
  }

  const groupMap = new Map<string, { key: TerritoryKey; items: typeof lineItems }>();

  if (tab === "mr") {
    for (const mr of mrUsers) {
      groupMap.set(mr.nip, { key: { code: mr.nip, name: mr.name }, items: [] });
    }
  } else if (tab === "outlet") {
    const mrOutletDetails = outletKodesForMR.length > 0
      ? (await prisma.outlet.findMany({
          where: { kodePI: { in: outletKodesForMR } },
          select: { kodePI: true, namaOutlet: true },
        })) as { kodePI: string; namaOutlet: string }[]
      : [];
    for (const o of mrOutletDetails) {
      if (!groupMap.has(o.kodePI)) groupMap.set(o.kodePI, { key: { code: o.kodePI, name: o.namaOutlet }, items: [] });
    }
  }
  // "produk" tab: no pre-seeding — products only appear once actually planned.

  for (const li of lineItems) {
    // 2026-07-30: customers with no real kodeCust no longer get their own
    // synthetic "no-code:Name" row on the Per Customer tab — just excluded
    // entirely rather than shown under a fabricated identity.
    if (tab === "customer" && !li.kodeCust) continue;
    const key = getTerritoryKey(li);
    if (!groupMap.has(key.code)) groupMap.set(key.code, { key, items: [] });
    groupMap.get(key.code)!.items.push(li);
  }

  const groups: TerritoryGroup[] = [...groupMap.values()]
    .map(({ key, items }) => {
      let estimasi = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
      const produkPsspSet = new Set<string>();
      for (const li of items) {
        const base = toNum(li.rencanaTotalBiaya);
        const pengaliNilaiR = li.pengaliNilaiR != null ? toNum(li.pengaliNilaiR) : 1;
        const psspPct = toNum(li.persenPsspDokter) * pengaliNilaiR;
        const discPct = toNum(li.persenDiskon) + toNum(li.persenDp) + toNum(li.persenListingFee);
        const entPct  = toNum(li.persenEntertain);
        estimasi       += base;
        psspTotal      += base * psspPct;
        discountTotal  += base * discPct;
        entertainTotal += base * entPct;
        if (psspPct > 0) produkPsspSet.add(li.kodeProduk);
      }
      const terstandarisasi = items.filter((li) => li.statusStandarisasi === "SUDAH_STANDARISASI").length;
      const prosesStandar   = items.filter((li) => li.statusStandarisasi === "PROSES_PENGAJUAN").length;
      const realisasi = tab === "outlet" ? (realisasiByOutlet.get(key.code) ?? 0)
        : tab === "customer" ? (realisasiByCust.get(key.code) ?? 0)
        : 0;

      // Matriks Summary Per Outlet / Per Produk (2026-07-27) — active PSSP rows
      // matched by outlet code (outlet tab) or normalized product name (produk
      // tab, see normName). Both tabs get estimasiAktif/userPsspAktif; the
      // aktif+pengajuan UNION headcount and Listing Fee only apply per outlet.
      // "mr" rolls up every outlet that MR is assigned (2026-07-31, added for
      // Ringkasan's "Estimasi & Aktif" figure — previously always 0 here since
      // ActivePsspRow has no direct per-MR grouping of its own, same rollup
      // pattern outletsByMr already uses for realSalesAgg above).
      const activeRows = tab === "outlet" ? (activePsspByOutlet.get(key.code) ?? [])
        : tab === "produk" ? (activePsspByProdName.get(normName(key.name)) ?? [])
        : tab === "mr" ? (outletsByMr.get(key.code) ?? []).flatMap((o) => activePsspByOutlet.get(o) ?? [])
        : [];
      const estimasiAktif = activeRows.reduce((s, r) => s + r.estBaris, 0);

      // Biaya Aktif (2026-07-27) — PsspKontrak.biaya is a flat per-CONTRACT
      // total, repeated on every product row of that contract in the source
      // sheet (same shape as the Listing Fee bug fixed above), so it must be
      // deduped by cUrut before summing or a multi-product contract would
      // multiply-count its own biaya once per product.
      const seenContracts = new Set<string>();
      let biayaAktif = 0;
      for (const r of activeRows) {
        if (seenContracts.has(r.cUrut)) continue;
        seenContracts.add(r.cUrut);
        biayaAktif += r.biaya;
      }

      // Pelunasan (%) dari Estimasi, secara Running Rate (2026-07-27 follow-up)
      // — outlet only. Same concept as ContractCard's per-contract Running Rate
      // badge: "expected lunas by now" = estBaris × (elapsed/total periode
      // kontrak), i.e. how much SHOULD already be paid given how far the
      // contract's own period has run. Aggregated across every active contract
      // at this outlet as actual÷expected (not an average of per-contract %),
      // so one badly-lagging contract can't get diluted out by an on-time one.
      let expectedLunas = 0, actualLunasForRR = 0;
      if (tab === "outlet") {
        const activeByContract = new Map<string, ActivePsspRow[]>();
        for (const r of activeRows) {
          const list = activeByContract.get(r.cUrut) ?? [];
          list.push(r);
          activeByContract.set(r.cUrut, list);
        }
        for (const rows of activeByContract.values()) {
          const sumEst = rows.reduce((s, r) => s + r.estBaris, 0);
          const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
          expectedLunas += sumEst * elapsedFraction(rows[0].prdAwal, rows[0].prdAkhir);
          actualLunasForRR += sumLunas;
        }
      }
      const pelunasanRunningRate = expectedLunas > 0 ? (actualLunasForRR / expectedLunas) * 100 : null;

      const activeCustKeys = new Set(activeRows.map((r) => r.kdCust));
      const draftCustKeys = new Set(items.map((li) => li.kodeCust ?? `name:${li.namaCust}`));
      const userPsspAktifEstimasi = tab === "outlet"
        ? new Set([...activeCustKeys, ...draftCustKeys]).size
        : activeCustKeys.size;

      const salesAktif = tab === "outlet" ? (salesValueByOutlet.get(key.code) ?? 0)
        : tab === "produk" ? (salesValueByProduk.get(key.code) ?? 0)
        : 0;
      const listingFeeTotal = tab === "outlet" ? (listingFeeByOutlet.get(key.code) ?? 0) : 0;

      const pasienRows = items.filter((li) => li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
      const avgPasienPerUser = tab === "produk" && pasienRows.length > 0
        ? pasienRows.reduce((s, li) => s + li.jumlahPasienHari!, 0) / pasienRows.length
        : null;
      const stRows = items.filter((li) => li.qtyProdukResep != null && li.jumlahPasienHari != null && li.jumlahPasienHari > 0);
      const avgStPerPasien = tab === "produk" && stRows.length > 0
        ? stRows.reduce((s, li) => s + li.qtyProdukResep! / li.jumlahPasienHari!, 0) / stRows.length
        : null;

      const qoq = qoqIniByCode.get(key.code);
      const estimasiQuarterIni = qoq?.ini ?? 0;
      const realisasiQuarterSebelumnya = realisasiSebelumnyaFor(key.code, key.name);
      // Null (not -100%) when there's nothing to compare: no realisasi at all
      // last quarter, OR no submission at all yet this quarter (see hasIni
      // note above) — a missing "ini" isn't the same as a genuine drop to zero.
      const growthVsQuarterSebelumnyaPct = realisasiQuarterSebelumnya > 0 && qoq?.hasIni
        ? ((estimasiQuarterIni - realisasiQuarterSebelumnya) / realisasiQuarterSebelumnya) * 100
        : null;

      return {
        code: key.code,
        name: key.name,
        pic: findPic(key.code),
        estimasi,
        variasiProduk: new Set(items.map((li) => li.kodeProduk)).size,
        variasiProdukFokus: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
        produkPssp: produkPsspSet.size,
        customer: new Set(items.map(custIdentity)).size,
        pengajuan: items.length,
        terstandarisasi,
        prosesStandar,
        gap: items.length - terstandarisasi,
        psspTotal,
        discountTotal,
        entertainTotal,
        budgetTotal: psspTotal + discountTotal + entertainTotal,
        realisasi,
        gapVsRealisasi: estimasi - realisasi,
        sales: computeRealSales(key.code, estimasi),
        estimasiAktif,
        userPsspAktif: activeCustKeys.size,
        userPsspAktifEstimasi,
        salesAktif,
        listingFeeTotal,
        avgPasienPerUser,
        avgStPerPasien,
        pelunasanRunningRate,
        biayaAktif,
        estimasiQuarterIni,
        realisasiQuarterSebelumnya,
        growthVsQuarterSebelumnyaPct,
      };
    })
    // "outlet"/"customer": GAP tertinggi (vs prior realisasi) is the default —
    // flags "dulu jelek kok estimasinya tinggi sekarang". This is only the
    // INITIAL order now — TerritoryTable's column headers are independently
    // sortable client-side (2026-07-30, replaces the old GAP/Estimasi pill
    // toggle here). Other tabs have no realisasi/gap concept at all, so they
    // default to sorting by estimasi.
    .sort((a, b) => {
      if (!(tab === "outlet" || tab === "customer")) {
        return b.estimasi - a.estimasi;
      }
      // "outlet": PSSP Aktif paling atas dulu (official spec, item #2: "Urutkan
      // outlet dengan PSSP Aktif paling atas, lalu urutkan berdasarkan GAP
      // Tertinggi") — briefly reverted to realisasi-based on 2026-07-27, then
      // reverted back per the spec re-confirmed same day. "customer" has no
      // PSSP-aktif concept computed (activeRows above is only populated for
      // "outlet"/"produk"), so it keeps the realisasi-based criterion.
      const aHas = tab === "outlet" ? a.estimasiAktif > 0 : a.realisasi > 0;
      const bHas = tab === "outlet" ? b.estimasiAktif > 0 : b.realisasi > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return aHas ? b.gapVsRealisasi - a.gapVsRealisasi : b.estimasi - a.estimasi;
    });

  // ── Tab labels ────────────────────────────────────────────────────────────

  const ALL_TABS: { key: Tab; label: string }[] = [
    { key: "ringkasan",          label: "Ringkasan" },
    { key: "mr",                 label: "Per Personil" },
    { key: "outlet",             label: "Per Outlet" },
    { key: "customer",           label: "Per Customer" },
    { key: "produk-rekomendasi", label: "Per Produk Rekomendasi" },
    { key: "produk",             label: "Per Produk" },
  ];
  // Ringkasan tab itself hidden for roles that can't see it — matches rawTab's fallback above.
  const TABS = ALL_TABS.filter((t) => t.key !== "ringkasan" || showRingkasan);
  const CODE_LABEL: Record<Tab, string> = {
    ringkasan: "Ringkasan", outlet: "Outlet", customer: "Customer",
    produk: "Produk", "produk-rekomendasi": "Produk Rekomendasi", mr: "Personil",
  };

  // Pengajuan+Aktif subtext under the table header (2026-07-31 request) —
  // same Aktif/Pengajuan split already shown per-row in the Estimasi column,
  // summed across every row of the active tab so the header caption isn't a
  // black box. estimasiAktif is only ever populated for "outlet"/"produk"
  // (see estimasiAktif above) — "customer"/"mr" naturally sum to 0, so the
  // Aktif clause is dropped for those instead of showing a misleading "Rp 0".
  const estimasiTotal = groups.reduce((s, g) => s + g.estimasi, 0);
  const estimasiAktifTotal = groups.reduce((s, g) => s + g.estimasiAktif, 0);

  // ── Ringkasan tab aggregates (2026-07-31) — always Personil-scoped (`tab`
  // reads as "mr" here whenever rawTab is "ringkasan", see the GroupingTab
  // indirection above), never averaged-of-percentages (growth-of-totals,
  // same house rule as MonitoringChecklist's own historis2025/salesYtd sums).
  const ringkasanBudgetTotal = groups.reduce((s, g) => s + g.budgetTotal, 0);
  // "Estimasi % Target" itself is computed inline in MonitoringChecklist from
  // the targetTotal/estimasiCombined props it already receives — no need to
  // duplicate that math here too.
  const ringkasanEstimasiCombined = estimasiTotal + estimasiAktifTotal;
  const ringkasanCostRatioPct = ringkasanEstimasiCombined > 0 ? (ringkasanBudgetTotal / ringkasanEstimasiCombined) * 100 : null;
  const ringkasanEstimasiQuarterIniTotal = groups.reduce((s, g) => s + g.estimasiQuarterIni, 0);
  const ringkasanRealisasiQuarterSebelumnyaTotal = groups.reduce((s, g) => s + g.realisasiQuarterSebelumnya, 0);
  const ringkasanGrowthPct = ringkasanRealisasiQuarterSebelumnyaTotal > 0
    ? ((ringkasanEstimasiQuarterIniTotal - ringkasanRealisasiQuarterSebelumnyaTotal) / ringkasanRealisasiQuarterSebelumnyaTotal) * 100
    : null;

  const monitoringGroups: MonitoringGroup[] = groups.map((g) => ({
    code: g.code,
    name: g.name,
    pic: g.pic,
    estimasi: g.estimasi,
    variasiProduk: g.variasiProduk,
    variasiProdukFokus: g.variasiProdukFokus,
    produkPssp: g.produkPssp,
    customer: g.customer,
    pengajuan: g.pengajuan,
    terstandarisasi: g.terstandarisasi,
    prosesStandar: g.prosesStandar,
    gap: g.gap,
    psspTotal: g.psspTotal,
    discountTotal: g.discountTotal,
    entertainTotal: g.entertainTotal,
    budgetTotal: g.budgetTotal,
    realisasi: g.realisasi,
    gapVsRealisasi: g.gapVsRealisasi,
    historis2025: g.sales.historis2025,
    salesYtd: g.sales.salesYtd,
    salesPlusEst: g.sales.salesPlusEst,
    growthPct: g.sales.growthPct,
    achievementPct: g.sales.achievementPct,
    salesComparable: g.sales.salesComparable,
    achievementBase: g.sales.achievementBase,
    estimasiAktif: g.estimasiAktif,
    userPsspAktif: g.userPsspAktif,
    userPsspAktifEstimasi: g.userPsspAktifEstimasi,
    salesAktif: g.salesAktif,
    listingFeeTotal: g.listingFeeTotal,
    avgPasienPerUser: g.avgPasienPerUser,
    avgStPerPasien: g.avgStPerPasien,
    biayaAktif: g.biayaAktif,
    pelunasanRunningRate: g.pelunasanRunningRate,
    estimasiQuarterIni: g.estimasiQuarterIni,
    realisasiQuarterSebelumnya: g.realisasiQuarterSebelumnya,
    growthVsQuarterSebelumnyaPct: g.growthVsQuarterSebelumnyaPct,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1>Summary POA</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
          {isDefaultBounded && (
            <span style={{ color: "var(--color-text-faint)" }}> · menampilkan {defaultPeriodFrom} – {quarterIni} (gunakan Filter Periode untuk lihat semua)</span>
          )}
        </p>
      </div>

      {/* Tab bar */}
      <Card padded={false}>
        <div className="flex gap-0 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {TABS.map((t) => (
            <Link key={t.key}
              href={`/summary?tab=${t.key}${periodQuery}`}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={rawTab === t.key
                ? { borderColor: "var(--color-blue)", color: "var(--color-blue)" }
                : { borderColor: "transparent", color: "var(--color-text-muted)" }}>
              {t.label}
            </Link>
          ))}
        </div>
      </Card>

      {/* Filter is global (applies to every tab's underlying query), so it
          stays visible regardless of which tab is active — its hidden `tab`
          field must be rawTab (the real selected tab), not the internal
          GroupingTab substitute, or submitting it from Ringkasan/Produk
          Rekomendasi would silently bounce the user to Per Personil. */}
      <div className="flex justify-end">
        <SummaryFilterModal tab={rawTab} periods={allPeriods} periodFrom={periodFrom} periodTo={periodTo} />
      </div>

      {/* Ringkasan (2026-07-31) — its own tab now, always Personil-scoped
          (`tab` reads "mr" here, see the GroupingTab indirection above). */}
      {rawTab === "ringkasan" && (
        <MonitoringChecklist groups={monitoringGroups} totals={globalTotals} salesAvailable={tab === "outlet" || tab === "mr"}
          poaCount={poas.length} outletCount={outletCodes.length} produkCount={allProductSet.size}
          targetTotal={targetTotal} costRatioPct={ringkasanCostRatioPct} growthPct={ringkasanGrowthPct} />
      )}

      {/* Per Produk Rekomendasi (2026-07-31) — one section per Produk Fokus paket. */}
      {rawTab === "produk-rekomendasi" && (
        <ProdukRekomendasiView stats={paketRekomendasiStats} />
      )}

      {(rawTab === "outlet" || rawTab === "customer" || rawTab === "produk" || rawTab === "mr") && (
        <>
          {/* Table header row */}
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{CODE_LABEL[tab]}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              {estimasiAktifTotal > 0
                ? `Aktif ${formatRp(estimasiAktifTotal)} · Pengajuan ${formatRp(estimasiTotal)}`
                : `Pengajuan ${formatRp(estimasiTotal)}`}
            </p>
          </div>

          {/* Per-row breakdown for the active tab. */}
          <TerritoryTable groups={monitoringGroups} codeLabel={CODE_LABEL[tab]} showRealisasi={tab === "outlet" || tab === "customer"} variant={tab}
            quarterIni={quarterIni} quarterSebelumnya={quarterSebelumnya} />
        </>
      )}
    </div>
  );
}
