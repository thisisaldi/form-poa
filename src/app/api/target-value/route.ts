/**
 * GET /api/target-value
 *
 * Per-person monthly Rupiah sales target, rolled up from TargetHospitalValue
 * (target Rupiah bulanan per GT). `target` for an ASM/SM/NSM is the SUM of
 * every GT-level target beneath that nip (2026-08-24, replacing an earlier
 * version that returned raw per-GT rows — a GT is an implementation detail
 * this endpoint's consumers don't need, and an NSM/SM/ASM can own many GTs,
 * so raw rows meant one entry per GT repeating the same person's identity
 * over and over instead of one summed total per periode).
 *
 * `?nip=` (optional) determines whose rollup to return — that nip's OWN
 * `User.role` decides which TargetHospitalValue column to sum against
 * (MR -> nipMR, ASM -> nipASM, SM -> nipSM, NSM -> nipNSM); role must be one
 * of those four. Omitted = "get target all": the finest-grained MR-level
 * breakdown for everyone (one row per (nipMR, periode), jabatan always
 * "MR") — rows whose nipMR never resolved to a real User (see the import
 * scripts' name-resolution notes) are excluded, since this shape has no
 * place to keep an un-resolved raw name.
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
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";

const LEVEL_COLUMN: Record<string, "nipMR" | "nipASM" | "nipSM" | "nipNSM"> = {
  MR: "nipMR", ASM: "nipASM", SM: "nipSM", NSM: "nipNSM",
};

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
    const column = LEVEL_COLUMN[person.role];
    if (!column) return NextResponse.json({ error: `Role ${person.role} tidak didukung untuk target value.` }, { status: 400 });

    const where: Record<string, unknown> = { [column]: nip };
    if (periode) where.periode = periode;

    const grouped = await prisma.targetHospitalValue.groupBy({
      by: ["periode"],
      where,
      _sum: { target: true },
      orderBy: { periode: "asc" },
    });

    return NextResponse.json(grouped.map((g: (typeof grouped)[number]) => ({
      nip: person.nip,
      nama: person.name,
      jabatan: person.role,
      target: parseFloat((g._sum.target ?? 0).toString()),
      periode: g.periode,
    })));
  }

  // No nip: finest-grained MR-level breakdown across everyone in scope.
  const where: Record<string, unknown> = { nipMR: { not: null } };
  if (periode) where.periode = periode;

  const grouped = await prisma.targetHospitalValue.groupBy({
    by: ["nipMR", "periode"],
    where,
    _sum: { target: true },
    orderBy: [{ periode: "asc" }, { nipMR: "asc" }],
  });

  const nips = [...new Set(grouped.map((g: (typeof grouped)[number]) => g.nipMR).filter((n: string | null): n is string => n != null))];
  const users = await prisma.user.findMany({ where: { nip: { in: nips } }, select: { nip: true, name: true } });
  const nameByNip = new Map(users.map((u: (typeof users)[number]) => [u.nip, u.name]));

  return NextResponse.json(
    grouped
      .filter((g: (typeof grouped)[number]) => g.nipMR != null)
      .map((g: (typeof grouped)[number]) => ({
        nip: g.nipMR,
        nama: nameByNip.get(g.nipMR!) ?? "",
        jabatan: "MR",
        target: parseFloat((g._sum.target ?? 0).toString()),
        periode: g.periode,
      }))
  );
}
