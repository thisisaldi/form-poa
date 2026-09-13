/**
 * GET /api/target-value
 *
 * Monthly Rupiah sales target — `?divisi=hospital` (default, omit = same)
 * serves `TargetHospitalValue`, `?divisi=non-hospital` serves
 * `TargetNonHospitalValue` (project `OMEGA` team — docs/target-non-hospital-value/).
 * One endpoint, two backing tables — merged 2026-09-11 per user request
 * instead of a separate route, since query shape/auth is otherwise
 * identical. Everything below this point describes the HOSPITAL path;
 * see the "non-hospital" section further down for what differs.
 *
 * `?nip=` (optional) determines whose rollup to return — role must be one of
 * MR/ASM/SM/NSM. `target` is the SUM of TargetHospitalValue over every GT
 * that nip's subtree of MRs CURRENTLY holds, resolved LIVE from
 * MrOutletAssignment/Outlet.namaGT (see getCurrentGTsForMrNips), not from
 * TargetHospitalValue's own nipMR/nipASM/nipSM/nipNSM columns — those are a
 * snapshot from whenever the target Excel was last imported, so a GT that
 * changed hands since then would still count for the old owner there.
 * Omitted = "get target all": one row PER GT per periode (`namaGT` is
 * the unit of assignment — stable across MR reassignment/vacancy, unlike
 * nip), carrying whoever currently holds that GT (`nipMR`/`namaMR`; `nipMR`
 * is null and `namaMR` a raw placeholder like "VACANT MR ..." when
 * unresolved — see the import scripts' name-resolution notes).
 *
 * `?breakdown` (any value, only meaningful with `?nip=`): returns the same
 * per-GT row shape as "get target all" above, instead of one summed total
 * per periode.
 *
 * `?namaGT=` (ignored if `?nip=` is also present/forced — nip wins): same
 * per-GT row shape as "get target all", filtered to just that one GT.
 * Matched via normalizeGTName (targetHospitalValue.ts) so either the live
 * Outlet.namaGT spelling or the TargetHospitalValue/Excel spelling works.
 * For a session NSM, `nip` is always forced to their own nip (see below), so
 * `?namaGT=` only ever takes effect for Basic Auth or an ADMIN session.
 *
 * Two credential paths, same pattern as /api/poa-doctors (2026-08-19): the
 * app's own browser calls carry a session cookie; an external app
 * authenticates with HTTP Basic Auth instead, checked against the SAME
 * admin-managed PoaDoctorsApiCredential row /api/poa-doctors uses (no
 * separate credential for this endpoint). A session NSM is always forced to
 * their own nip (any `?nip=` they pass is ignored) — same subtree-only
 * access the admin Target Value page's searchTargetHospitalValueAction
 * enforces; Basic Auth and ADMIN sessions can query any nip.
 *
 * ── Non-hospital (`?divisi=non-hospital`) — what's different ──
 * - GT live resolution is `User.namaWilayah` (project OMEGA, role MR)
 *   directly — no Outlet/MrOutletAssignment table for this team, see
 *   getCurrentGTsForOmegaMrNips. `?periode`-aware org structure (hospital's
 *   MrOutletAssignment-per-month thing) doesn't apply — always current.
 * - Only 2 periods exist in the source: 202608, 202609 (TARGET_NON_HOSPITAL_PERIODS).
 * - `?kategori=RETAIL` or `?kategori=GROSIR_PBF` (case-insensitive) filters
 *   to one of the 2 blocks the source sheet has per area — omitted = both.
 *   Named differently from `?divisi` (which picks hospital vs non-hospital
 *   here) to avoid clashing with it.
 * - No `normalizeGTName` — namaGT matches literally (User.namaWilayah
 *   already spells GTs the same as the target sheet, confirmed by sampling).
 * - Per-GT rows carry `kategori` instead of the ASM/SM/NSM columns hospital
 *   rows have (source sheet has no ASM/NSM column, see
 *   docs/target-non-hospital-value/02-data-model.md).
 */

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { getSubordinateMRNips } from "@/lib/authz";
import { getCurrentGTsForMrNips, sumTargetHospitalValueForGTs, getTargetHospitalValueRowsForGTs } from "@/lib/targetHospitalValue";
import {
  getCurrentGTsForOmegaMrNips,
  resolveOmegaMrNipsForOwner,
  sumTargetNonHospitalValueForGTs,
  getTargetNonHospitalValueRowsForGTs,
  getUserProjectByNip,
} from "@/lib/targetNonHospitalValue";

const SUPPORTED_ROLES = new Set(["MR", "ASM", "SM", "NSM"]);

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  let forcedNip: string | null = null;

  if (session) {
    if (session.role !== "NSM" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Hanya NSM atau Admin yang bisa mengakses target value." }, { status: 403 });
    }
    if (session.role === "NSM") forcedNip = session.userId;
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
  const nip = forcedNip ?? req.nextUrl.searchParams.get("nip")?.trim();
  const breakdown = req.nextUrl.searchParams.has("breakdown");
  const namaGT = req.nextUrl.searchParams.get("namaGT")?.trim();
  const divisi = req.nextUrl.searchParams.get("divisi")?.trim().toLowerCase() || "hospital";

  if (divisi !== "hospital" && divisi !== "non-hospital") {
    return NextResponse.json({ error: 'divisi harus "hospital" atau "non-hospital".' }, { status: 400 });
  }

  if (divisi === "non-hospital") {
    const kategori = req.nextUrl.searchParams.get("kategori")?.trim().toUpperCase() || undefined;

    if (nip) {
      const person = await prisma.user.findUnique({ where: { nip }, select: { nip: true, name: true, role: true, project: true } });
      if (!person) return NextResponse.json({ error: "NIP tidak ditemukan." }, { status: 404 });
      if (!SUPPORTED_ROLES.has(person.role)) return NextResponse.json({ error: `Role ${person.role} tidak didukung untuk target value.` }, { status: 400 });

      const mrNips = await resolveOmegaMrNipsForOwner(person as User);
      const gts = await getCurrentGTsForOmegaMrNips(mrNips);

      if (breakdown) {
        const rows = await getTargetNonHospitalValueRowsForGTs(gts, { periode, divisi: kategori });
        const projectByNip = await getUserProjectByNip(rows.map((r) => r.nipMR).filter((n): n is string => !!n));
        // Only true OMEGA members — drop a row whose nipMR resolved to a
        // real User but that User's CURRENT project isn't OMEGA (drifted
        // since import; see getUserProjectByNip's doc comment). A null
        // nipMR (vacant territory, never resolved) is kept as-is.
        return NextResponse.json(
          rows
            .filter((r) => !r.nipMR || projectByNip.get(r.nipMR) === "OMEGA")
            .map((r) => ({
              namaGT: r.namaGT,
              divisi: "non-hospital",
              kategori: r.divisi, // r's OWN divisi (RETAIL/GROSIR_PBF) — NOT the hospital/non-hospital tag above
              nipMR: r.nipMR,
              namaMR: r.namaMR,
              project: r.nipMR ? projectByNip.get(r.nipMR) ?? null : null,
              target: r.target,
              periode: r.periode,
            }))
        );
      }

      const summed = await sumTargetNonHospitalValueForGTs(gts, { periode, divisi: kategori });
      // `project` here is POA's own source of truth for OMEGA/non-hospital
      // membership (synced from Nexus, see getUserProjectByNip's doc
      // comment) — NOT derived from mkt_insight.Struktur_Marketing_PI's
      // `Divisi` column, which is a separate pipeline and can lag behind
      // during a KAM1->OMEGA migration.
      return NextResponse.json(summed.map((s) => ({
        nip: person.nip,
        nama: person.name,
        jabatan: person.role,
        divisi: "non-hospital",
        project: person.project,
        target: s.target,
        periode: s.periode,
      })));
    }

    if (namaGT) {
      const rows = await getTargetNonHospitalValueRowsForGTs([namaGT], { periode, divisi: kategori });
      const projectByNip = await getUserProjectByNip(rows.map((r) => r.nipMR).filter((n): n is string => !!n));
      // Same OMEGA-only filter as the breakdown branch above.
      return NextResponse.json(
        rows
          .filter((r) => !r.nipMR || projectByNip.get(r.nipMR) === "OMEGA")
          .map((r) => ({
            namaGT: r.namaGT,
            divisi: "non-hospital",
            kategori: r.divisi, // r's OWN divisi (RETAIL/GROSIR_PBF) — NOT the hospital/non-hospital tag above
            nipMR: r.nipMR,
            namaMR: r.namaMR,
            project: r.nipMR ? projectByNip.get(r.nipMR) ?? null : null,
            target: r.target,
            periode: r.periode,
          }))
      );
    }

    const where: Record<string, unknown> = {};
    if (periode) where.periode = periode;
    if (kategori) where.divisi = kategori;

    const rows = await prisma.targetNonHospitalValue.findMany({
      where,
      select: { namaGT: true, divisi: true, nipMR: true, namaMR: true, target: true, periode: true },
      orderBy: [{ periode: "asc" }, { namaGT: "asc" }],
    });
    const projectByNip = await getUserProjectByNip(rows.map((r: (typeof rows)[number]) => r.nipMR).filter((n: string | null): n is string => !!n));

    return NextResponse.json(
      rows
        // Only true OMEGA members — drop a row whose nipMR resolved to a
        // real User but that User's CURRENT project isn't OMEGA (drifted
        // since import; see getUserProjectByNip's doc comment). A null
        // nipMR (vacant territory, never resolved) is kept as-is.
        .filter((r: (typeof rows)[number]) => !r.nipMR || projectByNip.get(r.nipMR) === "OMEGA")
        .map((r: (typeof rows)[number]) => ({
          namaGT: r.namaGT,
          divisi: "non-hospital",
          kategori: r.divisi,
          nipMR: r.nipMR,
          namaMR: r.namaMR,
          // POA's own OMEGA/non-hospital source-of-truth signal for this
          // nipMR — see getUserProjectByNip's doc comment. Not from
          // mkt_insight.Struktur_Marketing_PI (separate pipeline, can lag
          // behind during a KAM1->OMEGA migration).
          project: r.nipMR ? projectByNip.get(r.nipMR) ?? null : null,
          target: parseFloat(r.target.toString()),
          periode: r.periode,
        }))
    );
  }

  if (nip) {
    const person = await prisma.user.findUnique({ where: { nip }, select: { nip: true, name: true, role: true } });
    if (!person) return NextResponse.json({ error: "NIP tidak ditemukan." }, { status: 404 });
    if (!SUPPORTED_ROLES.has(person.role)) return NextResponse.json({ error: `Role ${person.role} tidak didukung untuk target value.` }, { status: 400 });

    const mrNips = person.role === "MR" ? [person.nip] : await getSubordinateMRNips(person as User);
    const gts = await getCurrentGTsForMrNips(mrNips, periode);

    // ?breakdown=1 (or any value): per-GT rows under this nip's subtree
    // instead of one summed total per periode (2026-09-03) — same
    // {namaGT,nipMR,namaMR,target,periode} shape as "get target all" below,
    // just scoped to `gts`.
    if (breakdown) {
      const rows = await getTargetHospitalValueRowsForGTs(gts, periode);
      return NextResponse.json(rows.map((r) => ({ ...r, divisi: "hospital" })));
    }

    const summed = await sumTargetHospitalValueForGTs(gts, periode);
    return NextResponse.json(summed.map((s) => ({
      nip: person.nip,
      nama: person.name,
      jabatan: person.role,
      divisi: "hospital",
      target: s.target,
      periode: s.periode,
    })));
  }

  if (namaGT) {
    const rows = await getTargetHospitalValueRowsForGTs([namaGT], periode);
    return NextResponse.json(rows.map((r) => ({ ...r, divisi: "hospital" })));
  }

  // No nip, no namaGT: one row per GT per periode — namaGT+periode is
  // already unique (schema.prisma), so no aggregation needed.
  const where: Record<string, unknown> = {};
  if (periode) where.periode = periode;

  const rows = await prisma.targetHospitalValue.findMany({
    where,
    select: { namaGT: true, nipMR: true, namaMR: true, target: true, periode: true },
    orderBy: [{ periode: "asc" }, { namaGT: "asc" }],
  });

  return NextResponse.json(
    rows.map((r: (typeof rows)[number]) => ({
      namaGT: r.namaGT,
      divisi: "hospital",
      nipMR: r.nipMR,
      namaMR: r.namaMR,
      target: parseFloat(r.target.toString()),
      periode: r.periode,
    }))
  );
}
