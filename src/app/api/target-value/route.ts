/**
 * GET /api/target-value
 *
 * Raw TargetHospitalValue rows (monthly Rupiah sales target per GT) — same
 * data the admin "Target Value" page (admin/target-value/page.tsx) edits,
 * just read-only and not paginated/searched through a client component. No
 * query params returns every row in scope ("get target all"); `?nip=` narrows
 * to rows where that nip appears at ANY level (nipMR OR nipASM OR nipSM OR
 * nipNSM) — symmetric with `q`'s name search across all 4 levels below.
 *
 * Two credential paths, same pattern as /api/poa-doctors (2026-08-19): the
 * app's own browser calls carry a session cookie; an external app
 * authenticates with HTTP Basic Auth instead, checked against the SAME
 * admin-managed PoaDoctorsApiCredential row /api/poa-doctors uses (no
 * separate credential for this endpoint — reuse, not a new secret to
 * rotate). Session callers get the SAME NSM-subtree scoping the admin page's
 * searchTargetHospitalValueAction enforces (NSM sees only nipNSM = their own
 * nip, ADMIN sees everything, any other role is 403); Basic Auth is treated
 * as trusted/full access, same as /api/poa-doctors.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  let scopeToOwnNip: string | null = null;

  if (session) {
    if (session.role !== "NSM" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Hanya NSM atau Admin yang bisa mengakses target value." }, { status: 403 });
    }
    if (session.role === "NSM") scopeToOwnNip = session.userId;
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
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const nip = req.nextUrl.searchParams.get("nip")?.trim();

  // `q` and `nip` each contribute their own OR-clause (name-match, nip-match)
  // — combined via AND so both can be supplied together instead of one
  // silently overwriting the other's `where.OR`.
  const and: Record<string, unknown>[] = [];
  if (periode) and.push({ periode });
  if (scopeToOwnNip) and.push({ nipNSM: scopeToOwnNip });
  if (q) {
    and.push({
      OR: [
        { namaGT: { contains: q, mode: "insensitive" } },
        { namaMR: { contains: q, mode: "insensitive" } },
        { namaASM: { contains: q, mode: "insensitive" } },
        { namaSM: { contains: q, mode: "insensitive" } },
        { namaNSM: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (nip) {
    and.push({ OR: [{ nipMR: nip }, { nipASM: nip }, { nipSM: nip }, { nipNSM: nip }] });
  }
  const where: Record<string, unknown> = and.length > 0 ? { AND: and } : {};

  const rows = await prisma.targetHospitalValue.findMany({
    where,
    orderBy: [{ namaGT: "asc" }, { periode: "asc" }],
    select: {
      namaGT: true, periode: true, target: true,
      nipMR: true, namaMR: true,
      nipASM: true, namaASM: true,
      nipSM: true, namaSM: true,
      nipNSM: true, namaNSM: true,
    },
  });

  return NextResponse.json(rows.map((r: (typeof rows)[number]) => ({ ...r, target: parseFloat(r.target.toString()) })));
}
