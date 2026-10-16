import type { PoaStatus, Role, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPendingActionScFilter } from "@/lib/authz";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { quarterToMonths } from "@/lib/quarterUtils";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { SC_APPROVALS_OUTLET_PAGE_SIZE } from "@/components/sc/approvalsPaging";
import type { MrApprovalGroup, ScApprovalsMetrics } from "@/components/sc/SalesCounterApprovalsChecklist";
import type { ScDraftFormItem } from "@/components/sc/types";
import {
  SC_DRAFT_FORM_INCLUDE,
  loadScLiveOutletData,
  loadScMasterProducts,
  toScDraftItem,
  type ScLiveOutletData,
} from "../../_services/scDraftItems";

/**
 * Data for /sc/approvals read from the summary stored on each form
 * (docs/sc-form-summary). Per request it loads one light row per pending form
 * (no products), a few aggregates, and the full relations of only the outlet
 * cards on the current page — instead of every pending form with all its
 * products plus one Canvasser call per outlet.
 */

interface PendingRow {
  id: string;
  period: string;
  kodePI: string;
  namaOutlet: string | null;
  status: PoaStatus;
  version: number;
  ownerId: string;
  summaryVersion: number | null;
  sumEstimasiSales: { toString(): string } | null;
  sumBudgetSc: { toString(): string } | null;
}

interface OwnerNode {
  nip: string;
  name: string;
  role: Role;
  reportsTo?: { nip: string; name: string; role: Role; reportsTo?: { nip: string; name: string; role: Role } | null } | null;
}

function resolveAsm(owner: OwnerNode): { nip: string; name: string } | null {
  if (owner.role === "ASM") return { nip: owner.nip, name: owner.name };
  if (owner.reportsTo?.role === "ASM") return { nip: owner.reportsTo.nip, name: owner.reportsTo.name };
  if (owner.reportsTo?.reportsTo?.role === "ASM") return { nip: owner.reportsTo.reportsTo.nip, name: owner.reportsTo.reportsTo.name };
  if (owner.reportsTo) return { nip: owner.reportsTo.nip, name: owner.reportsTo.name };
  return null;
}

const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

export interface ScApprovalsSummaryData {
  availablePeriods: string[];
  selectedPeriod: string;
  /** Every pending form in the selected period(s). */
  totalFormCount: number;
  /** Pending forms without a stored summary; they are missing from the totals. */
  uncomputedCount: number;
  metrics: ScApprovalsMetrics;
  quarterMonths: string[];
  mrGroups: MrApprovalGroup[];
  /** ASM view: ids of every pending form (Select All) and the cards of the current page. */
  allFormIds: string[];
  pagedDrafts: ScDraftFormItem[];
  outletPage: number;
  outletTotalPages: number;
}

export async function getScApprovalsSummaryData(
  actor: User,
  { period, page }: { period?: string; page?: number }
): Promise<ScApprovalsSummaryData> {
  const pendingFilter = getPendingActionScFilter(actor);

  const periodRows: { period: string }[] = await prisma.poaScForm.findMany({
    where: pendingFilter,
    select: { period: true },
    distinct: ["period"],
    orderBy: { period: "desc" },
  });
  const availablePeriods = periodRows.map((p) => p.period);
  const selectedPeriod = period && availablePeriods.includes(period) ? period : "ALL";
  const where = selectedPeriod !== "ALL" ? { ...pendingFilter, period: selectedPeriod } : pendingFilter;

  const rows: PendingRow[] = await prisma.poaScForm.findMany({
    where,
    select: {
      id: true,
      period: true,
      kodePI: true,
      namaOutlet: true,
      status: true,
      version: true,
      ownerId: true,
      summaryVersion: true,
      sumEstimasiSales: true,
      sumBudgetSc: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const ids = rows.map((r) => r.id);
  const dominantPeriod = selectedPeriod !== "ALL" ? selectedPeriod : (rows[0]?.period ?? "");

  let quarterMonths: string[] = [];
  try {
    quarterMonths = dominantPeriod ? quarterToMonths(dominantPeriod) : [];
  } catch {
    quarterMonths = [];
  }

  const isASM = actor.role === "ASM";

  const [sums, monthlyRows, personRows, productRows] = await Promise.all([
    prisma.poaScForm.aggregate({
      where,
      _sum: {
        sumEstimasiSales: true,
        sumNilaiSc: true,
        sumDiskon: true,
        sumCashback: true,
        sumEntertain: true,
        sumBudgetSc: true,
        tercacahEstimasiSales: true,
        tercacahNilaiSc: true,
        historySalesQuarter: true,
      },
    }),
    ids.length > 0
      ? (prisma.$queryRaw`
          SELECT m.key AS "month",
                 SUM((m.value->>'estimasiSales')::numeric)::float8 AS "estimasiSales",
                 SUM((m.value->>'nilaiSc')::numeric)::float8 AS "nilaiSc"
          FROM "PoaScForm" f
          CROSS JOIN LATERAL jsonb_each(f."monthlyBreakdown") AS m
          WHERE f."id" = ANY(${ids}) AND jsonb_typeof(f."monthlyBreakdown") = 'object'
          GROUP BY m.key
        ` as Promise<{ month: string; estimasiSales: number; nilaiSc: number }[]>)
      : Promise.resolve([]),
    ids.length > 0
      ? (prisma.$queryRaw`
          SELECT COUNT(DISTINCT "outletPersonId")::int AS "persons"
          FROM "PoaScPersonItem"
          WHERE "poaScId" = ANY(${ids})
        ` as Promise<{ persons: number }[]>)
      : Promise.resolve([{ persons: 0 }]),
    // Product variety per group card and for the panel; not needed for the ASM outlet cards.
    ids.length > 0
      ? (prisma.$queryRaw`
          SELECT DISTINCT "poaScId", "kodeProduk"
          FROM "PoaScProductItem"
          WHERE "poaScId" = ANY(${ids})
        ` as Promise<{ poaScId: string; kodeProduk: string }[]>)
      : Promise.resolve([]),
  ]);

  // Same shape the panel built in the browser: only the months of the dominant quarter.
  const monthly = new Map(quarterMonths.map((m) => [m, { estimasiSales: 0, nilaiSc: 0 }]));
  for (const r of monthlyRows) {
    if (monthly.has(r.month)) monthly.set(r.month, { estimasiSales: r.estimasiSales || 0, nilaiSc: r.nilaiSc || 0 });
  }

  const productsByForm = new Map<string, string[]>();
  for (const r of productRows) {
    if (!r.kodeProduk) continue;
    const list = productsByForm.get(r.poaScId);
    if (list) list.push(r.kodeProduk);
    else productsByForm.set(r.poaScId, [r.kodeProduk]);
  }

  let historyQuarterLabel = "";
  try {
    historyQuarterLabel = dominantPeriod ? getB3RollingPeriodInfo(dominantPeriod).rangeLabel : "";
  } catch {
    historyQuarterLabel = "";
  }

  const s = sums._sum;
  const metrics: ScApprovalsMetrics = {
    totalEstimasiSales: num(s.sumEstimasiSales),
    totalHistorySalesQuarter: num(s.historySalesQuarter),
    historyQuarterLabel,
    totalNilaiSc: num(s.sumNilaiSc),
    totalDiskon: num(s.sumDiskon),
    totalCashback: num(s.sumCashback),
    totalEntertain: num(s.sumEntertain),
    totalBudgetSc: num(s.sumBudgetSc),
    tercacahEstimasiSales: num(s.tercacahEstimasiSales),
    tercacahNilaiSc: num(s.tercacahNilaiSc),
    monthlyBreakdown: Array.from(monthly.entries()),
    productCount: new Set(productRows.map((r) => r.kodeProduk).filter(Boolean)).size,
    personCount: personRows[0]?.persons ?? 0,
    totalProductEntries: productRows.length,
  };

  const mrGroups = isASM ? [] : await buildGroups(actor, rows, productsByForm);
  const paged = isASM ? await loadOutletPage(actor, rows, page) : { pagedDrafts: [], outletPage: 1, outletTotalPages: 1 };

  return {
    availablePeriods,
    selectedPeriod,
    totalFormCount: rows.length,
    uncomputedCount: rows.filter((r) => r.summaryVersion == null).length,
    metrics,
    quarterMonths,
    mrGroups,
    allFormIds: ids,
    ...paged,
  };
}

/** Group cards: per MR, or per ASM when the viewer is an NSM. */
async function buildGroups(
  actor: User,
  rows: PendingRow[],
  productsByForm: Map<string, string[]>
): Promise<MrApprovalGroup[]> {
  if (rows.length === 0) return [];
  const isNSM = actor.role === "NSM";
  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
  const periods = Array.from(new Set(rows.map((r) => r.period)));

  const [owners, groupForms] = await Promise.all([
    prisma.user.findMany({
      where: { nip: { in: ownerIds } },
      select: {
        nip: true,
        name: true,
        role: true,
        reportsTo: {
          select: { nip: true, name: true, role: true, reportsTo: { select: { nip: true, name: true, role: true } } },
        },
      },
    }) as Promise<OwnerNode[]>,
    // Every non-draft form of these owners and periods, for "N disetujui · N belum".
    prisma.poaScForm.findMany({
      where: { ownerId: { in: ownerIds }, period: { in: periods }, status: { not: "DRAFT" as PoaStatus } },
      select: { ownerId: true, period: true, status: true },
    }) as Promise<{ ownerId: string; period: string; status: string }[]>,
  ]);
  const ownerByNip = new Map(owners.map((o) => [o.nip, o]));

  let badgeLabel = "Butuh Tindakan";
  if (actor.role === "ASM") badgeLabel = "Butuh Approval ASM";
  else if (actor.role === "SM") badgeLabel = "Butuh Approval SM";
  else if (actor.role === "NSM") badgeLabel = "Butuh Approval NSM";

  interface Bucket {
    groupKey: string;
    groupType: "MR" | "ASM";
    nip: string;
    name: string;
    period: string;
    asmName: string | null;
    ownerNips: Set<string>;
    forms: PendingRow[];
  }
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const owner = ownerByNip.get(row.ownerId) ?? { nip: row.ownerId, name: row.ownerId, role: "MR" as Role };
    const asm = resolveAsm(owner);
    const groupType: "MR" | "ASM" = isNSM ? "ASM" : "MR";
    const nip = isNSM ? (asm?.nip ?? owner.nip) : owner.nip;
    const name = isNSM ? (asm?.name ?? owner.name) : owner.name;
    const groupKey = isNSM ? `${row.period}_${nip}` : `${row.period}_${row.ownerId}`;

    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = { groupKey, groupType, nip, name, period: row.period, asmName: asm?.name ?? null, ownerNips: new Set(), forms: [] };
      buckets.set(groupKey, bucket);
    }
    bucket.forms.push(row);
    bucket.ownerNips.add(row.ownerId);
  }

  return Array.from(buckets.values()).map((g) => {
    const matching = groupForms.filter((f) => g.ownerNips.has(f.ownerId) && f.period === g.period);
    const approvedCount = matching.filter((f) => f.status === "APPROVED_BY_NSM").length;

    const outlets = new Set<string>();
    const products = new Set<string>();
    let totalEstimasiSales = 0;
    let totalBudgetSc = 0;
    for (const f of g.forms) {
      if (f.kodePI) outlets.add(f.kodePI);
      for (const code of productsByForm.get(f.id) ?? []) products.add(code);
      totalEstimasiSales += num(f.sumEstimasiSales);
      totalBudgetSc += num(f.sumBudgetSc);
    }

    return {
      groupKey: g.groupKey,
      groupType: g.groupType,
      ownerNip: g.nip,
      ownerName: g.name,
      period: g.period,
      status: g.forms[0]?.status ?? ("SUBMITTED_TO_ASM" as PoaStatus),
      version: g.forms[0]?.version ?? 1,
      badgeLabel,
      asmName: g.groupType === "MR" ? g.asmName : null,
      mrCount: g.groupType === "ASM" ? g.ownerNips.size : undefined,
      totalEstimasiSales,
      outletCount: outlets.size,
      variasiProdukCount: products.size,
      targetValue: null,
      targetRatio: null,
      approvedCount,
      belumCount: matching.length - approvedCount,
      totalBudgetSc,
      targetHref:
        g.groupType === "ASM" ? `/sc/${g.period}?owner=${g.nip}&approvalType=ASM` : `/sc/${g.period}?owner=${g.nip}`,
      forms: g.forms.map((f) => ({
        id: f.id,
        kodePI: f.kodePI,
        namaOutlet: f.namaOutlet || "",
        status: f.status,
        version: f.version,
      })),
    };
  });
}

/** ASM view: full data for the outlet cards of one page only. */
async function loadOutletPage(
  actor: User,
  rows: PendingRow[],
  page: number | undefined
): Promise<Pick<ScApprovalsSummaryData, "pagedDrafts" | "outletPage" | "outletTotalPages">> {
  const outletTotalPages = Math.max(1, Math.ceil(rows.length / SC_APPROVALS_OUTLET_PAGE_SIZE));
  const outletPage = Math.min(Math.max(1, Math.floor(page || 1)), outletTotalPages);
  const pageRows = rows.slice((outletPage - 1) * SC_APPROVALS_OUTLET_PAGE_SIZE, outletPage * SC_APPROVALS_OUTLET_PAGE_SIZE);
  if (pageRows.length === 0) return { pagedDrafts: [], outletPage, outletTotalPages };

  const forms: any[] = await prisma.poaScForm.findMany({
    where: { id: { in: pageRows.map((r) => r.id) } },
    include: SC_DRAFT_FORM_INCLUDE,
  });
  const formById = new Map(forms.map((f) => [f.id, f]));

  // Canvasser only for the cards on this page that have no stored summary yet.
  const liveByKey = new Map<string, ScLiveOutletData>();
  const liveByPeriod = new Map<string, string[]>();
  for (const f of forms) {
    if (f.summaryVersion != null) continue;
    const list = liveByPeriod.get(f.period);
    if (list) list.push(f.kodePI);
    else liveByPeriod.set(f.period, [f.kodePI]);
  }

  const [master, blastInSet] = await Promise.all([
    loadScMasterProducts(forms.flatMap((f) => f.products.map((p: { kodeProduk: string }) => p.kodeProduk))),
    getBlastInOutletSet().catch(() => new Set<string>()),
    ...Array.from(liveByPeriod.entries()).map(async ([formPeriod, kodePIs]) => {
      const live = await loadScLiveOutletData(kodePIs, formPeriod, getB3RollingPeriodInfo(formPeriod).targetPeriods);
      for (const [kodePI, data] of live) liveByKey.set(`${formPeriod}|${kodePI}`, data);
    }),
  ]);

  const pagedDrafts = pageRows
    .map((r) => formById.get(r.id))
    .filter(Boolean)
    .map((f) =>
      toScDraftItem(f, {
        master,
        isBlastIn: blastInSet.has(f.kodePI),
        live: liveByKey.get(`${f.period}|${f.kodePI}`),
      })
    );
  return { pagedDrafts, outletPage, outletTotalPages };
}
