/**
 * Auth for the read-only KPI API routes Exodus displays (/api/kpi-leaderboard,
 * /api/kpi-personil, /api/kpi-perpanjangan): session cookie as usual, OR HTTP
 * Basic Auth against the same admin-managed PoaDoctorsApiCredential row
 * /api/poa-doctors and /api/target-value use.
 *
 * Basic Auth + `?asNip=` = act as that user — the KPI actions then apply
 * exactly the scope that user gets in-app (getCurrentUser returns them via
 * runAsViewer). Basic Auth without `asNip` = ADMIN-wide, same as the other
 * Basic Auth routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { getCurrentUser, runAsViewer, type SessionData } from "@/lib/session";

export async function withKpiViewer(req: NextRequest, fn: () => Promise<Response>): Promise<Response> {
  if (await getCurrentUser()) return run(fn);

  const credential = await prisma.poaDoctorsApiCredential.findUnique({ where: { id: 1 } });
  if (!verifyBasicAuth(req, credential)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="kpi"' } });
  }

  const asNip = req.nextUrl.searchParams.get("asNip")?.trim();
  let viewer: SessionData = { userId: "", nip: "", name: "Exodus API", role: "ADMIN", isLoggedIn: true };
  if (asNip) {
    const u = await prisma.user.findUnique({ where: { nip: asNip }, select: { nip: true, name: true, role: true, jabatan: true, project: true } });
    if (!u) return NextResponse.json({ error: "asNip tidak ditemukan." }, { status: 404 });
    viewer = { userId: u.nip, nip: u.nip, name: u.name, role: u.role, jabatan: u.jabatan, project: u.project, isLoggedIn: true };
  }
  return runAsViewer(viewer, () => run(fn));
}

// KPI actions throw plain Errors for access/validation ("Unauthorized", "Periode tidak valid", "... hanya untuk ...").
async function run(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const status = /Unauthorized/.test(msg) ? 401 : /tidak valid/i.test(msg) ? 400 : /hanya|akses/i.test(msg) ? 403 : 500;
    if (status === 500) console.error("[kpi-api]", e);
    return NextResponse.json({ error: status === 500 ? "Gagal memuat data KPI" : msg }, { status });
  }
}
