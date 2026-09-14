/**
 * GET /api/target-value
 *
 * Monthly Rupiah sales target, ONE ROW PER GT — `?divisi=hospital` (default,
 * omit = same) serves `TargetHospitalValue`, `?divisi=non-hospital` serves
 * `TargetNonHospitalValue` (project `OMEGA` team — docs/target-non-hospital-value/).
 * One endpoint, two backing tables — merged 2026-09-11 per user request
 * instead of a separate route, since query shape/auth is otherwise
 * identical.
 *
 * GT-BASED ONLY (2026-09-14): there is no `?nip=` rollup-by-person anymore —
 * every response is an array of per-GT rows, always carrying `namaGT` +
 * `kodeGT` (nullable, ~96% populated for hospital, ~100% for non-hospital —
 * see the schema doc comments on each table's `kodeGT` column).
 * BREAKING CHANGE from the earlier `?nip=` contract — coordinate with any
 * existing external caller (e.g. Insentif Sales, which was using `?nip=` as
 * of 2026-09-13) before relying on this removal in production.
 *
 * NO PERSONNEL FIELDS AT ALL (2026-09-14, same date, second breaking change —
 * DB migration dropped nipMR/namaMR/nipASM/.../namaNSM from both tables
 * entirely, not just this endpoint hiding them): a row is namaGT/kodeGT/
 * target/periode/divisi(+kategori for non-hospital) only. "Who currently
 * holds this GT" is NOT in this response — callers who need that resolve it
 * live themselves (same live GT-holder resolution this endpoint already uses
 * internally for NSM scoping — see getCurrentGTsForMrNips/
 * getCurrentGTsForOmegaMrNips, or resolveLiveGTHolderChain for the full
 * MR→ASM→SM→NSM chain, hospital only).
 *
 * `?namaGT=` / `?kodeGT=` (optional, both — GT filters): `namaGT` matches
 * via normalizeGTName for hospital (spelling drift between the target sheet
 * and live Outlet — see targetHospitalValue.ts) and literally for
 * non-hospital (already aligned to the STRUKTUR sheet at import time).
 * `kodeGT` always matches literally.
 *
 * `?periode=` (`YYYYMM`) narrows to one month. For hospital this ALSO picks
 * which month's MrOutletAssignment org structure resolves an NSM session's
 * own GT scope (see below) — irrelevant for non-hospital (always current,
 * no per-month assignment history there).
 *
 * `?kategori=RETAIL` or `?kategori=GROSIR_PBF` (non-hospital only,
 * case-insensitive) — filters the 2 blocks the source sheet has per area;
 * omitted = both in one response, distinguishable via each row's `kategori`
 * field. Named differently from `?divisi` (hospital/non-hospital picker
 * here) to avoid clashing with it.
 *
 * Access — same two credential paths as /api/poa-doctors: session cookie
 * (NSM or ADMIN only, other roles 403) or HTTP Basic Auth against the same
 * admin-managed PoaDoctorsApiCredential row /api/poa-doctors uses. ADMIN
 * session and Basic Auth are unrestricted (any GT, company-wide). A session
 * NSM is auto-scoped to their OWN subtree's currently-held GTs (resolved
 * live the same way the old `?nip=` rollup did — getSubordinateMRNips + live
 * GT-holder resolution — just no longer exposed as a query param); `namaGT`/
 * `kodeGT` further narrow WITHIN that scope, they can't escape it.
 *
 * `?limit=`/`?offset=` (2026-09-14, docs/PERFORMANCE.md §2 point 3 — "an
 * unbounded 'see everything' response must be explicit, never the silent
 * default"): applied uniformly to the final row array, AFTER all filtering
 * above (namaGT/kodeGT/kategori/scope) — same slice logic regardless of
 * divisi or NSM scoping, so behavior is easy to reason about even though the
 * unscoped ADMIN/Basic Auth path could in principle push this down to the DB
 * query instead (current row counts — low thousands — make the in-memory
 * slice cost negligible; revisit if that stops being true). `limit` default
 * 2000, max 5000 (`400` if `limit`/`offset` isn't a valid non-negative
 * integer, or `limit` > 5000). Total row count BEFORE slicing is returned in
 * the `X-Total-Count` response header — a caller only ever seeing exactly
 * `limit` rows with `X-Total-Count` larger than that means more pages exist
 * (page forward with `offset += limit`).
 */

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { getSubordinateMRNips } from "@/lib/authz";
import { getCurrentGTsForMrNips, getTargetHospitalValueRowsForGTs, normalizeGTName } from "@/lib/targetHospitalValue";
import {
  getCurrentGTsForOmegaMrNips,
  resolveOmegaMrNipsForOwner,
  getTargetNonHospitalValueRowsForGTs,
} from "@/lib/targetNonHospitalValue";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

/** Applies `?limit=`/`?offset=` to the final row array; returns the slice + total (pre-slice) count for X-Total-Count. */
function paginate<T>(rows: T[], limit: number, offset: number): { page: T[]; total: number } {
  return { page: rows.slice(offset, offset + limit), total: rows.length };
}

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();

  if (session) {
    if (session.role !== "NSM" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Hanya NSM atau Admin yang bisa mengakses target value." }, { status: 403 });
    }
  } else {
    const credential = await prisma.poaDoctorsApiCredential.findUnique({ where: { id: 1 } });
    if (!verifyBasicAuth(req, credential)) {
      return NextResponse.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="target-value"' },
      });
    }
  }

  const periode = req.nextUrl.searchParams.get("periode")?.trim();
  const namaGT = req.nextUrl.searchParams.get("namaGT")?.trim();
  const kodeGT = req.nextUrl.searchParams.get("kodeGT")?.trim();
  const divisi = req.nextUrl.searchParams.get("divisi")?.trim().toLowerCase() || "hospital";

  if (divisi !== "hospital" && divisi !== "non-hospital") {
    return NextResponse.json({ error: 'divisi harus "hospital" atau "non-hospital".' }, { status: 400 });
  }

  const limitParam = req.nextUrl.searchParams.get("limit")?.trim();
  const offsetParam = req.nextUrl.searchParams.get("offset")?.trim();
  const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
  const offset = offsetParam ? Number(offsetParam) : 0;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    return NextResponse.json({ error: `limit harus integer 1-${MAX_LIMIT}.` }, { status: 400 });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "offset harus integer >= 0." }, { status: 400 });
  }

  if (divisi === "non-hospital") {
    const kategori = req.nextUrl.searchParams.get("kategori")?.trim().toUpperCase() || undefined;

    let rows: Awaited<ReturnType<typeof getTargetNonHospitalValueRowsForGTs>>;
    if (session?.role === "NSM") {
      const mrNips = await resolveOmegaMrNipsForOwner({ nip: session.userId, role: "NSM" } as User);
      const scopeGTs = await getCurrentGTsForOmegaMrNips(mrNips);
      rows = await getTargetNonHospitalValueRowsForGTs(scopeGTs, { periode, divisi: kategori });
    } else {
      const where: Record<string, unknown> = {};
      if (periode) where.periode = periode;
      if (kategori) where.divisi = kategori;
      if (kodeGT) where.kodeGT = kodeGT;
      if (namaGT) where.namaGT = namaGT;
      const found = await prisma.targetNonHospitalValue.findMany({
        where,
        select: { namaGT: true, kodeGT: true, divisi: true, target: true, periode: true },
        orderBy: [{ periode: "asc" }, { namaGT: "asc" }],
      });
      rows = found.map((r: (typeof found)[number]) => ({ ...r, target: parseFloat(r.target.toString()) }));
    }

    // Scoped path doesn't filter by namaGT/kodeGT in the DB query above (it
    // already narrows to `scopeGTs`) — apply as a further in-scope narrow here.
    if (session?.role === "NSM") {
      if (namaGT) rows = rows.filter((r) => r.namaGT === namaGT);
      if (kodeGT) rows = rows.filter((r) => r.kodeGT === kodeGT);
    }

    const mapped = rows.map((r) => ({
      namaGT: r.namaGT,
      kodeGT: r.kodeGT,
      divisi: "non-hospital",
      kategori: r.divisi, // r's OWN divisi (RETAIL/GROSIR_PBF) — NOT the hospital/non-hospital tag above
      target: r.target,
      periode: r.periode,
    }));
    const { page, total } = paginate(mapped, limit, offset);
    return NextResponse.json(page, { headers: { "X-Total-Count": String(total) } });
  }

  // ── Hospital ──
  if (session?.role === "NSM") {
    const mrNips = await getSubordinateMRNips({ nip: session.userId, role: "NSM" } as User);
    const scopeGTs = await getCurrentGTsForMrNips(mrNips, periode);
    let rows = await getTargetHospitalValueRowsForGTs(scopeGTs, periode);
    if (namaGT) rows = rows.filter((r) => normalizeGTName(r.namaGT) === normalizeGTName(namaGT));
    if (kodeGT) rows = rows.filter((r) => r.kodeGT === kodeGT);
    const { page, total } = paginate(rows.map((r) => ({ ...r, divisi: "hospital" })), limit, offset);
    return NextResponse.json(page, { headers: { "X-Total-Count": String(total) } });
  }

  const where: Record<string, unknown> = {};
  if (periode) where.periode = periode;
  if (kodeGT) where.kodeGT = kodeGT;

  const rows = await prisma.targetHospitalValue.findMany({
    where,
    select: { namaGT: true, kodeGT: true, target: true, periode: true },
    orderBy: [{ periode: "asc" }, { namaGT: "asc" }],
  });

  const mapped = rows
    .filter((r: (typeof rows)[number]) => !namaGT || normalizeGTName(r.namaGT) === normalizeGTName(namaGT))
    .map((r: (typeof rows)[number]) => ({
      namaGT: r.namaGT,
      kodeGT: r.kodeGT,
      divisi: "hospital",
      target: parseFloat(r.target.toString()),
      periode: r.periode,
    }));
  const { page, total } = paginate(mapped, limit, offset);
  return NextResponse.json(page, { headers: { "X-Total-Count": String(total) } });
}
