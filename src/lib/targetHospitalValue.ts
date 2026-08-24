// Same 5 months the import script (scripts/importTargetHospitalValue.ts)
// populates from "Target Hospital (in Value).xlsx" — kept in sync manually,
// there's no calendar-derived source for which months this target program
// actually covers. Split out of the "use server" actions file since that
// file may only export async functions, not plain constants.
export const TARGET_HOSPITAL_PERIODS = ["202608", "202609", "202610", "202611", "202612"] as const;

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
