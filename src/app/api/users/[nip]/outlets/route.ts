/**
 * GET /api/users/[nip]/outlets
 *
 * Outlets a given NIP (MR, or ASM/SM/NSM covering vacant outlets down their
 * chain) can act on right now — same resolution getOutletsByUser() already
 * does for the in-app outlet picker (MrOutletAssignment for MR, plus
 * Outlet.coveredByNip/coveredByRole fallback for ASM/SM/NSM; isDummy accounts
 * get every outlet), exposed here as a plain HTTP endpoint.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getOutletsByUser } from "@/lib/masterData";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ nip: string }> }
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nip } = await params;

  const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true } });
  if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });

  const outlets = await getOutletsByUser(nip);
  const result = outlets.map((o) => ({
    kodePI: o.kodePI,
    namaOutlet: o.namaOutlet,
    groupRS: o.groupRS,
    sector: o.role,
    subSektor: o.spesialisasi,
  }));

  return NextResponse.json(result);
}
