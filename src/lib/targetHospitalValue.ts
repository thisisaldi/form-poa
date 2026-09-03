// The months this target program covers — kept in sync manually, there's no
// calendar-derived source for it. 202608-202612 come from the recurring
// import (scripts/importTargetHospitalValue.ts, "Target Hospital (in Value)
// (1).xlsx"); 202607 was backfilled separately (scripts/
// importTargetHospitalValueJuli.ts, 2026-08-24) from the last month before
// KAM/Hospinet divisions merged — see that script's doc comment for why its
// rows carry a synthetic namaGT instead of a real GT. Split out of the "use
// server" actions file since that file may only export async functions, not
// plain constants.
export const TARGET_HOSPITAL_PERIODS = ["202607", "202608", "202609", "202610", "202611", "202612"] as const;

import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { quarterToMonths } from "@/lib/quarterUtils";
import type { User } from "@prisma/client";

/**
 * Batched "poa.target manual ?? SUM(TargetHospitalValue) via subordinate MR
 * nips" resolver (docs/form-poa/01-business-rules.md §3 "Resolusi Target") —
 * this is the FALLBACK half only (the manual poa.target check stays at each
 * call site, since that's a per-POA field this function never sees). Built
 * 2026-08-24 so every page listing multiple POAs (dashboard, pm-dashboard,
 * summary) can resolve this WITHOUT an N+1 query per row
 * (docs/PERFORMANCE.md §2 point 4 — was previously wired into ONLY
 * poa/[id]/page.tsx's single-POA view, everywhere else silently showed "-"):
 * collect every (owner, quarter) pair up front, resolve subordinate MR nips
 * per DISTINCT owner (`getSubordinateMRNips` is itself `cache()`-wrapped in
 * authz.ts, so repeat owners across rows dedupe for free), then run ONE
 * batched TargetHospitalValue query covering every nip×periode combination
 * needed, summed in memory.
 *
 * `owner` only needs nip+role (getSubordinateMRNips reads nothing else) —
 * accepts a full User for callers that already have one.
 */
export async function resolveTargetHospitalValueFallback(
  entries: { owner: Pick<User, "nip" | "role">; quarter: string }[]
): Promise<Map<string, number>> {
  const perKey = new Map<string, { nips: string[]; months: string[] }>();
  const nipsByOwner = new Map<string, string[]>();

  for (const { owner, quarter } of entries) {
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) continue;
    const key = `${owner.nip}|${quarter}`;
    if (perKey.has(key)) continue;
    let nips = nipsByOwner.get(owner.nip);
    if (!nips) {
      nips = owner.role === "MR" ? [owner.nip] : await getSubordinateMRNips(owner as User);
      nipsByOwner.set(owner.nip, nips);
    }
    perKey.set(key, { nips, months: quarterToMonths(quarter) });
  }

  const allNips = [...new Set([...perKey.values()].flatMap((v) => v.nips))];
  const allMonths = [...new Set([...perKey.values()].flatMap((v) => v.months))];

  const rows = allNips.length > 0 && allMonths.length > 0
    ? await prisma.targetHospitalValue.findMany({
        where: { nipMR: { in: allNips }, periode: { in: allMonths } },
        select: { nipMR: true, periode: true, target: true },
      })
    : [];
  const byNipPeriode = new Map<string, number>();
  for (const r of rows) {
    if (!r.nipMR) continue;
    byNipPeriode.set(`${r.nipMR}|${r.periode}`, parseFloat(r.target.toString()));
  }

  const result = new Map<string, number>();
  for (const [key, { nips, months }] of perKey) {
    let sum = 0, any = false;
    for (const nip of nips) {
      for (const m of months) {
        const v = byNipPeriode.get(`${nip}|${m}`);
        if (v != null) { sum += v; any = true; }
      }
    }
    if (any) result.set(key, sum);
  }
  return result;
}

/**
 * Distinct GT names held by any nip in `mrNips`, from outlet assignment
 * (MrOutletAssignment + Outlet.namaGT) — deliberately NOT
 * TargetHospitalValue's own nipMR/nipASM/nipSM/nipNSM columns, which are a
 * snapshot from whenever the target Excel was last imported and go stale the
 * moment a GT changes hands before the next import (2026-09-02, used by
 * /api/target-value's ?nip= rollup so a reassigned/newly-filled GT's target
 * follows the person immediately, no re-import needed).
 *
 * `periode` (YYYYMM string, e.g. "202608") picks WHICH month's org structure
 * to resolve against — MrOutletAssignment is itself synced per calendar
 * month, so asking for an old periode's target should use that SAME month's
 * GT assignment, not today's (2026-09-03: org structure moves between
 * periods, so latest-only silently mixed the wrong month's GT ownership into
 * an old periode's target). Falls back to the latest synced periode when
 * `periode` is omitted (no single month to anchor to — same pattern as
 * getOutletsForMrSubtree in masterData.ts) OR when `periode` itself was
 * never synced for any of `mrNips` (e.g. it's in the future / sync hasn't
 * run yet) — better a possibly-current answer than none.
 */
export async function getCurrentGTsForMrNips(mrNips: string[], periode?: string): Promise<string[]> {
  if (mrNips.length === 0) return [];
  const requestedPeriode = periode ? parseInt(periode, 10) : NaN;
  const hasRequestedPeriode = !isNaN(requestedPeriode) && await prisma.mrOutletAssignment.findFirst({
    where: { nipMR: { in: mrNips }, periode: requestedPeriode },
    select: { periode: true },
  });
  let resolvedPeriode: number;
  if (hasRequestedPeriode) {
    resolvedPeriode = requestedPeriode;
  } else {
    const latestAssignment = await prisma.mrOutletAssignment.findFirst({
      where: { nipMR: { in: mrNips } },
      orderBy: { periode: "desc" },
      select: { periode: true },
    });
    if (!latestAssignment) return [];
    resolvedPeriode = latestAssignment.periode;
  }
  const assignments = (await prisma.mrOutletAssignment.findMany({
    where: { nipMR: { in: mrNips }, periode: resolvedPeriode },
    select: { outlet: { select: { namaGT: true } } },
  })) as { outlet: { namaGT: string | null } }[];
  const names: (string | null)[] = assignments.map((a) => a.outlet.namaGT);
  return [...new Set(names.filter((g): g is string => !!g))];
}

// Outlet.namaGT (org-structure sync) and TargetHospitalValue.namaGT (target
// Excel import) come from different source files and don't always agree on
// spelling for the same GT. Two known patterns (2026-09-03 audit against 32
// real employees the external "get target" consumer reported as
// NOT_FOUND for 202608, all with a live GT but zero normalized match):
//  1. Punctuation/spacing noise — "+"/"-"/"." used inconsistently, and
//     sometimes a space is just missing/extra inside a word ("BANDUNG
//     A.YANI" vs "BANDUNG A YANI", "GALUHMAS" vs "GALUH MAS"). Stripping
//     every non-alphanumeric character (not just collapsing it to a space)
//     closes these.
//  2. A leading "DUMMY " (optionally "DUMMY SPV "/"DUMMY MR ") in the target
//     sheet's GT name — leftover from when that GT was vacant/placeholder at
//     Excel-authoring time. Confirmed these rows carry REAL submitted target
//     values (e.g. "DUMMY MEDAN PETISAH" = Rp406jt for 202608), not zeros —
//     the GT has since been filled (matches Outlet's un-prefixed live name)
//     but the target sheet's Rekap FFMedrep "Nama GT" cell was never
//     renamed. Stripping the prefix before comparing is safe here because
//     matching only ever runs against `gts` from a REAL nip's live
//     MrOutletAssignment (see getCurrentGTsForMrNips) — there's no live GT
//     to accidentally over-match a genuinely-still-vacant "DUMMY ..." row
//     against.
// A handful of GTs (e.g. "MALANG A/B/C" in the target sheet vs "MALANG
// UTARA/SELATAN/KOTA" in Outlet, or "CIKOKOL + BANJAR" vs "CIKOKOL +
// SUKAJADI" — different territory composition, not just spelling) don't
// close under either rule — those need manual reconciliation on the source
// side, not more normalization.
function normalizeGTName(s: string): string {
  const noDummyPrefix = s.replace(/^\s*DUMMY\s+(SPV|MR)?\s*/i, "");
  return noDummyPrefix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function findTargetHospitalValueRowsForGTs(
  gts: string[],
  periode?: string
): Promise<{ namaGT: string; nipMR: string | null; namaMR: string; target: number; periode: string }[]> {
  if (gts.length === 0) return [];
  const wanted = new Set(gts.map(normalizeGTName));
  const rows = (await prisma.targetHospitalValue.findMany({
    where: periode ? { periode } : {},
    select: { namaGT: true, nipMR: true, namaMR: true, periode: true, target: true },
  })) as { namaGT: string; nipMR: string | null; namaMR: string; periode: string; target: { toString(): string } }[];
  return rows
    .filter((r) => wanted.has(normalizeGTName(r.namaGT)))
    .map((r) => ({ namaGT: r.namaGT, nipMR: r.nipMR, namaMR: r.namaMR, periode: r.periode, target: parseFloat(r.target.toString()) }));
}

/**
 * Sums TargetHospitalValue.target for every GT in `gts` (as returned by
 * getCurrentGTsForMrNips), matching by normalizeGTName since the two tables'
 * namaGT spelling isn't always identical (see normalizeGTName above).
 */
export async function sumTargetHospitalValueForGTs(
  gts: string[],
  periode?: string
): Promise<{ periode: string; target: number }[]> {
  const rows = await findTargetHospitalValueRowsForGTs(gts, periode);
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.periode, (sums.get(r.periode) ?? 0) + r.target);
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([periode, target]) => ({ periode, target }));
}

/**
 * Same GT matching as sumTargetHospitalValueForGTs, but returns the raw
 * per-GT rows instead of a single summed total per periode — same shape as
 * /api/target-value's no-`?nip=` "get target all" response, scoped to just
 * `gts` (2026-09-03, for callers who want the per-GT breakdown under a
 * subtree, not just its total).
 */
export async function getTargetHospitalValueRowsForGTs(
  gts: string[],
  periode?: string
): Promise<{ namaGT: string; nipMR: string | null; namaMR: string; target: number; periode: string }[]> {
  const rows = await findTargetHospitalValueRowsForGTs(gts, periode);
  return rows.sort((a, b) => a.periode.localeCompare(b.periode) || a.namaGT.localeCompare(b.namaGT, "id"));
}
