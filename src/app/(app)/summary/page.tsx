import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips, NON_DRAFT_STATUSES } from "@/lib/authz";
import { getAllPakets } from "@/lib/paketProduk";
import { spesLabel } from "@/lib/spesialisasi";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { getActivePsspByOutlets, type ActivePsspRow } from "@/app/actions/customer";
import { Card } from "@/components/ui/Card";
import { TerritoryTable } from "@/components/poa/TerritoryTable";
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

// "produk-rekomendasi" has its own bespoke data fetch (not a real
// outlet/customer/produk/mr grouping) — everywhere below that already
// groups/queries by those 4 keeps doing exactly that, unchanged, by reading
// the narrower `tab` (GroupingTab) local further down instead of the raw URL
// param. Only the render switch at the bottom and the tab bar itself need to
// know about the raw value — see `rawTab` there. (The "ringkasan" tab that
// used to also need this distinction was removed 2026-07-31.)
type Tab = "mr" | "outlet" | "customer" | "spesialisasi" | "produk-rekomendasi" | "produk";
type GroupingTab = "outlet" | "customer" | "spesialisasi" | "produk" | "mr";

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
  // Headcount counterpart of the above, "spesialisasi" tab only (2026-08-03,
  // stakeholder item #13: growth by JUMLAH customer, not just by value) — 0 /
  // null on every other tab, same "no data here" convention as the by-value
  // fields above.
  customerSebelumnya: number;
  growthCustomerPct: number | null;
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

function previousQuarterPeriod(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10), q = parseInt(m[2], 10);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "mr",                 label: "Per Personil" },
  { key: "outlet",             label: "Per Outlet" },
  { key: "customer",           label: "Per Customer" },
  { key: "spesialisasi",       label: "Per Spesialisasi" },
  { key: "produk-rekomendasi", label: "Per Produk Rekomendasi" },
  { key: "produk",             label: "Per Produk" },
];

// Lightweight placeholder shown while SummaryContent streams in (2026-08-03
// — see the split below: this page used to block on ALL of its aggregation
// before rendering anything at all, including the tab bar/filter that don't
// need any of that data). Row count is just a visual approximation of
// TerritoryTable, not tied to any real data.
function SummarySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 w-64 rounded" style={{ background: "var(--color-bg-subtle)" }} />
      <Card>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 rounded" style={{ background: "var(--color-bg-subtle)" }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");

  const params = await searchParams;
  // Ringkasan tab removed (2026-07-31) — rawTab is just the raw ?tab= param
  // now, no more "ringkasan"-only redirect-to-"mr" gating needed. "tab"
  // (GroupingTab) folds "produk-rekomendasi" into "produk" (2026-07-31
  // rework — this tab now reuses the exact same per-product rows/columns as
  // "Per Produk", just split into Fokus/Low Hanging Fruit/Blue Ocean/Red
  // Ocean/Standarisasi sections instead of one flat table — see the
  // kategori split further down), so the SAME rich per-product grouping
  // logic below (activePsspByProdName, salesValueByProduk, avgPasienPerUser,
  // etc.) computes for it too, instead of a separate bespoke aggregate.
  const rawTab: Tab = (params.tab as Tab) ?? "mr";
  const tab: GroupingTab = rawTab === "produk-rekomendasi" ? "produk" : rawTab;
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
  // size. Tightened further same day (2026-07-31, "dibatesin untuk periode
  // sebelumnya aja") from a 4-quarter window down to just current + 1
  // previous quarter — that's the narrowest window that still lets
  // Growth-vs-Quarter-Sebelumnya (which needs exactly one prior quarter's
  // realisasi) work without an explicit filter. "Semua" is still one click
  // away via the filter's "Lihat semua periode" link (SummaryFilterModal),
  // which sets an explicit periodFrom and so counts as hasPeriodFilter.
  const defaultPeriodFrom = previousQuarterPeriod(currentQuarter()) ?? currentQuarter();
  const isDefaultBounded = !hasPeriodFilter;

  // ── Data ──────────────────────────────────────────────────────────────────

  // Shared helper (not a local reimplementation) so ADMIN/GM correctly see
  // every MR company-wide instead of walking nipAtasan from their own NIP —
  // neither role reports to/from anyone in that chain, so the old local
  // getSubordinateMRNips(nip) always returned an empty list for them
  // (2026-07-23 fix: "sebagai admin harusnya summary-nya kelihatan semua").
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const mrNips = await getSubordinateMRNips(actor);

  // Cheap, deliberately UNBOUNDED (full history) distinct-periods query for the
  // filter dropdown — kept in the shell (not Suspense-deferred like everything
  // else below) so the filter is usable the instant the page loads, same as
  // the tab bar. select-only on an indexed column, nowhere near as expensive
  // as the line-item fetch/aggregation SummaryContent does.
  const allPoasForPeriods = mrNips.length > 0
    ? (await prisma.poaForm.findMany({
        where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT_STATUSES } },
        select: { period: true },
        distinct: ["period"],
      })) as { period: string }[]
    : [];
  const allPeriods = [...new Set(allPoasForPeriods.map((p) => p.period))].sort();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1>Summary POA</h1>
      </div>

      {/* Tab bar — static, no DB dependency, renders immediately */}
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

      <div className="flex justify-end">
        <SummaryFilterModal tab={rawTab} periods={allPeriods} periodFrom={periodFrom} periodTo={periodTo} />
      </div>

      {/* Everything below needs the heavy line-item fetch/aggregation — streamed
          in separately (2026-08-03) so it doesn't block the shell above from
          showing up. key= forces a fresh Suspense fallback on tab/filter change
          instead of showing stale content while the new data loads. */}
      <Suspense key={`${rawTab}|${periodFrom ?? ""}|${periodTo ?? ""}`} fallback={<SummarySkeleton />}>
        <SummaryContent
          mrNips={mrNips}
          rawTab={rawTab}
          periodFrom={periodFrom}
          periodTo={periodTo}
          hasPeriodFilter={hasPeriodFilter}
          periodQuery={periodQuery}
          isDefaultBounded={isDefaultBounded}
          defaultPeriodFrom={defaultPeriodFrom}
        />
      </Suspense>
    </div>
  );
}

async function SummaryContent({
  mrNips, rawTab, periodFrom, periodTo, hasPeriodFilter, isDefaultBounded, defaultPeriodFrom,
}: {
  mrNips: string[];
  rawTab: Tab;
  periodFrom: string | null;
  periodTo: string | null;
  hasPeriodFilter: boolean;
  periodQuery: string;
  isDefaultBounded: boolean;
  defaultPeriodFrom: string;
}) {
  const tab: GroupingTab = rawTab === "produk-rekomendasi" ? "produk" : rawTab;

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

  // target included (2026-07-31, Ringkasan tab's "Estimasi % Target") — same
  // real, atasan-set Rupiah quota SalesAchievementTable.tsx already sums for
  // the Monitoring page, never a fabricated stand-in. (allPeriods for the
  // filter dropdown is now fetched in the shell above SummaryContent — see
  // SummaryPage — so it's available before this heavy fetch even starts.)
  const poas = mrNips.length > 0
    ? (await prisma.poaForm.findMany({ where: poaWhere })) as { id: string; ownerId: string; period: string; target: { toString(): string } | null }[]
    : [];
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
        select: { poaId: true, kodePI: true, kodeCust: true, kodeProduk: true, spesialisasi: true, rencanaTotalBiaya: true },
      })) as { poaId: string; kodePI: string | null; kodeCust: string | null; kodeProduk: string; spesialisasi: string; rencanaTotalBiaya: { toString(): string } | number }[]
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
    if (tab === "spesialisasi") return spesLabel(li.spesialisasi);
    return qoqPoaOwnerMap.get(li.poaId) ?? "-";
  }

  // hasIni tracks whether this code has an actual POA submitted THIS quarter
  // (not just whether its estimasi summed to something > 0) — without it, a
  // code with no Q-ini submission at all (hasn't gotten around to it yet)
  // reads identically to "estimasi genuinely collapsed to zero", both showing
  // a -100% growth. Only the latter should ever say -100%; the former should
  // show "belum ada data" (2026-07-30).
  // custKeys tracks distinct customers this quarter per code — the headcount
  // counterpart to `ini` (2026-08-03, item #13's "Growth Berdasarkan Jumlah
  // Customer"), same quarter-ini scope as `ini` itself (not the wider default
  // window `items`/`groups` below may use).
  const qoqIniByCode = new Map<string, { ini: number; hasIni: boolean; custKeys: Set<string> }>();
  for (const li of qoqLineItems) {
    const code = qoqCode(li);
    if (!code) continue;
    const agg = qoqIniByCode.get(code) ?? { ini: 0, hasIni: false, custKeys: new Set<string>() };
    agg.ini += toNum(li.rencanaTotalBiaya);
    agg.hasIni = true;
    if (li.kodeCust) agg.custKeys.add(li.kodeCust);
    qoqIniByCode.set(code, agg);
  }

  const lineItems = poaIds.length > 0
    ? (await prisma.poaLineItem.findMany({
        where: { poaId: { in: poaIds } },
        select: {
          poaId: true,
          kodePI: true,
          kodeCust: true,
          namaCust: true,
          namaProduk: true,
          kodeProduk: true,
          spesialisasi: true,
          statusStandarisasi: true,
          rencanaTotalBiaya: true,
          persenPsspDokter: true,
          persenDiskon: true,
          persenDp: true,
          persenListingFee: true,
          persenEntertain: true,
          pengaliNilaiR: true,
          jumlahPasienHari: true,
          qtyProdukResep: true,
        },
      })) as {
        poaId: string;
        kodePI: string | null;
        kodeCust: string | null;
        namaCust: string;
        namaProduk: string;
        kodeProduk: string;
        spesialisasi: string;
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

  // Customer → spesialisasi (PM label) lookup, needed to bucket PsspKontrak
  // realisasi rows by spesialisasi below — PsspKontrak itself has no
  // spesialisasi column, only kdCust (2026-08-03, stakeholder item #13: growth
  // vs quarter sebelumnya on the "Per Spesialisasi" tab was silently always
  // null, see realisasiSebelumnyaFor below — this was the missing piece).
  const custSpesRows = custCodes.length > 0
    ? (await prisma.customer.findMany({
        where: { kodeCustomer: { in: custCodes } },
        select: { kodeCustomer: true, spesialisasi: true },
      })) as { kodeCustomer: string | null; spesialisasi: string }[]
    : [];
  const spesByCust = new Map(
    custSpesRows.filter((c) => c.kodeCustomer).map((c) => [c.kodeCustomer as string, spesLabel(c.spesialisasi)])
  );

  const realisasiSebelumnyaByOutlet = new Map<string, number>();
  const realisasiSebelumnyaByCust = new Map<string, number>();
  const realisasiSebelumnyaByProdName = new Map<string, number>();
  const realisasiSebelumnyaBySpes = new Map<string, number>();
  // Distinct customers WITH realisasi > 0 last quarter, per spesialisasi —
  // the baseline for "Growth Berdasarkan Jumlah Customer" (item #13), a
  // headcount-based counterpart to the existing by-value growth column.
  const custSebelumnyaBySpes = new Map<string, Set<string>>();
  for (const r of realisasiPsspRows) {
    const v = sumLunasForMonths(r.lunasByPeriod, quarterSebelumnyaMonths);
    if (v === 0) continue;
    if (r.kdOutlet) realisasiSebelumnyaByOutlet.set(r.kdOutlet, (realisasiSebelumnyaByOutlet.get(r.kdOutlet) ?? 0) + v);
    if (r.kdCust) realisasiSebelumnyaByCust.set(r.kdCust, (realisasiSebelumnyaByCust.get(r.kdCust) ?? 0) + v);
    if (r.nmProduk) {
      const key = normName(r.nmProduk);
      realisasiSebelumnyaByProdName.set(key, (realisasiSebelumnyaByProdName.get(key) ?? 0) + v);
    }
    const spes = r.kdCust ? spesByCust.get(r.kdCust) : undefined;
    if (spes) {
      realisasiSebelumnyaBySpes.set(spes, (realisasiSebelumnyaBySpes.get(spes) ?? 0) + v);
      const set = custSebelumnyaBySpes.get(spes) ?? new Set<string>();
      set.add(r.kdCust);
      custSebelumnyaBySpes.set(spes, set);
    }
  }

  // Build poa→owner map
  const poaOwnerMap = new Map(poas.map((p) => [p.id, p.ownerId]));

  // Dedupe by kodeCust when available, falling back to namaCust only for
  // rows with no code at all — deduping by name alone (the old behaviour)
  // risked over/under-counting whenever the same customer had a code on
  // some line items and not others (2026-07-30, part of validating "customer
  // per MR" counts are correct).
  function custIdentity(li: { kodeCust: string | null; namaCust: string }): string {
    return li.kodeCust ?? li.namaCust;
  }

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
    if (tab === "spesialisasi") {
      // Grouped by DISPLAY label (spesLabel), not the raw DB value — several
      // raw spesialisasi strings collapse to the same PM label (e.g.
      // "INTERNIST" and "PENYAKIT DALAM (INTERNIST)" both -> "INTERNIST
      // UMUM", see spesLabel), and those should merge into one row here
      // rather than appearing as separate near-duplicate specialties.
      const label = spesLabel(li.spesialisasi);
      return { code: label, name: label };
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

  // ── Per Produk Rekomendasi tab (reworked 2026-07-31) ───────────────────────
  // Flat kategori sections (Produk Fokus / Low Hanging Fruit / Blue Ocean /
  // Red Ocean / Standarisasi), each a full per-product table — was one card
  // per Produk Fokus paket with aggregate coverage bars, replaced per
  // request. Just needs the per-product kategori classification here; the
  // actual per-product rows/columns are the SAME ones "Per Produk" computes
  // (tab folds "produk-rekomendasi" → "produk" above), split by kategori
  // further down once `groups` exists. Gated behind rawTab (only fetched
  // when this tab is actually open) — same "don't pay for what isn't
  // rendered" principle as the Data Sales query below.
  const outletProductKriteriaRows = rawTab === "produk-rekomendasi" && outletKodesForMR.length > 0
    ? (await prisma.outletProductKriteria.findMany({
        where: { kodePI: { in: outletKodesForMR } },
        select: { kodeProduk: true, kategori: true, kriteriaBaru: true },
      })) as { kodeProduk: string; kategori: string; kriteriaBaru: string }[]
    : [];

  const [activePssp, listingFeeRows, salesValueRaw, salesQtyRaw] = await Promise.all([
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
  ]) as [
    ActivePsspRow[],
    { kdOutlet: string | null; noreq: string; value: { toString(): string } }[],
    { kodePI: string; _sum: { valueSales: { toString(): string } | null } }[],
    { itemKode: string; _sum: { qty: { toString(): string } | null } }[],
  ];

  const outletsByMr = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const list = outletsByMr.get(row.nipMR) ?? [];
    list.push(row.kodePI);
    outletsByMr.set(row.nipMR, list);
  }

  // Realisasi Quarter Sebelumnya, dispatched per tab (2026-07-30).
  function realisasiSebelumnyaFor(code: string, name: string): number {
    if (tab === "outlet") return realisasiSebelumnyaByOutlet.get(code) ?? 0;
    if (tab === "customer") return realisasiSebelumnyaByCust.get(code) ?? 0;
    if (tab === "produk") return realisasiSebelumnyaByProdName.get(normName(name)) ?? 0;
    // code IS the spesialisasi label itself here (see getTerritoryKey) — no
    // outlet/MR rollup needed, unlike the fallback branch below.
    if (tab === "spesialisasi") return realisasiSebelumnyaBySpes.get(code) ?? 0;
    const outlets = outletsByMr.get(code) ?? [];
    return outlets.reduce((s, o) => s + (realisasiSebelumnyaByOutlet.get(o) ?? 0), 0);
  }

  /** Distinct customers with realisasi > 0 last quarter for this spesialisasi
   * — only meaningful for the "spesialisasi" tab (item #13); 0 elsewhere. */
  function customerSebelumnyaFor(code: string): number {
    if (tab !== "spesialisasi") return 0;
    return custSebelumnyaBySpes.get(code)?.size ?? 0;
  }

  // Ringkasan tab (and its "Data Sales" YoY computation) has been removed —
  // computeRealSales / salesHistoryRaw are no longer needed.
  // SalesFigures fields are kept zero for TerritoryTable's existing sales columns.
  function computeRealSales(_code: string, _estimasi: number): SalesFigures {
    return { historis2025: 0, salesYtd: 0, salesPlusEst: _estimasi, growthPct: 0, achievementPct: 0, salesComparable: 0, achievementBase: 0 };
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

      // Growth Berdasarkan Jumlah Customer (2026-08-03, stakeholder item #13)
      // — same null-vs-zero convention as growthVsQuarterSebelumnyaPct above,
      // just counting distinct customers instead of Rupiah.
      const customerIniCount = qoq?.custKeys.size ?? 0;
      const customerSebelumnya = customerSebelumnyaFor(key.code);
      const growthCustomerPct = customerSebelumnya > 0 && qoq?.hasIni
        ? ((customerIniCount - customerSebelumnya) / customerSebelumnya) * 100
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
        customerSebelumnya,
        growthCustomerPct,
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

  // Per Produk Rekomendasi kategori split (2026-07-31 rework — was one card
  // per Produk Fokus paket with aggregate coverage bars; request was flat
  // sections instead, each a full per-product table with the same columns as
  // "Per Produk": Produk Fokus, Low Hanging Fruit, Blue Ocean, Red Ocean,
  // Standarisasi). Classifies each already-computed produk group by
  // kodeProduk against OutletProductKriteria (deduped across outlets/pakets,
  // first-seen wins — same simplification the old paket view used) plus
  // getAllPakets() for Fokus, same definition as the Status Fokus/Non-Fokus
  // column on "Per Produk" itself. A product can land in more than one
  // section (Fokus and Low Hanging Fruit aren't mutually exclusive axes).
  const kriteriaByKodeProduk = new Map<string, { kategori: string | null; kriteriaBaru: string | null }>();
  if (rawTab === "produk-rekomendasi") {
    for (const row of outletProductKriteriaRows) {
      if (kriteriaByKodeProduk.has(row.kodeProduk)) continue;
      kriteriaByKodeProduk.set(row.kodeProduk, { kategori: row.kategori, kriteriaBaru: row.kriteriaBaru });
    }
  }
  const produkFokusGroups = groups.filter((g) => getAllPakets(g.name).length > 0);
  const lowHangingFruitGroups = groups.filter((g) => kriteriaByKodeProduk.get(g.code)?.kategori === "Low Hanging Fruit");
  const blueOceanGroups = groups.filter((g) => kriteriaByKodeProduk.get(g.code)?.kategori === "Blue Ocean");
  const redOceanGroups = groups.filter((g) => kriteriaByKodeProduk.get(g.code)?.kategori === "Red Ocean");
  const standarisasiGroups = groups.filter((g) => kriteriaByKodeProduk.get(g.code)?.kriteriaBaru?.startsWith("Produk Sudah Terstandarisasi"));

  // ── Tab labels ────────────────────────────────────────────────────────────

  const CODE_LABEL: Record<Tab, string> = {
    outlet: "Outlet", customer: "Customer", spesialisasi: "Spesialisasi",
    produk: "Produk", "produk-rekomendasi": "Produk Rekomendasi", mr: "Personil",
  };

  const estimasiTotal = groups.reduce((s, g) => s + g.estimasi, 0);
  const estimasiAktifTotal = groups.reduce((s, g) => s + g.estimasiAktif, 0);

  // Map groups → TerritoryTable shape (monitoringGroups removed with Ringkasan tab).

  return (
    <div className="space-y-5">
      {/* Counts line — was part of the static header in SummaryPage's shell;
          moved here since it needs the heavy-fetched mrUsers/poas/lineItems. */}
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
        {isDefaultBounded && (
          <span style={{ color: "var(--color-text-faint)" }}> · menampilkan {defaultPeriodFrom} – {quarterIni} (gunakan Filter Periode untuk lihat semua)</span>
        )}
      </p>

      {/* Per Produk Rekomendasi (reworked 2026-07-31) — flat kategori sections
          instead of one card per paket, each a full per-product table (same
          columns as "Per Produk" below) filtered to that kategori. */}
      {rawTab === "produk-rekomendasi" && (
        <div className="space-y-6">
          {[
            { title: "Produk Fokus", rows: produkFokusGroups },
            { title: "Produk Low Hanging Fruit", rows: lowHangingFruitGroups },
            { title: "Produk Blue Ocean", rows: blueOceanGroups },
            { title: "Produk Red Ocean", rows: redOceanGroups },
            { title: "Produk Standarisasi", rows: standarisasiGroups },
          ].map(({ title, rows }) => (
            <div key={title}>
              <p className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>
                {title} <span style={{ color: "var(--color-text-faint)", fontWeight: 400 }}>({rows.length})</span>
              </p>
              <TerritoryTable groups={rows} codeLabel="Produk" variant="produk"
                quarterIni={quarterIni} quarterSebelumnya={quarterSebelumnya} />
            </div>
          ))}
        </div>
      )}

      {(rawTab === "outlet" || rawTab === "customer" || rawTab === "spesialisasi" || rawTab === "produk" || rawTab === "mr") && (
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
          <TerritoryTable groups={groups} codeLabel={CODE_LABEL[tab]} showRealisasi={tab === "outlet" || tab === "customer"} variant={tab}
            quarterIni={quarterIni} quarterSebelumnya={quarterSebelumnya} />
        </>
      )}
    </div>
  );
}
