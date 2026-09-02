/**
 * GET /api/target-value
 *
 * Monthly Rupiah sales target from TargetHospitalValue.
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
 * Two credential paths, same pattern as /api/poa-doctors (2026-08-19): the
 * app's own browser calls carry a session cookie; an external app
 * authenticates with HTTP Basic Auth instead, checked against the SAME
 * admin-managed PoaDoctorsApiCredential row /api/poa-doctors uses (no
 * separate credential for this endpoint). A session NSM is always forced to
 * their own nip (any `?nip=` they pass is ignored) — same subtree-only
 * access the admin Target Value page's searchTargetHospitalValueAction
 * enforces; Basic Auth and ADMIN sessions can query any nip.
 */

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { getSubordinateMRNips } from "@/lib/authz";
import { getCurrentGTsForMrNips } from "@/lib/targetHospitalValue";

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

  if (nip) {
    const person = await prisma.user.findUnique({ where: { nip }, select: { nip: true, name: true, role: true } });
    if (!person) return NextResponse.json({ error: "NIP tidak ditemukan." }, { status: 404 });
    if (!SUPPORTED_ROLES.has(person.role)) return NextResponse.json({ error: `Role ${person.role} tidak didukung untuk target value.` }, { status: 400 });

    const mrNips = person.role === "MR" ? [person.nip] : await getSubordinateMRNips(person as User);
    const gts = await getCurrentGTsForMrNips(mrNips);

    const where: Record<string, unknown> = { namaGT: { in: gts } };
    if (periode) where.periode = periode;

    const grouped = gts.length > 0
      ? await prisma.targetHospitalValue.groupBy({
          by: ["periode"],
          where,
          _sum: { target: true },
          orderBy: { periode: "asc" },
        })
      : [];

    return NextResponse.json(grouped.map((g: (typeof grouped)[number]) => ({
      nip: person.nip,
      nama: person.name,
      jabatan: person.role,
      target: parseFloat((g._sum.target ?? 0).toString()),
      periode: g.periode,
    })));
  }

  // No nip: one row per GT per periode — namaGT+periode is already unique
  // (schema.prisma), so no aggregation needed.
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
      nipMR: r.nipMR,
      namaMR: r.namaMR,
      target: parseFloat(r.target.toString()),
      periode: r.periode,
    }))
  );
}
