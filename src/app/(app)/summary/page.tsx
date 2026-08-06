import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips, NON_DRAFT_STATUSES } from "@/lib/authz";
import { getAllPakets } from "@/lib/paketProduk";
import { spesLabel } from "@/lib/spesialisasi";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { computeMonthlyBreakdown, formatPeriode } from "@/lib/poaUtils";
import { getActivePsspByOutlets, type ActivePsspRow } from "@/app/actions/customer";
import { Card } from "@/components/ui/Card";
import { HeaderInfo } from "@/components/ui/HeaderInfo";
import { TerritoryTable } from "@/components/poa/TerritoryTable";
import { SummaryFilterModal, RingkasanQuarterFilter } from "@/components/poa/SummaryFilterModal";
import { RingkasanBarPair, RingkasanCompareLegend, RingkasanSplitBarPair, RingkasanTargetStackedBar } from "@/components/poa/RingkasanCharts";

// PSSP contract rows key products by name only (Procode ≠ Item Kode across
// systems — see computeOldEstPerMonth in LineItemEditor.tsx for the same
// convention), so matching an active PSSP row to a "produk" tab group must
// normalize on namaProduk, never kodeProduk/kdProduk.
function normName(s: string): string {
  return s.toLowerCase().trim();
}

export const metadata = { title: "Summary · Form POA" };

// ─── Types ────────────────────────────────────────────────────────────────────

// "ringkasan" re-added 2026-08-04 (removed 2026-07-31, brought back per
// request — "tab ringkasan di paling kiri belum ada") as a grand-total card,
// NOT a real grouping — folds to "mr" for every query/computation below
// (grand totals = sum of the per-MR groups, cheapest existing grouping to
// piggyback on), only the render switch and tab bar know it's distinct. See
// `rawTab` further down for where the raw URL value is still needed.
//
// "produk-rekomendasi" (its own bespoke data fetch, not a real
// outlet/customer/produk/mr grouping) was removed as a tab entirely
// (2026-08-06: "tab per produk rekomendasi di summary dihapus aja") — no
// folding logic needed for it anymore.
type Tab = "ringkasan" | "mr" | "outlet" | "customer" | "spesialisasi" | "produk";
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
  variasiProdukKontes: number;
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

// "2026-Q3" -> "Q-3" — short column-header form for §2's table (2026-08-05
// follow-up: "PSSP Aktif Q-3", "PSSP Aktif (Q-2)").
function qLabel(period: string | null): string {
  if (!period) return "-";
  const m = period.match(/-Q(\d)$/);
  return m ? `Q-${m[1]}` : period;
}

// Same 3-tier percentage threshold already used elsewhere in this app for
// "is this number good or bad at a glance" (LineItemEditor.tsx's Pelunasan/
// Running Rate badges: ≥80% success, 40-79% warning, <40% red) — reused here
// for Ringkasan §3 Pencapaian Target and §4 Pelunasan instead of a new scale,
// so the same color always means the same thing across this app.
function pctColor(pct: number | null): string {
  if (pct == null) return "var(--color-text-faint)";
  if (pct >= 80) return "var(--color-success, #16a34a)";
  if (pct >= 40) return "var(--color-warning, #f59e0b)";
  return "var(--color-red)";
}

// Row shape for Ringkasan §5 Breakdown Historis — declared explicitly (rather
// than left to be inferred from 5 separate array literals with different
// optional fields) so TS doesn't widen rencanaVal/aktifVal to `number |
// undefined` on rows that always provide them. Non-composite rows render
// via `RingkasanBarPair` (RingkasanCharts.tsx) reused from §2, in compact
// mode. The 2 composite rows (Breakdown User/KPDM, Baru vs Retensi) carry
// `splitRencana`/`splitAktif` instead — each a small N-value breakdown
// (User+KPDM, or Baru+Retensi) rendered via `RingkasanSplitBarPair`
// (2026-08-05 follow-up: "rencana ada dua bar, yang aktif ada dua bar").
interface BreakdownRow {
  label: string;
  rencana: string;
  aktif: string;
  composite?: boolean;
  rencanaVal?: number;
  aktifVal?: number;
  aktifUnavailable?: boolean;
  splitRencana?: { subLabel: string; value: number; display: string }[];
  splitAktif?: { subLabel: string; value: number; display: string }[] | null;
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

// Contract length in whole months (inclusive of both ends), same "count of
// YYYYMM steps" arithmetic elapsedFraction above uses for its own `total` —
// used by Ringkasan §5a "Rata-rata Lama Periode" (Aktif dimension) since
// PsspKontrak has no separate duration field, only prdAwal/prdAkhir.
function contractLengthMonths(prdAwal: string, prdAkhir: string): number {
  const sy = parseInt(prdAwal.slice(0, 4), 10), sm = parseInt(prdAwal.slice(4), 10);
  const ey = parseInt(prdAkhir.slice(0, 4), 10), em = parseInt(prdAkhir.slice(4), 10);
  return Math.max(0, (ey - sy) * 12 + (em - sm) + 1);
}

// Every "YYYYMM" month from prdAwal to prdAkhir inclusive — the PsspKontrak
// counterpart to poaUtils.ts's expandPeriodeMonths (which works off
// periodeAwal+lamaPeriode instead of an explicit end period). Used by
// Ringkasan §5a "Breakdown Nilai Estimasi by Bulan" (Aktif dimension) to
// apportion each active contract's estBaris evenly across its own running
// months, same spirit as computeMonthlyBreakdown for the Rencana side.
// Guarded against malformed/inverted ranges with a hard cap, same defensive
// posture as elapsedFraction's `total <= 0` check.
function monthsInRange(prdAwal: string, prdAkhir: string): string[] {
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

function previousQuarterPeriod(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10), q = parseInt(m[2], 10);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "ringkasan",    label: "Ringkasan" },
  { key: "mr",           label: "Per Personil" },
  { key: "outlet",       label: "Per Outlet" },
  { key: "customer",     label: "Per Customer" },
  { key: "spesialisasi", label: "Per Spesialisasi" },
  { key: "produk",       label: "Per Produk" },
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
  // "tab" (GroupingTab) folds "ringkasan" -> "mr" (see Tab's doc comment above).
  const rawTab: Tab = (params.tab as Tab) ?? "ringkasan";
  const tab: GroupingTab = rawTab === "ringkasan" ? "mr" : rawTab;
  // Rentang Periode (2026-07-28) — replaces the old single `period` pill
  // selector with an inclusive from/to range over the same "YYYY-QN" period
  // strings; string comparison sorts them chronologically correctly since
  // the format is fixed-width. Either end can be left open (only periodFrom
  // = "from X onward", only periodTo = "up to Y", neither = "Semua").
  const periodFrom = params.periodFrom ?? null;
  const periodTo = params.periodTo ?? null;
  const hasPeriodFilter = !!periodFrom || !!periodTo;
  const periodQuery = `${periodFrom ? `&periodFrom=${periodFrom}` : ""}${periodTo ? `&periodTo=${periodTo}` : ""}`;

  // Ringkasan tab's own single-quarter filter (docs/summary-ringkasan spec
  // §1/§3, "Q-Berjalan") — deliberately a SEPARATE query param (`quarter`,
  // not periodFrom/periodTo) so it doesn't interact with the range filter
  // every other tab still uses. Defaults to the real calendar current
  // quarter when unset/malformed, same default currentQuarter() already
  // used elsewhere on this page for growth-vs-quarter-sebelumnya.
  const ringkasanYearParam = params.qYear && /^\d{4}$/.test(params.qYear) ? params.qYear : null;
  const ringkasanQuarterNumParam = params.qQuarter && /^[1-4]$/.test(params.qQuarter) ? params.qQuarter : null;
  const ringkasanQuarter = ringkasanYearParam && ringkasanQuarterNumParam
    ? `${ringkasanYearParam}-Q${ringkasanQuarterNumParam}`
    : currentQuarter();

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
  const ringkasanYears = [...new Set(allPeriods.map((p) => p.slice(0, 4)))].sort();
  if (ringkasanYears.length === 0) ringkasanYears.push(ringkasanQuarter.slice(0, 4));

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
        {rawTab === "ringkasan"
          ? <RingkasanQuarterFilter years={ringkasanYears} year={ringkasanYearParam ?? ringkasanQuarter.slice(0, 4)} quarterNum={ringkasanQuarterNumParam ?? ringkasanQuarter.slice(6)} quarterLabel={ringkasanQuarter} />
          : <SummaryFilterModal tab={rawTab} periods={allPeriods} periodFrom={periodFrom} periodTo={periodTo} />}
      </div>

      {/* Everything below needs the heavy line-item fetch/aggregation — streamed
          in separately (2026-08-03) so it doesn't block the shell above from
          showing up. key= forces a fresh Suspense fallback on tab/filter change
          instead of showing stale content while the new data loads. */}
      <Suspense key={`${rawTab}|${periodFrom ?? ""}|${periodTo ?? ""}|${ringkasanQuarter}`} fallback={<SummarySkeleton />}>
        <SummaryContent
          mrNips={mrNips}
          rawTab={rawTab}
          periodFrom={periodFrom}
          periodTo={periodTo}
          hasPeriodFilter={hasPeriodFilter}
          periodQuery={periodQuery}
          isDefaultBounded={isDefaultBounded}
          defaultPeriodFrom={defaultPeriodFrom}
          ringkasanQuarter={ringkasanQuarter}
          isAdminTestView={session.role === "ADMIN"}
        />
      </Suspense>
    </div>
  );
}

async function SummaryContent({
  mrNips, rawTab, periodFrom, periodTo, hasPeriodFilter, isDefaultBounded, defaultPeriodFrom, ringkasanQuarter, isAdminTestView,
}: {
  mrNips: string[];
  rawTab: Tab;
  periodFrom: string | null;
  periodTo: string | null;
  hasPeriodFilter: boolean;
  periodQuery: string;
  isDefaultBounded: boolean;
  defaultPeriodFrom: string;
  ringkasanQuarter: string;
  // Per-product Target dummy data gate (2026-08-05: "buat dummynya dulu
  // kalau viewnya admin, soalnya untuk testing saja") — per-product Target
  // doesn't exist in the data model yet (confirmed earlier by user), so a
  // deterministic dummy value is generated ONLY for ADMIN so the ratio UI
  // can be visually checked before real data lands. Every other role still
  // sees "Tidak tersedia", same as before this flag existed.
  isAdminTestView: boolean;
}) {
  const tab: GroupingTab = rawTab === "ringkasan" ? "mr" : rawTab;

  // Ringkasan tab forces the whole component's underlying dataset (poas,
  // lineItems, groups, targetTotal, ...) to exactly ONE quarter ("Q-Berjalan",
  // docs/summary-ringkasan §1) instead of the range/default-window every
  // other tab uses — periodFrom/periodTo from the URL are ignored for this
  // tab, `ringkasanQuarter` (single-quarter filter, see RingkasanQuarterFilter)
  // wins outright. This is what makes `lineItems` the right INPUT for §2-§4's
  // tercacah (apportioned) Rencana figures below (`rencanaMonthlyBreakdownQ`
  // etc.) — those are no longer just `estimasiTotal`/`estimasiAktifTotal`
  // (the raw, un-apportioned sums those two vars still are for every other
  // tab) since the 2026-08-06 "semua estimasi... dibuat tercacah" fix.
  const effPeriodFrom = rawTab === "ringkasan" ? ringkasanQuarter : periodFrom;
  const effPeriodTo = rawTab === "ringkasan" ? ringkasanQuarter : periodTo;
  const effHasPeriodFilter = rawTab === "ringkasan" ? true : hasPeriodFilter;

  const mrUsers = mrNips.length > 0
    ? (await prisma.user.findMany({
        where: { nip: { in: mrNips } },
        orderBy: { name: "asc" },
      })) as { nip: string; name: string; role: string; jabatan: string | null }[]
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
  if (effHasPeriodFilter) {
    poaWhere.period = {
      ...(effPeriodFrom ? { gte: effPeriodFrom } : {}),
      ...(effPeriodTo ? { lte: effPeriodTo } : {}),
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
          periodeAwal: true,
          lamaPeriode: true,
          // pihakPssp/labelCustomer only needed by Ringkasan §5b (Breakdown
          // User/KPDM, Jumlah Customer Baru vs Retention) — added to the
          // shared select rather than a second query since it's a free
          // column read on a row set already being fetched for every tab.
          pihakPssp: true,
          labelCustomer: true,
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
        periodeAwal: string | null;
        lamaPeriode: number | null;
        pihakPssp: "USER" | "KPDM";
        labelCustomer: string | null;
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
        variasiProdukKontes: new Set(items.filter((li) => getAllPakets(li.namaProduk).length > 0).map((li) => li.kodeProduk)).size,
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

  // ── Tab labels ────────────────────────────────────────────────────────────

  const CODE_LABEL: Record<GroupingTab, string> = {
    outlet: "Outlet", customer: "Customer", spesialisasi: "Spesialisasi",
    produk: "Produk", mr: "Personil",
  };

  const estimasiTotal = groups.reduce((s, g) => s + g.estimasi, 0);
  const estimasiAktifTotal = groups.reduce((s, g) => s + g.estimasiAktif, 0);

  // ── Ringkasan totals ─────────────────────────────────────────────────────
  // Company/subtree-wide sums — just SUM of the per-MR `groups` rows (tab
  // folds to "mr" for rawTab==="ringkasan", see Tab's doc comment), not a
  // separate query. Feeds §2-§5 below (docs/summary-ringkasan).
  const ringkasanPsspTotal = groups.reduce((s, g) => s + g.psspTotal, 0);
  const ringkasanEntertainTotal = groups.reduce((s, g) => s + g.entertainTotal, 0);
  const ringkasanCustomerTotal = new Set(lineItems.map(custIdentity)).size;
  const ringkasanPersonilAktif = groups.filter((g) => g.pengajuan > 0).length;
  // Month-apportionment (§5a "Breakdown Nilai Estimasi by Bulan" and other
  // per-bulan metrics below) — same computeMonthlyBreakdown already used for
  // the Excel exports / DraftChecklist's "Ringkasan POA" panel.
  const ringkasanMonthlyBreakdown = computeMonthlyBreakdown(lineItems);

  // ── Ringkasan tab redesign (docs/summary-ringkasan, implemented 2026-08-05) ─
  // Everything below is gated to rawTab === "ringkasan" for the two extra
  // QUERIES (targetSebelumnyaPoas, psspFullHistoryRows) — the actual
  // computation over already-fetched arrays (lineItems/activePssp/poas) runs
  // unconditionally since it's cheap in-memory work, same "no extra DB round
  // trip for other tabs" principle as everything above.
  const ringkasanQMonths = quarterToMonths(ringkasanQuarter);
  const ringkasanQSebelumnya = previousQuarterPeriod(ringkasanQuarter);
  const ringkasanQSebelumnyaMonths = ringkasanQSebelumnya ? quarterToMonths(ringkasanQSebelumnya) : [];

  // PSSP Rencana, genuinely tercacah (apportioned) to Q-Berjalan's own months
  // (2026-08-06: "semua estimasi... PSSP rencana... dibuat tercacah sesuai
  // filter quarter nya") — moved up from §5a so §2/§3/§4 below can all read
  // this SAME tercacah figure instead of the raw un-apportioned `estimasiTotal`
  // (a line item's rencanaTotalBiaya spread across its own periodeAwal.. run,
  // which can extend past this single quarter's 3 months).
  const rencanaMonthlyBreakdownQ = ringkasanQMonths.reduce((s, m) => s + (ringkasanMonthlyBreakdown.get(m)?.estimasi ?? 0), 0);

  // §3 Pencapaian Target needs Target for Q-Sebelumnya too (targetTotal above
  // is already Q-Berjalan-only, since the whole poaWhere is forced to
  // ringkasanQuarter for this tab) — same poa.target-only resolution
  // targetTotal itself uses (NOT the fuller poa.target-vs-TargetHospitalValue
  // fallback documented in docs/form-poa/01-business-rules.md §3 "Resolusi
  // Target" — that fallback was never actually wired into THIS component,
  // only into poa/[id]/page.tsx's per-POA view; reusing targetTotal's
  // existing behavior as-is per instructions, not adding a fallback this
  // component didn't already have).
  const targetSebelumnyaPoas = rawTab === "ringkasan" && mrNips.length > 0 && ringkasanQSebelumnya
    ? (await prisma.poaForm.findMany({
        where: { ownerId: { in: mrNips }, status: { in: NON_DRAFT }, period: ringkasanQSebelumnya },
        select: { id: true, target: true },
      })) as { id: string; target: { toString(): string } | null }[]
    : [];
  const targetSebelumnyaTotal = targetSebelumnyaPoas.reduce((s, p) => s + toNum(p.target), 0);

  // §3 also needs PSSP Rencana (not just Aktif) for Q-Sebelumnya, genuinely
  // TERCACAH to Q-Sebelumnya's own months (2026-08-06: "semua estimasi...
  // dibuat tercacah sesuai filter quarter nya") — a plain `_sum` aggregate
  // over rencanaTotalBiaya (the first version of this fix) summed each line
  // item's FULL periodeAwal..periodeAkhir value, not just the slice that
  // actually falls in Q-Sebelumnya's 3 months, so it wasn't really tercacah.
  // Needs the actual line items (periodeAwal/lamaPeriode), not just an
  // aggregate, to run through the same `computeMonthlyBreakdown` apportionment
  // as Q-Berjalan's `ringkasanMonthlyBreakdown` above.
  const lineItemsSebelumnya = targetSebelumnyaPoas.length > 0
    ? (await prisma.poaLineItem.findMany({
        where: { poaId: { in: targetSebelumnyaPoas.map((p) => p.id) } },
        select: { rencanaTotalBiaya: true, persenPsspDokter: true, pengaliNilaiR: true, periodeAwal: true, lamaPeriode: true },
      })) as {
        rencanaTotalBiaya: { toString(): string } | number;
        persenPsspDokter: { toString(): string } | number | null;
        pengaliNilaiR: { toString(): string } | number | null;
        periodeAwal: string | null;
        lamaPeriode: number | null;
      }[]
    : [];
  const sebelumnyaMonthlyBreakdown = computeMonthlyBreakdown(lineItemsSebelumnya);
  const rencanaSebelumnyaTotal = ringkasanQSebelumnyaMonths.reduce((s, m) => s + (sebelumnyaMonthlyBreakdown.get(m)?.estimasi ?? 0), 0);

  // §2 "PSSP Aktif Q-3"/"PSSP Aktif Q-2" — 2026-08-05 correction: these two
  // columns are NOT both "currently active right now" (that was the earlier,
  // wrong reading) — each is "PSSP tercacah (apportioned) yang BERJALAN pada
  // kuartal itu sendiri". `activePssp` (`getActivePsspByOutlets`) only
  // returns contracts active AS OF TODAY (`prdAkhir >= real current period`),
  // so a contract that ran during Q-sebelumnya but already ended before
  // today would be wrongly excluded — needs its own query over the WIDER
  // [Q-sebelumnya start, Q-berjalan end] window instead of reusing
  // `activePssp`. Same apportionment (`monthsInRange` + evenly split
  // `estBaris`) `tercacahAktifForQuarter` below runs, just scoped per quarter
  // instead of summed into one total.
  const kesesuaianWindowMonths = [...ringkasanQSebelumnyaMonths, ...ringkasanQMonths].sort();
  const kesesuaianMinMonth = kesesuaianWindowMonths[0] ?? ringkasanQMonths[0];
  const kesesuaianMaxMonth = kesesuaianWindowMonths[kesesuaianWindowMonths.length - 1] ?? ringkasanQMonths[ringkasanQMonths.length - 1];
  const kesesuaianAktifRows = rawTab === "ringkasan" && outletKodesForMR.length > 0
    ? (await prisma.psspKontrak.findMany({
        where: { kdOutlet: { in: outletKodesForMR }, prdAwal: { lte: kesesuaianMaxMonth }, prdAkhir: { gte: kesesuaianMinMonth } },
        // kdProduk/nmProduk (2026-08-06 follow-up: "semua estimasi... PSSP
        // aktif... dibuat tercacah sesuai filter quarter nya") — needed so
        // §4's Varian Produk Kontes tile can derive its OWN genuinely
        // per-quarter tercacah Aktif figure (kontesAktifRows below) instead
        // of reusing kontesActivePssp's "active today" estBaris sum.
        select: { kdCust: true, cUrut: true, prdAwal: true, prdAkhir: true, estBaris: true, kdProduk: true, nmProduk: true },
      })) as { kdCust: string; cUrut: string; prdAwal: string; prdAkhir: string; estBaris: { toString(): string } | null; kdProduk: string | null; nmProduk: string | null }[]
    : [];
  // Generalized "tercacah per kuartal" reducer over any PsspKontrak-shaped row
  // set (2026-08-06) — was two separate pieces (a cached monthly Map + a
  // closure reading it) written only for the full outlet-scoped set; unified
  // here so the SAME apportionment logic can also run over a Kontes-filtered
  // SUBSET of kesesuaianAktifRows (see kontesAktifRows below) without a
  // second bespoke cache. Row counts here are bounded by outletKodesForMR ×
  // a ~2-quarter window (same scope docs/PERFORMANCE.md already accepts for
  // this query), so recomputing months per row per call is cheap — no need
  // for the extra cache this replaces.
  function tercacahAktifForQuarter(
    rows: { kdCust: string; cUrut: string; prdAwal: string; prdAkhir: string; estBaris: { toString(): string } | null }[],
    months: string[]
  ): { jumlah: number; value: number } {
    const monthSet = new Set(months);
    const contractKeys = new Set<string>();
    let value = 0;
    for (const r of rows) {
      const rMonths = monthsInRange(r.prdAwal, r.prdAkhir);
      if (rMonths.length === 0) continue;
      if (rMonths.some((m) => monthSet.has(m))) contractKeys.add(`${r.kdCust}|${r.cUrut}`);
      const perMonth = toNum(r.estBaris) / rMonths.length;
      for (const m of rMonths) if (monthSet.has(m)) value += perMonth;
    }
    return { jumlah: contractKeys.size, value };
  }
  const kesesuaianAktifQBerjalan = tercacahAktifForQuarter(kesesuaianAktifRows, ringkasanQMonths);
  const kesesuaianAktifQSebelumnya = tercacahAktifForQuarter(kesesuaianAktifRows, ringkasanQSebelumnyaMonths);

  // Per-BULAN monthly map (2026-08-06: "aku mau ada yang breakdown by bulan
  // di ringkasan summary juga kayak yang ada di ringkasan draft POA" — same
  // "Estimasi & Nilai PSSP per Bulan" table already on the per-POA draft
  // panel, `DraftChecklist.tsx`, reused here at the aggregate Ringkasan
  // level). Separate from `tercacahAktifForQuarter` above (which only needs
  // a quarter-level SUM + distinct-contract count) — this keeps a value per
  // individual month so the table below can render one row per bulan.
  const kesesuaianAktifMonthlyMap = new Map<string, number>();
  for (const r of kesesuaianAktifRows) {
    const rMonths = monthsInRange(r.prdAwal, r.prdAkhir);
    if (rMonths.length === 0) continue;
    const perMonth = toNum(r.estBaris) / rMonths.length;
    for (const m of rMonths) kesesuaianAktifMonthlyMap.set(m, (kesesuaianAktifMonthlyMap.get(m) ?? 0) + perMonth);
  }
  // Rencana side merges Q-Berjalan's `ringkasanMonthlyBreakdown` (from
  // `lineItems`) with Q-Sebelumnya's `sebelumnyaMonthlyBreakdown` (from
  // `lineItemsSebelumnya`, fetched above for §3's Rencana-vs-Target).
  function kesesuaianRencanaMonthlyValue(m: string): number {
    return (ringkasanMonthlyBreakdown.get(m)?.estimasi ?? 0) + (sebelumnyaMonthlyBreakdown.get(m)?.estimasi ?? 0);
  }

  // Full (all-time, not just active) PSSP contract history for every
  // customer touched by either dimension — Q-Berjalan's planned customers
  // (custCodes, already fetched above) union currently-active customers
  // (activePssp) — needed for §5b "Rata-Rata PSSP ke Berapa" (ordinal of a
  // customer's Nth contract) and its "Baru vs Retensi" proxy. Bounded by
  // custCodes/activePssp's own customer set (same size class as the
  // realisasiPsspRows query above), gated to the Ringkasan tab only.
  const activeCustCodesSet = new Set(activePssp.map((r) => r.kdCust));
  const psspHistoryCustCodes = rawTab === "ringkasan"
    ? [...new Set([...custCodes, ...activeCustCodesSet])]
    : [];
  const psspFullHistoryRows = psspHistoryCustCodes.length > 0
    ? (await prisma.psspKontrak.findMany({
        where: { kdCust: { in: psspHistoryCustCodes } },
        select: { kdCust: true, cUrut: true, prdAwal: true },
      })) as { kdCust: string; cUrut: string; prdAwal: string }[]
    : [];
  // kdCust -> distinct cUrut sorted by each contract's earliest prdAwal —
  // ordinal position N (1-based) in this array = "this customer's Nth PSSP".
  const custContractsByCust = new Map<string, Map<string, string>>();
  for (const r of psspFullHistoryRows) {
    const m = custContractsByCust.get(r.kdCust) ?? new Map<string, string>();
    const earliest = m.get(r.cUrut);
    if (!earliest || r.prdAwal < earliest) m.set(r.cUrut, r.prdAwal);
    custContractsByCust.set(r.kdCust, m);
  }
  const custContractsSorted = new Map<string, string[]>();
  for (const [kdCust, m] of custContractsByCust) {
    custContractsSorted.set(kdCust, [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([cUrut]) => cUrut));
  }

  const contractRepMap = new Map<string, ActivePsspRow>();
  for (const r of activePssp) {
    const key = `${r.kdCust}|${r.cUrut}`;
    if (!contractRepMap.has(key)) contractRepMap.set(key, r);
  }

  // ── §2 Kesesuaian POA — PSSP Rencana vs PSSP Aktif, Q-Berjalan, no ratio
  // (docs/summary-ringkasan/01-business-rules.md §2: "kedua angka ditampilkan
  // berdampingan apa adanya"). By Jumlah = row/contract COUNT (line items for
  // Rencana, distinct contracts for Aktif) — chosen over customer-count to
  // stay consistent with how "pengajuan"/"By Jumlah" already counts ROWS
  // elsewhere in this file (TerritoryGroup.pengajuan = items.length), not
  // distinct customers (non-blocking assumption, docs/summary-ringkasan
  // README non-blocking item #... "count vs value for Jumlah dimension").
  const kesesuaianJumlahRencana = lineItems.length;
  // Tercacah to Q-Berjalan's own months (2026-08-06 fix), not the raw
  // un-apportioned `estimasiTotal` this used to read.
  const kesesuaianValueRencana = rencanaMonthlyBreakdownQ;

  // ── §3 Pencapaian Target — direct %, no proyeksi/ekstrapolasi. Rendered as
  // a horizontal STACKED bar per quarter (2026-08-06 follow-up: "target itu
  // 100%, PSSP rencananya kontribusi ke target berapa persen, dan PSSP
  // Aktifnya kontribusi ke target berapa persen") — Rencana% and Aktif% are
  // each computed against the SAME quarter's Target and stacked, rather than
  // one combined "Aktif only" ratio. This also fixes the earlier limitation
  // where both quarters reused the same "aktif sekarang" figure: Aktif now
  // uses the genuinely per-quarter tercacah figures from §2
  // (kesesuaianAktifQBerjalan/kesesuaianAktifQSebelumnya, fixed 2026-08-05),
  // and Rencana now uses a genuinely per-quarter figure too
  // (kesesuaianValueRencana for Q-Berjalan, rencanaSebelumnyaTotal — new
  // query above — for Q-Sebelumnya) instead of one reused across both.
  // ADMIN-only dummy Target when the real `poa.target` is unset (2026-08-06
  // follow-up: "di admin tolong pakai target dummy dulu" — same scaffolding
  // convention already used for §4's per-produk dummy Target, deterministic
  // per seed string so it doesn't reshuffle every render, clearly suffixed
  // "(dummy)" and gated to isAdminTestView). Only kicks in when the real
  // target is genuinely 0/unset — a real target of any size always wins.
  function dummyTargetMultiplier(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return 0.7 + (hash % 700) / 1000; // 0.7 .. 1.4
  }
  const targetBerjalanIsDummy = isAdminTestView && targetTotal <= 0;
  const targetBerjalanForCalc = targetTotal > 0
    ? targetTotal
    : (isAdminTestView ? (kesesuaianValueRencana + kesesuaianAktifQBerjalan.value) * dummyTargetMultiplier(ringkasanQuarter) : 0);
  const targetSebelumnyaIsDummy = isAdminTestView && targetSebelumnyaTotal <= 0;
  const targetSebelumnyaForCalc = targetSebelumnyaTotal > 0
    ? targetSebelumnyaTotal
    : (isAdminTestView ? (rencanaSebelumnyaTotal + kesesuaianAktifQSebelumnya.value) * dummyTargetMultiplier(ringkasanQSebelumnya ?? "-") : 0);

  const rencanaPctSebelumnya = targetSebelumnyaForCalc > 0 ? (rencanaSebelumnyaTotal / targetSebelumnyaForCalc) * 100 : null;
  const aktifPctSebelumnya = targetSebelumnyaForCalc > 0 ? (kesesuaianAktifQSebelumnya.value / targetSebelumnyaForCalc) * 100 : null;
  const rencanaPctBerjalan = targetBerjalanForCalc > 0 ? (kesesuaianValueRencana / targetBerjalanForCalc) * 100 : null;
  const aktifPctBerjalan = targetBerjalanForCalc > 0 ? (kesesuaianAktifQBerjalan.value / targetBerjalanForCalc) * 100 : null;

  // ── §4 Kelompok metrik Value + Unit. "Unit" wasn't specified per-metric by
  // the spec ("belum eksplisit disebutkan per metrik") — working assumption:
  // reuse whichever count/quantity concept already exists for that metric
  // elsewhere in this file, rather than inventing a new one. Sales is the one
  // metric with a REAL unit figure (OutletSalesMonthly qty), everything else
  // pairs Value with the nearest existing row/contract count.
  const ringkasanSalesValueTotal = salesValueRaw.reduce((s, r) => s + toNum(r._sum.valueSales), 0);
  const ringkasanSalesQtyTotal = salesQtyRaw.reduce((s, r) => s + toNum(r._sum.qty), 0);

  // Pelunasan (%) company-wide — same Running Rate formula as the "outlet"
  // tab's per-outlet pelunasanRunningRate (expected = estBaris × elapsed
  // fraction of the contract's own period, summed across EVERY active
  // contract across all of mrNips's outlets instead of one outlet at a time).
  // Single grouping pass (not a filter-per-contract loop) — company-wide
  // ADMIN scope can have thousands of active PSSP rows, so this stays O(n)
  // instead of O(contracts × rows), same "batch then map in memory" pattern
  // docs/PERFORMANCE.md §2 requires.
  const contractRowsMap = new Map<string, ActivePsspRow[]>();
  for (const r of activePssp) {
    const key = `${r.kdCust}|${r.cUrut}`;
    const list = contractRowsMap.get(key) ?? [];
    list.push(r);
    contractRowsMap.set(key, list);
  }
  let ringkasanExpectedLunas = 0, ringkasanActualLunas = 0;
  for (const [key, r] of contractRepMap) {
    const contractRows = contractRowsMap.get(key) ?? [];
    const sumEst = contractRows.reduce((s, x) => s + x.estBaris, 0);
    const sumLunas = contractRows.reduce((s, x) => s + x.totalLunas, 0);
    ringkasanExpectedLunas += sumEst * elapsedFraction(r.prdAwal, r.prdAkhir);
    ringkasanActualLunas += sumLunas;
  }
  const ringkasanPelunasanPct = ringkasanExpectedLunas > 0 ? (ringkasanActualLunas / ringkasanExpectedLunas) * 100 : null;

  const value4Group = {
    target: { value: targetTotal },
    // Tercacah to Q-Berjalan (2026-08-06 fix) — was `estimasiTotal`/
    // `estimasiAktifTotal`, the raw full-value/"active today" figures.
    estimasiRencana: { value: kesesuaianValueRencana, unit: kesesuaianJumlahRencana },
    estimasiAktif: { value: kesesuaianAktifQBerjalan.value, unit: kesesuaianAktifQBerjalan.jumlah },
    sales: { value: ringkasanSalesValueTotal, unit: ringkasanSalesQtyTotal },
    // Pelunasan's "Value" IS the percentage (not Rupiah) — Unit here is the
    // Rupiah nominal actually paid, same %+nominal pairing pelunasanRunningRate
    // already uses per-outlet elsewhere on this page.
    pelunasan: { value: ringkasanPelunasanPct, unit: ringkasanActualLunas },
  };

  // Produk Kontes variant (§4, 4 of 5 metrics, Pelunasan excluded) — scoped
  // via getAllPakets(namaProduk), NOT OutletProductKriteria.kategori — that
  // field's actual values in this codebase are "Low Hanging Fruit"/"Blue
  // Ocean"/"Red Ocean" (verified against the now-removed "Per Produk
  // Rekomendasi" tab, which classified by that same field — see
  // docs/summary-ringkasan for the removal note), it has no "Produk Kontes"
  // kategori row at all, so the spec's literal wording
  // ("OutletProductKriteria.kategori = Produk Kontes") doesn't match what the
  // running code actually does — reusing the real, working classification
  // (getAllPakets) instead of the spec's inaccurate description of it.
  const kontesLineItems = lineItems.filter((li) => getAllPakets(li.namaProduk).length > 0);
  const kontesActivePssp = activePssp.filter((r) => r.nmProduk && getAllPakets(r.nmProduk).length > 0);
  // Tercacah to Q-Berjalan (2026-08-06: "semua estimasi... dibuat tercacah
  // sesuai filter quarter nya") — Rencana re-runs computeMonthlyBreakdown
  // scoped to kontesLineItems (already Q-Berjalan-only, no new query); Aktif
  // reuses kesesuaianAktifRows (the correctly per-quarter-scoped query §2
  // already runs, NOT kontesActivePssp's "active today" estBaris sum),
  // filtered down to Kontes products via the same getAllPakets predicate.
  const kontesMonthlyBreakdown = computeMonthlyBreakdown(kontesLineItems);
  const kontesEstimasiRencanaTercacah = ringkasanQMonths.reduce((s, m) => s + (kontesMonthlyBreakdown.get(m)?.estimasi ?? 0), 0);
  const kontesAktifRows = kesesuaianAktifRows.filter((r) => r.nmProduk && getAllPakets(r.nmProduk).length > 0);
  const kontesAktifQBerjalan = tercacahAktifForQuarter(kontesAktifRows, ringkasanQMonths);
  // Sales-Kontes has no direct "isKontes" master lookup wired into this
  // component (salesValueByProduk is keyed by itemKode/kodeProduk, with no
  // product-name-based paket classification joined in) — approximated via
  // the set of kodeProduk that appear as Produk Kontes in THIS quarter's own
  // planned line items, not a static company-wide Produk Kontes product list.
  // Working assumption, flagged rather than silently approximated.
  const kontesKodeProdukSet = new Set(kontesLineItems.map((li) => li.kodeProduk));
  let kontesSalesValueTotal = 0;
  for (const [itemKode, val] of salesValueByProduk) {
    if (kontesKodeProdukSet.has(itemKode)) kontesSalesValueTotal += val;
  }
  const value4GroupKontes = {
    // Target has no per-product breakdown anywhere in this data model (it's
    // a single company/GT-level Rupiah quota) — genuinely not computable, not
    // just unimplemented. Left null rather than fabricating a proportional
    // allocation the spec never asked for.
    target: null as number | null,
    estimasiRencana: { value: kontesEstimasiRencanaTercacah, unit: kontesLineItems.length },
    estimasiAktif: { value: kontesAktifQBerjalan.value, unit: kontesAktifQBerjalan.jumlah },
    sales: { value: kontesSalesValueTotal, unit: null as number | null },
  };

  // Per-produk-kontes breakdown (2026-08-05 follow-up: "by variasi juga per
  // produk kontesnya" — confirmed via clarification to mean a breakdown per
  // INDIVIDUAL kontes product, not one more aggregate number). Same in-memory
  // regroup-by-kodeProduk pattern `getTerritoryKey`/`groups` already use
  // elsewhere on this page for the "produk" tab — no new query, just
  // regrouping `kontesLineItems`/`kontesActivePssp` (already filtered above)
  // by product instead of summing them into one total.
  // 2026-08-05 follow-up: card's bottom % changed from "Aktif tercapai dari
  // Rencana" to "% Estimasi Tercacah dari Target" + "% Sales dari Target" —
  // per-product Target confirmed by user as NOT YET in the data model
  // ("nanti akan ada target per produk kontes"), so both ratios are wired up
  // and ready but show "Tidak tersedia" until that field exists — not
  // fabricated. Estimasi Tercacah per product IS computable now: same
  // `computeMonthlyBreakdown` apportionment already used for the aggregate
  // `rencanaMonthlyBreakdownQ` above, just scoped to each product's own
  // line items instead of all of them combined (confirmed via clarifying
  // question — "per produk individual").
  const kontesByProduk = new Map<string, { namaProduk: string; rencana: number; aktif: number; items: typeof kontesLineItems }>();
  for (const li of kontesLineItems) {
    const row = kontesByProduk.get(li.kodeProduk) ?? { namaProduk: li.namaProduk, rencana: 0, aktif: 0, items: [] };
    row.rencana += toNum(li.rencanaTotalBiaya);
    row.items.push(li);
    kontesByProduk.set(li.kodeProduk, row);
  }
  for (const r of kontesActivePssp) {
    if (!r.kdProduk) continue;
    const row = kontesByProduk.get(r.kdProduk) ?? { namaProduk: r.nmProduk ?? r.kdProduk, rencana: 0, aktif: 0, items: [] };
    row.aktif += r.estBaris;
    kontesByProduk.set(r.kdProduk, row);
  }
  // Sales per produk kontes (2026-08-05 follow-up: "mana salesnya" — card
  // needs this labeled too, same source `salesValueByProduk` already used
  // for the aggregate `kontesSalesValueTotal` above, keyed by itemKode which
  // matches Product.kodeProduk directly (same join already relied on
  // elsewhere on this page) — no new query, just also read per-product
  // instead of only summing into one total.
  const kontesProdukRows = [...kontesByProduk.entries()]
    .map(([kodeProduk, row]) => {
      const breakdown = computeMonthlyBreakdown(row.items);
      const tercacah = ringkasanQMonths.reduce((s, m) => s + (breakdown.get(m)?.estimasi ?? 0), 0);
      // ADMIN-only dummy Target (2026-08-05: "buat dummynya dulu... untuk
      // testing saja") — deterministic per kodeProduk (not Math.random(),
      // which would reshuffle every render and make it useless for actually
      // checking the ratio UI) so the same product shows the same dummy
      // number across refreshes. Delete this block once real per-product
      // Target data exists — `target: null` for every other role already
      // falls back to "Tidak tersedia" correctly.
      let target: number | null = null;
      if (isAdminTestView) {
        let hash = 0;
        for (let i = 0; i < kodeProduk.length; i++) hash = (hash * 31 + kodeProduk.charCodeAt(i)) >>> 0;
        const multiplier = 0.7 + (hash % 700) / 1000; // 0.7 .. 1.4, stable per product
        target = Math.round(row.rencana * multiplier) || null;
      }
      return { ...row, sales: salesValueByProduk.get(kodeProduk) ?? 0, tercacah, target };
    })
    .sort((a, b) => (b.rencana + b.aktif) - (a.rencana + a.aktif));

  // ── §5 Breakdown historis — 5 kelompok × 13 metrik, 2 dimensi (Rencana /
  // Aktif) only; Q-Sebelumnya/Realisasi deliberately deferred per spec.

  // 5a. Manajemen Risiko
  const lamaPeriodeRencanaRows = lineItems.filter((li) => li.lamaPeriode != null && li.lamaPeriode > 0);
  const avgLamaPeriodeRencana = lamaPeriodeRencanaRows.length > 0
    ? lamaPeriodeRencanaRows.reduce((s, li) => s + (li.lamaPeriode as number), 0) / lamaPeriodeRencanaRows.length
    : null;
  const avgLamaPeriodeAktif = contractRepMap.size > 0
    ? [...contractRepMap.values()].reduce((s, r) => s + contractLengthMonths(r.prdAwal, r.prdAkhir), 0) / contractRepMap.size
    : null;

  // aktifMonthlyBreakdownQ used to be built from `activePssp` here — that's
  // "active as of TODAY" (getActivePsspByOutlets), not genuinely tercacah for
  // THIS quarter (2026-08-06 fix, same class of bug §2 already fixed
  // 2026-08-05) — replaced by `kesesuaianAktifQBerjalan.value` everywhere
  // below, the correctly per-quarter-scoped figure §2 already computes.

  // 5b. Customer
  // Breakdown User/KPDM — counted by LINE ITEM (pihakPssp is a per-product
  // row field, "hanya switch label tampilan" per docs/form-poa/01-business-
  // rules.md §3), same row-count convention §2's "By Jumlah" already uses,
  // rather than by distinct customer (a customer could mix USER/KPDM across
  // products). No PsspKontrak equivalent exists at all — Aktif dimension is
  // genuinely unavailable, not just unimplemented.
  const pihakBreakdownRencana = {
    USER: lineItems.filter((li) => li.pihakPssp === "USER").length,
    KPDM: lineItems.filter((li) => li.pihakPssp === "KPDM").length,
  };
  const custBaruRencana = new Map<string, string | null>(); // custIdentity -> labelCustomer
  for (const li of lineItems) custBaruRencana.set(custIdentity(li), li.labelCustomer);
  const jumlahBaruRencana = [...custBaruRencana.values()].filter((l) => !l || l === "Dokter Baru").length;
  const jumlahRetensiRencana = custBaruRencana.size - jumlahBaruRencana;
  // Aktif "Baru vs Retensi" proxy: a currently-active customer whose full
  // history has exactly 1 contract (the one that's active now) is "Baru"
  // (this is literally their first PSSP); ≥2 distinct contracts = "Retensi".
  // No stored label equivalent to PoaLineItem.labelCustomer exists on
  // PsspKontrak, so this is derived rather than reused — working assumption.
  let jumlahBaruAktif = 0, jumlahRetensiAktif = 0;
  for (const kdCust of activeCustCodesSet) {
    const n = custContractsSorted.get(kdCust)?.length ?? 1;
    if (n <= 1) jumlahBaruAktif++; else jumlahRetensiAktif++;
  }

  // Rata-Rata PSSP ke Berapa — Aktif = ordinal of the currently-active
  // contract; Rencana = ordinal the Q-Berjalan planned one WOULD be
  // (historical distinct contract count + 1).
  const aktifOrdinals: number[] = [];
  const activeCustContractSet = new Map<string, Set<string>>();
  for (const r of activePssp) {
    const s = activeCustContractSet.get(r.kdCust) ?? new Set<string>();
    s.add(r.cUrut);
    activeCustContractSet.set(r.kdCust, s);
  }
  for (const [kdCust, cUruts] of activeCustContractSet) {
    const sorted = custContractsSorted.get(kdCust) ?? [];
    let maxOrdinal = 0;
    for (const cUrut of cUruts) {
      const idx = sorted.indexOf(cUrut);
      if (idx >= 0) maxOrdinal = Math.max(maxOrdinal, idx + 1);
    }
    if (maxOrdinal > 0) aktifOrdinals.push(maxOrdinal);
  }
  const avgPsspKeAktif = aktifOrdinals.length > 0 ? aktifOrdinals.reduce((s, v) => s + v, 0) / aktifOrdinals.length : null;

  const rencanaCustCodes = [...new Set(lineItems.map((li) => li.kodeCust).filter(Boolean) as string[])];
  const rencanaOrdinals = rencanaCustCodes.map((kc) => (custContractsSorted.get(kc)?.length ?? 0) + 1);
  const avgPsspKeRencana = rencanaOrdinals.length > 0 ? rencanaOrdinals.reduce((s, v) => s + v, 0) / rencanaOrdinals.length : null;

  // 5c. Produk — "Rata-Rata Variasi per Estimasi PSSP" shown as TWO separate
  // rows (2026-08-06, "jadi ada rata-rata variasi produk kontes dan all
  // produk, itu dipisah") — one for the full product catalog (all produk,
  // original scope), one for Produk Kontes specifically (2026-08-06 earlier
  // clarification: "itu kan rata-rata variasi produk kontes per estimasi
  // PSSP"). Both computed with the same formula (distinct produk count per
  // estimasi PSSP), just over a different item set — lineItems/activePssp
  // for "All Produk", kontesLineItems/kontesActivePssp (defined above for
  // §4) for "Produk Kontes".
  function variasiFor(
    liItems: typeof lineItems, aktifRows: typeof activePssp
  ): { rencana: number | null; aktif: number | null } {
    const byPoa = new Map<string, Set<string>>();
    for (const li of liItems) {
      const s = byPoa.get(li.poaId) ?? new Set<string>();
      s.add(li.kodeProduk);
      byPoa.set(li.poaId, s);
    }
    const rencana = byPoa.size > 0
      ? [...byPoa.values()].reduce((s, set) => s + set.size, 0) / byPoa.size
      : null;
    const byContract = new Map<string, Set<string>>();
    for (const r of aktifRows) {
      const key = `${r.kdCust}|${r.cUrut}`;
      const s = byContract.get(key) ?? new Set<string>();
      s.add(r.kdProduk ?? r.nmProduk ?? "-");
      byContract.set(key, s);
    }
    const aktif = byContract.size > 0
      ? [...byContract.values()].reduce((s, set) => s + set.size, 0) / byContract.size
      : null;
    return { rencana, aktif };
  }
  const variasiAllProduk = variasiFor(lineItems, activePssp);
  const variasiKontes = variasiFor(kontesLineItems, kontesActivePssp);
  const avgVariasiRencana = variasiAllProduk.rencana;
  const avgVariasiAktif = variasiAllProduk.aktif;
  const avgVariasiKontesRencana = variasiKontes.rencana;
  const avgVariasiKontesAktif = variasiKontes.aktif;
  const avgBarisRencana = poaIds.length > 0 ? lineItems.length / poaIds.length : null;
  const avgBarisAktif = contractRepMap.size > 0 ? activePssp.length / contractRepMap.size : null;

  // 5d. Produktifitas — "per MR" here = per MR who actually submitted this
  // quarter (ringkasanPersonilAktif, computed above) for Rencana, and per MR
  // whose OUTLET currently carries ≥1 active PSSP contract for Aktif — this
  // is deliberately distinct from the existing "Estimasi Per User" concept
  // elsewhere on this page, which means per-CUSTOMER, not per-MR (flagged in
  // spec business-rules §5d as something to confirm isn't the same thing —
  // confirmed here it is not, by construction).
  const mrNipsByOutlet = new Map<string, string[]>();
  for (const row of mrOutletRows) {
    const list = mrNipsByOutlet.get(row.kodePI) ?? [];
    list.push(row.nipMR);
    mrNipsByOutlet.set(row.kodePI, list);
  }
  const mrWithActivePssp = new Set<string>();
  for (const r of activePssp) {
    if (!r.kdOutlet) continue;
    for (const nip of mrNipsByOutlet.get(r.kdOutlet) ?? []) mrWithActivePssp.add(nip);
  }
  // Tercacah to Q-Berjalan (2026-08-06 fix) — was `estimasiTotal`/
  // `estimasiAktifTotal`.
  const produktifitasRencana = ringkasanPersonilAktif > 0 ? rencanaMonthlyBreakdownQ / ringkasanPersonilAktif : null;
  const produktifitasAktif = mrWithActivePssp.size > 0 ? kesesuaianAktifQBerjalan.value / mrWithActivePssp.size : null;

  // 5e. Biaya — PSSP/DPL-DPF/DP/Listing Fee/Entertain. DPL and DPF cannot be
  // split apart on the Rencana side either: PoaLineItem has exactly ONE
  // combined `persenDiskon` field (schema.prisma), no separate dpl/dpf
  // columns — so "DPL/DPF" stays one combined bucket, same as the existing
  // "Discount + DPL + DPF" line this replaces, just now separated from DP
  // (persenDp IS its own distinct field) and Listing Fee (persenListingFee).
  // On the Aktif side, PsspKontrak has only a single lump `biaya`/`estBaris`
  // per contract-product row — no equivalent %-based component split exists
  // at all — so DPL/DPF, DP, and Entertain Aktif are genuinely not
  // computable (null, not "0"), EXCEPT Listing Fee, which has its own real
  // contract source (ListingFeeKontrak, already aggregated as
  // listingFeeByOutlet above) and PSSP, which reuses the tercacah
  // kesesuaianAktifQBerjalan.value (estBaris, apportioned to Q-Berjalan,
  // 2026-08-06 fix — was the raw "active today" estimasiAktifTotal) as the
  // closest analog to "Nilai PSSP" on the Aktif side, same assumption
  // §4/§5b already make for that figure.
  let dplDpfRencana = 0, dpRencana = 0, listingFeeRencanaCalc = 0;
  for (const li of lineItems) {
    const base = toNum(li.rencanaTotalBiaya);
    dplDpfRencana += base * toNum(li.persenDiskon);
    dpRencana += base * toNum(li.persenDp);
    listingFeeRencanaCalc += base * toNum(li.persenListingFee);
  }
  const listingFeeAktifTotal = [...listingFeeByOutlet.values()].reduce((s, v) => s + v, 0);
  const biayaBreakdown = {
    pssp: { rencana: ringkasanPsspTotal, aktif: kesesuaianAktifQBerjalan.value },
    dplDpf: { rencana: dplDpfRencana, aktif: null as number | null },
    dp: { rencana: dpRencana, aktif: null as number | null },
    listingFee: { rencana: listingFeeRencanaCalc, aktif: listingFeeAktifTotal },
    entertain: { rencana: ringkasanEntertainTotal, aktif: null as number | null },
  };

  // Ratio Biaya (2026-08-06: "tetap tambahkan ratio biaya") — total biaya
  // (semua 5 komponen di atas) dibagi Estimasi (tercacah), sama konsep dengan
  // "Cost Ratio"/"% Budget" yang sudah ada per-baris di `TerritoryTable`
  // (`biayaAktifPengajuan / estimasiAktifPengajuan`), diterapkan di level
  // agregat Ringkasan. Aktif cuma menjumlah komponen yang genuinely
  // computable (PSSP + Listing Fee) — DPL/DPF, DP, Entertain Aktif tidak
  // tersedia (lihat komentar di atas), jadi ratio Aktif ini SEBAGIAN, bukan
  // total biaya Aktif yang lengkap — sama keterbatasan yang sudah didokumentasikan
  // untuk baris-baris itu.
  const biayaRencanaTotal = ringkasanPsspTotal + dplDpfRencana + dpRencana + listingFeeRencanaCalc + ringkasanEntertainTotal;
  const biayaAktifTotalPartial = biayaBreakdown.pssp.aktif + biayaBreakdown.listingFee.aktif;
  const ratioBiayaRencana = kesesuaianValueRencana > 0 ? (biayaRencanaTotal / kesesuaianValueRencana) * 100 : null;
  const ratioBiayaAktif = kesesuaianAktifQBerjalan.value > 0 ? (biayaAktifTotalPartial / kesesuaianAktifQBerjalan.value) * 100 : null;

  // Map groups → TerritoryTable shape (monitoringGroups removed with Ringkasan tab).

  return (
    <div className="space-y-5">
      {/* Counts line — was part of the static header in SummaryPage's shell;
          moved here since it needs the heavy-fetched mrUsers/poas/lineItems.
          Briefly lived inside the Kesesuaian POA card instead, moved back
          here (2026-08-06 follow-up: that card was dropped down to just this
          same line — "section kesesuaian POA itu isinya yang kayak [...]
          aja" — so it no longer needs its own dedicated home). */}
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
        {rawTab === "ringkasan" ? (
          <span style={{ color: "var(--color-text-faint)" }}> · Q-Berjalan {ringkasanQuarter} (gunakan Filter Kuartal untuk ganti)</span>
        ) : isDefaultBounded && (
          <span style={{ color: "var(--color-text-faint)" }}> · menampilkan {defaultPeriodFrom} – {quarterIni} (gunakan Filter Periode untuk lihat semua)</span>
        )}
      </p>

      {/* Ringkasan redesign (docs/summary-ringkasan, implemented 2026-08-05) —
          §2-§5 below, all scoped to the single Q-Berjalan quarter selected via
          RingkasanQuarterFilter (see effPeriodFrom/effPeriodTo above). Same
          rounded-tile visual language as the grand-total card above, just
          organized into its own Cards per section instead of extending the
          one card further. */}
      {rawTab === "ringkasan" && (
        <>
          {/* §4 Kelompok metrik Value + Unit — dipindah ke paling atas
              (2026-08-06 follow-up: "section 'Target / Estimasi / Sales /
              Pelunasan' taro paling atas jadinya"), setelah §2 Kesesuaian POA
              digabung ke sini (tabelnya dianggap redundan dengan tile-tile
              ini — "kayaknya redundan deh" — cuma kolom Jumlah/Value PSSP
              Aktif Q-Sebelumnya yang belum ada tile-nya, ditambahkan sebagai
              tile baru di bawah). */}
          <Card>
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                Target / Estimasi / Sales / Pelunasan
                <HeaderInfo text={`PSSP Aktif ${qLabel(ringkasanQuarter)}/${qLabel(ringkasanQSebelumnya)} = PSSP tercacah (apportioned) yang benar-benar berjalan pada bulan-bulan kuartal itu masing-masing (bukan "aktif sekarang saja") — dihitung dari kontrak PSSP mana pun yang irisan periodenya menyentuh kuartal tersebut, bukan dibatasi ke kontrak yang masih berjalan hari ini.`} />
              </p>
              <p className="text-xs text-right shrink-0" style={{ color: "var(--color-text-muted)" }}>
                {mrUsers.length} MR · {poas.length} POA · {lineItems.length} pengajuan
                <span style={{ color: "var(--color-text-faint)" }}> · Q-Berjalan {ringkasanQuarter} (gunakan Filter Kuartal untuk ganti)</span>
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Target", value: formatRp(value4Group.target.value), unit: "", accent: "var(--color-blue)" },
                { label: "Estimasi PSSP Rencana", value: formatRp(value4Group.estimasiRencana.value), unit: `${value4Group.estimasiRencana.unit} baris`, accent: "var(--color-blue)" },
                { label: "Estimasi PSSP Aktif", value: formatRp(value4Group.estimasiAktif.value), unit: `${value4Group.estimasiAktif.unit} kontrak`, accent: "var(--color-blue)" },
                // Q-Sebelumnya Aktif — dulunya kolom terpisah di tabel §2
                // Kesesuaian POA, dipindah ke sini sebagai tile ke-4
                // (2026-08-06 follow-up).
                { label: `Estimasi PSSP Aktif (${qLabel(ringkasanQSebelumnya)})`, value: formatRp(kesesuaianAktifQSebelumnya.value), unit: `${kesesuaianAktifQSebelumnya.jumlah} kontrak`, accent: "var(--color-blue)" },
                { label: "Sales", value: formatRp(value4Group.sales.value), unit: `${value4Group.sales.unit.toLocaleString("id-ID")} unit`, accent: "var(--color-blue)" },
                // Pelunasan: status color stays on the left accent bar (the
                // "mark beside the text"), not on the number itself — same
                // fix as RingkasanTargetGauge (marks-and-anatomy.md: "text
                // never wears the data color"), and avoids the amber step's
                // 2.57:1 contrast failing WCAG AA for text.
                { label: "Pelunasan", value: value4Group.pelunasan.value != null ? `${value4Group.pelunasan.value.toFixed(0)}%` : "-", unit: formatRp(value4Group.pelunasan.unit), accent: pctColor(value4Group.pelunasan.value) },
              ].map(({ label, value, unit, accent }) => (
                <div key={label} className="rounded-lg p-3 space-y-0.5" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)", borderLeft: `3px solid ${accent}` }}>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</p>
                  <p className="text-base font-bold leading-tight" style={{ color: "var(--color-text)" }}>{value}</p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{unit}</p>
                </div>
              ))}
            </div>

            {/* Estimasi PSSP per Bulan — sama seperti panel "Ringkasan POA" di
                draft POA (DraftChecklist.tsx, "Estimasi & Nilai PSSP per
                Bulan"), dipakai lagi di sini di level agregat Ringkasan
                (2026-08-06: "aku mau ada yang breakdown by bulan di ringkasan
                summary juga kayak yang ada di ringkasan draft POA" — lalu
                diklarifikasi taruh di bawah tile Target/Estimasi/Sales/
                Pelunasan TAPI di atas Varian Produk Kontes, bukan jadi kartu
                terpisah di luar §4). Cakupan bulan = window Q-Sebelumnya +
                Q-Berjalan (kesesuaianWindowMonths, 6 bulan) — sama window
                yang §2 sudah pakai untuk Aktif. Kedua kolom genuinely
                tercacah (apportioned). */}
            {kesesuaianWindowMonths.length > 0 && (
              <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
                  Estimasi PSSP per Bulan
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Bulan</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-blue)" }}>PSSP Rencana</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-green)" }}>PSSP Aktif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kesesuaianWindowMonths.map((m) => {
                        const rencanaVal = kesesuaianRencanaMonthlyValue(m);
                        const aktifVal = kesesuaianAktifMonthlyMap.get(m) ?? 0;
                        return (
                          <tr key={m} style={{ borderTop: "1px solid var(--color-border)" }}>
                            <td className="py-1.5 px-2" style={{ color: "var(--color-text-muted)" }}>{formatPeriode(m)}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{rencanaVal > 0 ? formatRp(rencanaVal) : "-"}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{aktifVal > 0 ? formatRp(aktifVal) : "-"}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 600 }}>
                        <td className="py-1.5 px-2" style={{ color: "var(--color-text)" }}>Total</td>
                        <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(kesesuaianWindowMonths.reduce((s, m) => s + kesesuaianRencanaMonthlyValue(m), 0))}</td>
                        <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(kesesuaianWindowMonths.reduce((s, m) => s + (kesesuaianAktifMonthlyMap.get(m) ?? 0), 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Varian Produk Kontes — visual demotion (background lebih muted,
                tanpa aksen kiri) supaya kebaca sebagai rincian dari section
                di atas, bukan section yang setara pentingnya. */}
            <p className="text-xs font-semibold uppercase tracking-wider mt-4 mb-2 pt-3" style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
              Varian Produk Kontes
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg p-3 space-y-0.5" style={{ background: "var(--color-bg)", border: "1px dashed var(--color-border)" }}>
                <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Target</p>
                <p className="text-base font-bold leading-tight" style={{ color: "var(--color-text-faint)" }}>Tidak tersedia</p>
                <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>Tidak ada breakdown target per produk</p>
              </div>
              {[
                { label: "Estimasi PSSP Rencana", value: formatRp(value4GroupKontes.estimasiRencana.value), unit: `${value4GroupKontes.estimasiRencana.unit} baris` },
                { label: "Estimasi PSSP Aktif", value: formatRp(value4GroupKontes.estimasiAktif.value), unit: `${value4GroupKontes.estimasiAktif.unit} kontrak` },
                { label: "Sales", value: formatRp(value4GroupKontes.sales.value), unit: "-" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="rounded-lg p-3 space-y-0.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</p>
                  <p className="text-sm font-semibold leading-tight" style={{ color: "var(--color-text)" }}>{value}</p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{unit}</p>
                </div>
              ))}
            </div>

            {/* Breakdown per produk kontes individual (2026-08-05 follow-up)
                — tile di atas ini tetap AGREGAT (total gabungan semua produk
                kontes); di bawah ini tiap produk kontes dapat baris sendiri
                (Estimasi Rencana vs Aktif), bukan cuma 1 angka gabungan. */}
            {kontesProdukRows.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
                  Per Produk Kontes ({kontesProdukRows.length})
                </p>
                {isAdminTestView && (
                  <p className="text-[10px] mb-2 px-2 py-1 rounded" style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #92400e)" }}>
                    ⚠ Target per produk memakai data dummy (khusus ADMIN, untuk testing tampilan) — belum ada data Target per produk kontes yang asli.
                  </p>
                )}
                {/* Table, not cards (2026-08-05 follow-up: "section produk
                    kontes di ringkasan jadinya dibuat tabel aja jangan
                    chart") — 27 rows scan faster as a table than as cards in
                    a grid, same reasoning as TerritoryTable elsewhere on
                    this page. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Target</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi Tercacah</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi PSSP Rencana</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi PSSP Aktif</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Sales {ringkasanQuarter}</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>% Tercacah/Target</th>
                        <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>% Sales/Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kontesProdukRows.map((r) => {
                        const tercacahPct = r.target != null && r.target > 0 ? (r.tercacah / r.target) * 100 : null;
                        const salesPct = r.target != null && r.target > 0 ? (r.sales / r.target) * 100 : null;
                        return (
                          <tr key={r.namaProduk} style={{ borderBottom: "1px solid var(--color-border)" }}>
                            <td className="py-1.5 px-2 truncate max-w-[220px]" style={{ color: "var(--color-text)" }} title={r.namaProduk}>{r.namaProduk}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: r.target != null ? "var(--color-text)" : "var(--color-text-faint)" }}>
                              {r.target != null ? `${formatRp(r.target)} (dummy)` : "Tidak tersedia"}
                            </td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(r.tercacah)}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(r.rencana)}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(r.aktif)}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: "var(--color-text)" }}>{formatRp(r.sales)}</td>
                            <td className="text-right py-1.5 px-2" style={{ color: tercacahPct != null ? "var(--color-text)" : "var(--color-text-faint)" }}>
                              {tercacahPct != null ? `${tercacahPct.toFixed(0)}%` : "-"}
                            </td>
                            <td className="text-right py-1.5 px-2" style={{ color: salesPct != null ? "var(--color-text)" : "var(--color-text-faint)" }}>
                              {salesPct != null ? `${salesPct.toFixed(0)}%` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* §3 Pencapaian Target — horizontal stacked bar per kuartal:
              Target = 100%, PSSP Rencana dan PSSP Aktif masing-masing
              kontribusi berapa persen ke Target, ditumpuk dalam satu bar
              (2026-08-06 follow-up). */}
          <Card>
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Pencapaian Target</p>
              <RingkasanCompareLegend />
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--color-text-faint)" }}>
              PSSP Rencana + PSSP Aktif, ditumpuk sebagai kontribusi terhadap Target (garis putus-putus = Target 100%).
            </p>
            {(targetBerjalanIsDummy || targetSebelumnyaIsDummy) && (
              <p className="text-[10px] mb-3 px-2 py-1 rounded" style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #92400e)" }}>
                ⚠ Target memakai data dummy (khusus ADMIN, untuk testing tampilan) — belum ada Target asli untuk kuartal ini.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: `Q-Sebelumnya (${ringkasanQSebelumnya ?? "-"}) vs Target`, rencanaPct: rencanaPctSebelumnya, aktifPct: aktifPctSebelumnya, rencanaVal: rencanaSebelumnyaTotal, aktifVal: kesesuaianAktifQSebelumnya.value, target: targetSebelumnyaForCalc, isDummy: targetSebelumnyaIsDummy },
                { label: `Q-Berjalan (${ringkasanQuarter}) vs Target`, rencanaPct: rencanaPctBerjalan, aktifPct: aktifPctBerjalan, rencanaVal: kesesuaianValueRencana, aktifVal: kesesuaianAktifQBerjalan.value, target: targetBerjalanForCalc, isDummy: targetBerjalanIsDummy },
              ].map(({ label, rencanaPct, aktifPct, rencanaVal, aktifVal, target, isDummy }) => (
                <div key={label} className="rounded-lg p-4" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
                  <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>{label}</p>
                  <RingkasanTargetStackedBar
                    rencanaPct={rencanaPct}
                    aktifPct={aktifPct}
                    rencanaLabel={`${formatRp(rencanaVal)} (${rencanaPct != null ? `${rencanaPct.toFixed(0)}%` : "-"})`}
                    aktifLabel={`${formatRp(aktifVal)} (${aktifPct != null ? `${aktifPct.toFixed(0)}%` : "-"})`}
                  />
                  <p className="text-[11px] mt-2" style={{ color: "var(--color-text-faint)" }}>
                    Target {target > 0 ? `${formatRp(target)}${isDummy ? " (dummy)" : ""}` : "-"}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* §5 Breakdown historis — 5 kelompok × 13 metrik, dimensi Rencana/Aktif
              only (Q-Sebelumnya/Realisasi ditunda, docs/summary-ringkasan §5).
              Baris dengan satu angka yang bisa dibandingkan langsung pakai
              RingkasanBarPair compact (sama komponen dengan §2, dipakai ulang
              di sini); baris komposit (Breakdown User/KPDM, Baru vs Retensi —
              dua sub-nilai dalam satu dimensi) tetap teks berdampingan
              sebagai dua chip, bukan bar chart (bukan perbandingan
              satu-angka). */}
          <Card>
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Breakdown Historis</p>
              <RingkasanCompareLegend />
            </div>
            <div className="space-y-6">
              {([
                {
                  title: "Manajemen Risiko",
                  rows: [
                    { label: "Rata-rata Lama Periode", rencanaVal: avgLamaPeriodeRencana ?? 0, rencana: avgLamaPeriodeRencana != null ? `${avgLamaPeriodeRencana.toFixed(1)} bln` : "-", aktifVal: avgLamaPeriodeAktif ?? 0, aktif: avgLamaPeriodeAktif != null ? `${avgLamaPeriodeAktif.toFixed(1)} bln` : "-" },
                    { label: `Breakdown Nilai Estimasi ${ringkasanQuarter}`, rencanaVal: rencanaMonthlyBreakdownQ, rencana: formatRp(rencanaMonthlyBreakdownQ), aktifVal: kesesuaianAktifQBerjalan.value, aktif: formatRp(kesesuaianAktifQBerjalan.value) },
                  ],
                },
                {
                  title: "Customer",
                  rows: [
                    { label: "Jumlah Customer", rencanaVal: ringkasanCustomerTotal, rencana: ringkasanCustomerTotal.toLocaleString("id-ID"), aktifVal: activeCustCodesSet.size, aktif: activeCustCodesSet.size.toLocaleString("id-ID") },
                    {
                      label: "Breakdown User / KPDM", composite: true,
                      rencana: `User ${pihakBreakdownRencana.USER} · KPDM ${pihakBreakdownRencana.KPDM}`, aktif: "Tidak tersedia",
                      splitRencana: [
                        { subLabel: "User", value: pihakBreakdownRencana.USER, display: pihakBreakdownRencana.USER.toLocaleString("id-ID") },
                        { subLabel: "KPDM", value: pihakBreakdownRencana.KPDM, display: pihakBreakdownRencana.KPDM.toLocaleString("id-ID") },
                      ],
                      // Aktif genuinely has no User/KPDM breakdown — PsspKontrak
                      // has no pihakPssp-equivalent field at all (see
                      // docs/summary-ringkasan/01-business-rules.md §5b) —
                      // null (not two zero-value bars), matches aktifUnavailable
                      // convention used elsewhere on this row's non-composite
                      // siblings.
                      splitAktif: null,
                    },
                    { label: "Rata-rata Nilai PSSP per Customer", rencanaVal: ringkasanCustomerTotal > 0 ? ringkasanPsspTotal / ringkasanCustomerTotal : 0, rencana: ringkasanCustomerTotal > 0 ? formatRp(ringkasanPsspTotal / ringkasanCustomerTotal) : "-", aktifVal: activeCustCodesSet.size > 0 ? kesesuaianAktifQBerjalan.value / activeCustCodesSet.size : 0, aktif: activeCustCodesSet.size > 0 ? formatRp(kesesuaianAktifQBerjalan.value / activeCustCodesSet.size) : "-" },
                    { label: "Rata-rata Estimasi Bulanan per Customer", rencanaVal: ringkasanCustomerTotal > 0 ? rencanaMonthlyBreakdownQ / ringkasanCustomerTotal : 0, rencana: ringkasanCustomerTotal > 0 ? formatRp(rencanaMonthlyBreakdownQ / ringkasanCustomerTotal) : "-", aktifVal: activeCustCodesSet.size > 0 ? kesesuaianAktifQBerjalan.value / activeCustCodesSet.size : 0, aktif: activeCustCodesSet.size > 0 ? formatRp(kesesuaianAktifQBerjalan.value / activeCustCodesSet.size) : "-" },
                    {
                      label: "Jumlah Customer Baru vs Retensi", composite: true,
                      rencana: `Baru ${jumlahBaruRencana} · Retensi ${jumlahRetensiRencana}`, aktif: `Baru ${jumlahBaruAktif} · Retensi ${jumlahRetensiAktif}`,
                      splitRencana: [
                        { subLabel: "Baru", value: jumlahBaruRencana, display: jumlahBaruRencana.toLocaleString("id-ID") },
                        { subLabel: "Retensi", value: jumlahRetensiRencana, display: jumlahRetensiRencana.toLocaleString("id-ID") },
                      ],
                      splitAktif: [
                        { subLabel: "Baru", value: jumlahBaruAktif, display: jumlahBaruAktif.toLocaleString("id-ID") },
                        { subLabel: "Retensi", value: jumlahRetensiAktif, display: jumlahRetensiAktif.toLocaleString("id-ID") },
                      ],
                    },
                    { label: "Rata-Rata PSSP ke Berapa", rencanaVal: avgPsspKeRencana ?? 0, rencana: avgPsspKeRencana != null ? `ke-${avgPsspKeRencana.toFixed(1)}` : "-", aktifVal: avgPsspKeAktif ?? 0, aktif: avgPsspKeAktif != null ? `ke-${avgPsspKeAktif.toFixed(1)}` : "-" },
                  ],
                },
                {
                  title: "Produk",
                  rows: [
                    { label: "Rata-Rata Variasi Produk per Estimasi PSSP", rencanaVal: avgVariasiRencana ?? 0, rencana: avgVariasiRencana != null ? avgVariasiRencana.toFixed(1) : "-", aktifVal: avgVariasiAktif ?? 0, aktif: avgVariasiAktif != null ? avgVariasiAktif.toFixed(1) : "-" },
                    { label: "Rata-Rata Variasi Produk Kontes per Estimasi PSSP", rencanaVal: avgVariasiKontesRencana ?? 0, rencana: avgVariasiKontesRencana != null ? avgVariasiKontesRencana.toFixed(1) : "-", aktifVal: avgVariasiKontesAktif ?? 0, aktif: avgVariasiKontesAktif != null ? avgVariasiKontesAktif.toFixed(1) : "-" },
                    { label: "Jumlah Baris per Estimasi PSSP", rencanaVal: avgBarisRencana ?? 0, rencana: avgBarisRencana != null ? avgBarisRencana.toFixed(1) : "-", aktifVal: avgBarisAktif ?? 0, aktif: avgBarisAktif != null ? avgBarisAktif.toFixed(1) : "-" },
                  ],
                },
                {
                  title: "Produktifitas",
                  rows: [
                    { label: "Estimasi PSSP per MR", rencanaVal: produktifitasRencana ?? 0, rencana: produktifitasRencana != null ? formatRp(produktifitasRencana) : "-", aktifVal: produktifitasAktif ?? 0, aktif: produktifitasAktif != null ? formatRp(produktifitasAktif) : "-" },
                  ],
                },
                {
                  title: "Biaya",
                  rows: [
                    { label: "Ratio Biaya", rencanaVal: ratioBiayaRencana ?? 0, rencana: ratioBiayaRencana != null ? `${ratioBiayaRencana.toFixed(0)}%` : "-", aktifVal: ratioBiayaAktif ?? 0, aktif: ratioBiayaAktif != null ? `${ratioBiayaAktif.toFixed(0)}%` : "-" },
                    { label: "PSSP", rencanaVal: biayaBreakdown.pssp.rencana, rencana: formatRp(biayaBreakdown.pssp.rencana), aktifVal: biayaBreakdown.pssp.aktif, aktif: formatRp(biayaBreakdown.pssp.aktif) },
                    { label: "DPL/DPF", rencanaVal: biayaBreakdown.dplDpf.rencana, rencana: formatRp(biayaBreakdown.dplDpf.rencana), aktifVal: 0, aktif: "Tidak tersedia", aktifUnavailable: true },
                    { label: "DP", rencanaVal: biayaBreakdown.dp.rencana, rencana: formatRp(biayaBreakdown.dp.rencana), aktifVal: 0, aktif: "Tidak tersedia", aktifUnavailable: true },
                    { label: "Listing Fee", rencanaVal: biayaBreakdown.listingFee.rencana, rencana: formatRp(biayaBreakdown.listingFee.rencana), aktifVal: biayaBreakdown.listingFee.aktif, aktif: formatRp(biayaBreakdown.listingFee.aktif) },
                    { label: "Entertain", rencanaVal: biayaBreakdown.entertain.rencana, rencana: formatRp(biayaBreakdown.entertain.rencana), aktifVal: 0, aktif: "Tidak tersedia", aktifUnavailable: true },
                  ],
                },
              ] as { title: string; rows: BreakdownRow[] }[]).map(({ title, rows }) => (
                <div key={title}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--color-text-faint)" }}>{title}</p>
                  {/* Grid, not a single-column stack — 5 groups × up to 6
                      rows each as full-width single-column rows made this
                      section scroll very long (2026-08-05 feedback). Rows
                      sit side by side up to 3 per row instead. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {rows.map((r) => (
                      <div key={r.label} className="rounded-md px-3 py-2.5" style={{ background: "var(--color-bg-subtle)" }}>
                        {/* Fixed 2-line height (not just mb-1.5) so labels of
                            different lengths ("PSSP" vs "Rata-rata Estimasi
                            Bulanan per Customer") don't push charts in the
                            same grid row to different vertical positions
                            (2026-08-05 feedback: "dibuat lebih align"). */}
                        <p className="text-xs mb-1.5 line-clamp-2" style={{ color: "var(--color-text-muted)", minHeight: "2.4em" }}>{r.label}</p>
                        {r.composite ? (
                          <RingkasanSplitBarPair
                            rencanaParts={r.splitRencana ?? []}
                            aktifParts={r.splitAktif ?? null}
                          />
                        ) : (
                          <RingkasanBarPair
                            rencanaVal={r.rencanaVal ?? 0}
                            rencanaLabel={r.rencana}
                            aktifVal={r.aktifVal ?? 0}
                            aktifLabel={r.aktif}
                            aktifUnavailable={r.aktifUnavailable ?? false}
                            compact
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
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
