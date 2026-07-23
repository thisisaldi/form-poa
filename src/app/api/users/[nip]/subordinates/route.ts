/**
 * GET /api/users/[nip]/subordinates
 *
 * Every user (any depth — MR under an ASM under an SM, etc.) who ultimately
 * reports up to the given NIP, walked via User.nipAtasan. Flat list, each
 * entry carries its own direct nipAtasan so the caller can reconstruct the
 * tree if needed. Inactive users are included (flagged via isActive) rather
 * than silently dropped.
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

  const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true, name: true, role: true } });
  if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });

  const subordinates: { nip: string; name: string; role: string; jabatan: string | null; nipAtasan: string | null; isActive: boolean }[] = [];
  let frontier = [nip];
  const seen = new Set<string>([nip]);

  // Org depth is known to be at most ~4 hops (MR→ASM→SM→NSM→GM) — 10 is a
  // generous ceiling that still guards against an accidental nipAtasan cycle.
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const reports = await prisma.user.findMany({
      where: { nipAtasan: { in: frontier } },
      select: { nip: true, name: true, role: true, jabatan: true, nipAtasan: true, isActive: true },
    });
    frontier = [];
    for (const r of reports) {
      if (seen.has(r.nip)) continue; // guard against a cycle
      seen.add(r.nip);
      subordinates.push(r);
      frontier.push(r.nip);
    }
  }

  return NextResponse.json({
    nip: user.nip,
    name: user.name,
    role: user.role,
    subordinates,
  });
}
