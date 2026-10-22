/**
 * GET /api/kpi-perpanjangan?period=YYYY-MM
 *
 * Scorecard KPI Perpanjangan (Hospital) — payload yang sama persis dengan
 * tabel di halaman /kpi-perpanjangan (getKpiMonitoringData). Session cookie
 * atau Basic Auth Exodus (src/lib/kpiApiAuth.ts, opsional `?asNip=`); scope mengikuti role: ADMIN = semua personil, MR/ASM/SM/NSM = diri
 * sendiri + bawahan. Read-only — edit/sync tetap lewat Server Action ADMIN.
 *
 * `?divisi=hospital` (default) | `non-hospital` (OMEGA — semua MR/ASM/SM aktif,
 * tanpa syarat kontrak; ADMIN-only untuk saat ini). Param lain sama.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { withKpiViewer } from "@/lib/kpiApiAuth";
import { getKpiMonitoringData } from "@/app/actions/kpi";
import { getNonHospitalMonitoring } from "@/app/actions/nonHospitalEvaluation";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VIEWER_ROLES =["ADMIN", "MR", "ASM", "SM", "NSM"];

export function GET(req: NextRequest) {
  return withKpiViewer(req, () => handle(req));
}

async function handle(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!VIEWER_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Role ini tidak punya akses KPI Perpanjangan." }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get("period")?.trim() ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return NextResponse.json({ error: "period wajib, format YYYY-MM." }, { status: 400 });
  }

  const divisi = req.nextUrl.searchParams.get("divisi")?.trim().toLowerCase() || "hospital";
  if (divisi !== "hospital" && divisi !== "non-hospital") {
    return NextResponse.json({ error: 'divisi harus "hospital" atau "non-hospital".' }, { status: 400 });
  }
  if (divisi === "non-hospital" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "KPI Non-Hospital hanya untuk Admin." }, { status: 403 });
  }

  const nips = req.nextUrl.searchParams.get("nip")?.split(",").map((n) => n.trim()).filter(Boolean);

  const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "page harus integer >= 1." }, { status: 400 });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json({ error: `limit harus integer 1-${MAX_LIMIT}.` }, { status: 400 });
  }

  const filter = nips?.length ? { nips } : undefined;
  const all = divisi === "non-hospital" ? await getNonHospitalMonitoring(period, filter) : await getKpiMonitoringData(period, filter);
  // ponytail: slice after scoring — sort is by computed totalScore and ASM/SM depend on their team, so can't push down to DB.
  const rows = all.slice((page - 1) * limit, page * limit);
  return NextResponse.json({ divisi, period, page, limit, total: all.length, count: rows.length, rows });
}
