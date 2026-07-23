/**
 * GET /api/users/[nip]/superiors
 *
 * The given NIP's chain of command, walked via User.nipAtasan from their
 * direct manager up to the top (GM, or wherever the chain ends — e.g. a
 * skip-level link straight to SM/NSM when an intermediate role is vacant,
 * see scripts/importStrukturHospital.ts). Ordered nearest-first.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ nip: string }> }
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nip } = await params;

  const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true, name: true, role: true, nipAtasan: true } });
  if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });

  const superiors: { nip: string; name: string; role: string; jabatan: string | null; isActive: boolean }[] = [];
  const seen = new Set<string>([nip]);
  let currentNip = user.nipAtasan;

  // Same depth ceiling as /subordinates — guards against a nipAtasan cycle.
  for (let depth = 0; depth < 10 && currentNip; depth++) {
    if (seen.has(currentNip)) break;
    const atasan = await prisma.user.findUnique({
      where: { nip: currentNip },
      select: { nip: true, name: true, role: true, jabatan: true, nipAtasan: true, isActive: true },
    });
    if (!atasan) break;
    seen.add(atasan.nip);
    superiors.push(atasan);
    currentNip = atasan.nipAtasan;
  }

  return NextResponse.json({
    nip: user.nip,
    name: user.name,
    role: user.role,
    superiors,
  });
}
