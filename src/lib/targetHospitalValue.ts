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
 * Batched nip×periode -> target resolver, LIVE via GT holder (2026-09-14 —
 * TargetHospitalValue no longer carries a nipMR snapshot column at all, see
 * schema doc comment/migration). Still exactly 2 queries regardless of how
 * many nips/months are asked for (docs/PERFORMANCE.md §2 point 4): one
 * MrOutletAssignment query batched across every nip×month combo (join straight
 * to Outlet.namaGT), one TargetHospitalValue query batched across every month
 * needed — matched in memory via normalizeGTName, same as getTargetHospitalValueRowsForGTs.
 */
export async function resolveTargetByNipAndMonths(nips: string[], months: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (nips.length === 0 || months.length === 0) return result;

  const monthInts = months.map((m) => parseInt(m, 10));
  const assignments = (await prisma.mrOutletAssignment.findMany({
    where: { nipMR: { in: nips }, periode: { in: monthInts } },
    select: { nipMR: true, periode: true, outlet: { select: { namaGT: true } } },
  })) as { nipMR: string; periode: number; outlet: { namaGT: string | null } }[];

  const targetRows = (await prisma.targetHospitalValue.findMany({
    where: { periode: { in: months } },
    select: { namaGT: true, periode: true, target: true },
  })) as { namaGT: string; periode: string; target: { toString(): string } }[];
  const targetByNormGTAndPeriode = new Map<string, number>();
  for (const r of targetRows) {
    const key = `${normalizeGTName(r.namaGT)}|${r.periode}`;
    targetByNormGTAndPeriode.set(key, (targetByNormGTAndPeriode.get(key) ?? 0) + parseFloat(r.target.toString()));
  }

  // MrOutletAssignment is per OUTLET, not per GT — one nip commonly holds
  // MANY outlets under the SAME GT/territory, so dedupe to DISTINCT
  // (nip, periode, normalizedGT) first, or a GT's target gets summed once
  // per outlet under it instead of once per GT (found live 2026-09-14: one
  // nip's 202607 total came out ~23x too high before this dedupe).
  const distinctGTsByNipPeriode = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!a.outlet.namaGT) continue;
    const key = `${a.nipMR}|${a.periode}`;
    const set = distinctGTsByNipPeriode.get(key) ?? new Set<string>();
    set.add(normalizeGTName(a.outlet.namaGT));
    distinctGTsByNipPeriode.set(key, set);
  }

  for (const [key, normGTs] of distinctGTsByNipPeriode) {
    const periode = key.split("|")[1];
    let sum = 0;
    for (const normGT of normGTs) {
      const v = targetByNormGTAndPeriode.get(`${normGT}|${periode}`);
      if (v != null) sum += v;
    }
    result.set(key, sum);
  }
  return result;
}

/**
 * "poa.target manual ?? SUM(target) via subordinate MR nips" resolver
 * (docs/form-poa/01-business-rules.md §3 "Resolusi Target") — the FALLBACK
 * half only (the manual poa.target check stays at each call site). Built
 * 2026-08-24 so every page listing multiple POAs (dashboard, pm-dashboard,
 * summary) can resolve this WITHOUT an N+1 query per row. Built on
 * resolveTargetByNipAndMonths (2026-09-14 rewrite, see its doc comment) —
 * collects every (owner, quarter) pair up front, resolves subordinate MR
 * nips per DISTINCT owner (`getSubordinateMRNips` is itself `cache()`-wrapped
 * in authz.ts, so repeat owners across rows dedupe for free), then ONE
 * batched nip×month resolve covering every combination needed, summed in
 * memory per entry.
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
  const byNipPeriode = await resolveTargetByNipAndMonths(allNips, allMonths);

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
export function normalizeGTName(s: string): string {
  const noDummyPrefix = s.replace(/^\s*DUMMY\s+(SPV|MR)?\s*/i, "");
  return noDummyPrefix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Per-GT rows matching `gts` (as returned by getCurrentGTsForMrNips),
 * matching by normalizeGTName since the two tables' namaGT spelling isn't
 * always identical (see normalizeGTName above) — used for NSM session
 * scoping (2026-09-14: GT-based query only, no more `?nip=` rollup, see
 * docs/API.md). `gts.length === 0` means unrestricted (ADMIN/Basic Auth).
 */
export async function getTargetHospitalValueRowsForGTs(
  gts: string[],
  periode?: string
): Promise<{ namaGT: string; kodeGT: string | null; target: number; periode: string }[]> {
  if (gts.length === 0) return [];
  const wanted = new Set(gts.map(normalizeGTName));
  const rows = (await prisma.targetHospitalValue.findMany({
    where: periode ? { periode } : {},
    select: { namaGT: true, kodeGT: true, periode: true, target: true },
  })) as { namaGT: string; kodeGT: string | null; periode: string; target: { toString(): string } }[];
  return rows
    .filter((r) => wanted.has(normalizeGTName(r.namaGT)))
    .map((r) => ({ namaGT: r.namaGT, kodeGT: r.kodeGT, periode: r.periode, target: parseFloat(r.target.toString()) }))
    .sort((a, b) => a.periode.localeCompare(b.periode) || a.namaGT.localeCompare(b.namaGT, "id"));
}

export interface GTHolderChain {
  nipMR: string | null; namaMR: string | null;
  nipASM: string | null; namaASM: string | null;
  nipSM: string | null; namaSM: string | null;
  nipNSM: string | null; namaNSM: string | null;
}

function emptyGTHolderChain(): GTHolderChain {
  return { nipMR: null, namaMR: null, nipASM: null, namaASM: null, nipSM: null, namaSM: null, nipNSM: null, namaNSM: null };
}

/**
 * Live per-GT holder chain (MR→ASM→SM→NSM) — replaces the old stored
 * nipMR/namaMR/nipASM/.../namaNSM snapshot columns on TargetHospitalValue
 * (dropped 2026-09-14, see migration/schema doc comment). For each canonical
 * `namaGT` (must already be live Outlet spelling — see cleanTargetHospitalValueGT.ts
 * and importTargetHospitalValue.ts's canonicalization): resolve its current
 * MR via Outlet+MrOutletAssignment (same "latest synced periode" fallback as
 * getCurrentGTsForMrNips when `periode` omitted), then walk User.nipAtasan up
 * BFS-per-level (docs/PERFORMANCE.md §2 point 2 — level-bounded, NOT one
 * query per GT/person) — ≤6 queries total regardless of how many GTs are
 * asked for. A GT with no live Outlet match, no current assignment, or a
 * vacant seat anywhere in the chain gets nulls for whatever couldn't resolve
 * — still returned (with `namaGT`), not omitted, so callers can display
 * "Belum ada data" per cell rather than silently dropping the row.
 */
export async function resolveLiveGTHolderChain(namaGTs: string[], periode?: string): Promise<Map<string, GTHolderChain>> {
  const result = new Map<string, GTHolderChain>();
  if (namaGTs.length === 0) return result;

  const outlets = (await prisma.outlet.findMany({
    where: { namaGT: { in: namaGTs } },
    select: { kodePI: true, namaGT: true },
  })) as { kodePI: string; namaGT: string | null }[];
  const outletKodePIsByGT = new Map<string, string[]>();
  for (const o of outlets) {
    if (!o.namaGT) continue;
    const list = outletKodePIsByGT.get(o.namaGT) ?? [];
    list.push(o.kodePI);
    outletKodePIsByGT.set(o.namaGT, list);
  }
  const allOutletKodePI = [...new Set(outlets.map((o) => o.kodePI))];
  if (allOutletKodePI.length === 0) {
    for (const g of namaGTs) result.set(g, emptyGTHolderChain());
    return result;
  }

  const requestedPeriode = periode ? parseInt(periode, 10) : NaN;
  const hasRequestedPeriode = !isNaN(requestedPeriode) && await prisma.mrOutletAssignment.findFirst({
    where: { kodePI: { in: allOutletKodePI }, periode: requestedPeriode },
    select: { periode: true },
  });
  let resolvedPeriode: number | null;
  if (hasRequestedPeriode) {
    resolvedPeriode = requestedPeriode;
  } else {
    const latest = await prisma.mrOutletAssignment.findFirst({
      where: { kodePI: { in: allOutletKodePI } },
      orderBy: { periode: "desc" },
      select: { periode: true },
    });
    resolvedPeriode = latest?.periode ?? null;
  }

  const assignments = resolvedPeriode != null
    ? ((await prisma.mrOutletAssignment.findMany({
        where: { kodePI: { in: allOutletKodePI }, periode: resolvedPeriode },
        select: { kodePI: true, nipMR: true },
      })) as { kodePI: string; nipMR: string }[])
    : [];
  const mrNipByOutlet = new Map(assignments.map((a) => [a.kodePI, a.nipMR]));

  const mrNipByGT = new Map<string, string | null>();
  for (const [gt, kodePIs] of outletKodePIsByGT) {
    mrNipByGT.set(gt, kodePIs.map((k) => mrNipByOutlet.get(k)).find((m): m is string => !!m) ?? null);
  }

  // BFS up the org chain, one findMany per level — MR -> ASM -> SM -> NSM
  // (≤4 iterations, stops early once a level has no nipAtasan left).
  const byNip = new Map<string, { name: string; nipAtasan: string | null }>();
  let frontier = [...new Set([...mrNipByGT.values()].filter((n): n is string => !!n))];
  for (let i = 0; i < 4 && frontier.length > 0; i++) {
    const users = (await prisma.user.findMany({
      where: { nip: { in: frontier } },
      select: { nip: true, name: true, nipAtasan: true },
    })) as { nip: string; name: string; nipAtasan: string | null }[];
    for (const u of users) byNip.set(u.nip, { name: u.name, nipAtasan: u.nipAtasan });
    frontier = [...new Set(users.map((u) => u.nipAtasan).filter((n): n is string => !!n))];
  }

  function chainFor(mrNip: string | null): GTHolderChain {
    if (!mrNip) return emptyGTHolderChain();
    const mr = byNip.get(mrNip) ?? null;
    const asmNip = mr?.nipAtasan ?? null;
    const asm = asmNip ? byNip.get(asmNip) ?? null : null;
    const smNip = asm?.nipAtasan ?? null;
    const sm = smNip ? byNip.get(smNip) ?? null : null;
    const nsmNip = sm?.nipAtasan ?? null;
    const nsm = nsmNip ? byNip.get(nsmNip) ?? null : null;
    return {
      nipMR: mrNip, namaMR: mr?.name ?? null,
      nipASM: asmNip, namaASM: asm?.name ?? null,
      nipSM: smNip, namaSM: sm?.name ?? null,
      nipNSM: nsmNip, namaNSM: nsm?.name ?? null,
    };
  }

  for (const g of namaGTs) result.set(g, chainFor(mrNipByGT.get(g) ?? null));
  return result;
}
