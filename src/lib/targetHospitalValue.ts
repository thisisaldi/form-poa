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
 * Distinct GT names currently held by any nip in `mrNips`, from LIVE outlet
 * assignment (MrOutletAssignment + Outlet.namaGT, latest synced periode —
 * same pattern as getOutletsForMrSubtree in masterData.ts) — deliberately
 * NOT TargetHospitalValue's own nipMR/nipASM/nipSM/nipNSM columns, which are
 * a snapshot from whenever the target Excel was last imported and go stale
 * the moment a GT changes hands before the next import (2026-09-02, used by
 * /api/target-value's ?nip= rollup so a reassigned/newly-filled GT's target
 * follows the person immediately, no re-import needed).
 */
export async function getCurrentGTsForMrNips(mrNips: string[]): Promise<string[]> {
  if (mrNips.length === 0) return [];
  const latestAssignment = await prisma.mrOutletAssignment.findFirst({
    where: { nipMR: { in: mrNips } },
    orderBy: { periode: "desc" },
    select: { periode: true },
  });
  if (!latestAssignment) return [];
  const assignments = (await prisma.mrOutletAssignment.findMany({
    where: { nipMR: { in: mrNips }, periode: latestAssignment.periode },
    select: { outlet: { select: { namaGT: true } } },
  })) as { outlet: { namaGT: string | null } }[];
  const names: (string | null)[] = assignments.map((a) => a.outlet.namaGT);
  return [...new Set(names.filter((g): g is string => !!g))];
}

// Outlet.namaGT (org-structure sync) and TargetHospitalValue.namaGT (target
// Excel import) come from different source files and don't always agree on
// punctuation for combined territories — e.g. Outlet has "JEMBER + BONDOWOSO",
// the target sheet has "JEMBER BONDOWOSO" (confirmed 2026-09-02: Outlet's
// "+" form is the correct one). Stripping +/-/whitespace before comparing
// closes most of that gap (verified: 229/315 distinct TargetHospitalValue
// names already matched Outlet exactly or after this normalization; the
// ~19 real remaining mismatches are actual GT renames/restructuring not yet
// synced either side, not a formatting issue this can paper over).
function normalizeGTName(s: string): string {
  return s.replace(/[+-]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
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
  if (gts.length === 0) return [];
  const wanted = new Set(gts.map(normalizeGTName));
  const rows = await prisma.targetHospitalValue.findMany({
    where: periode ? { periode } : {},
    select: { namaGT: true, periode: true, target: true },
  });
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (!wanted.has(normalizeGTName(r.namaGT))) continue;
    sums.set(r.periode, (sums.get(r.periode) ?? 0) + parseFloat(r.target.toString()));
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([periode, target]) => ({ periode, target }));
}
