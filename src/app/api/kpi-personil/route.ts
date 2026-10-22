/**
 * GET /api/kpi-personil?scheme=hospital|non-hospital[&period=YYYY-MM][&nip=…][&breakdown=1]
 *
 * Detail KPI (halaman /kpi-detail) sebagai JSON. Tanpa `nip` = daftar bawahan
 * satu bulan (getKpiSubordinates, `page`/`limit` default 50 max 500); dengan `nip` = kartu detail satu personil,
 * window 6 bulan (getKpiPersonDetail). `breakdown=1` (Hospital saja) menambah
 * rincian per outlet/MR/absensi harian (getHospitalBreakdown — memanggil SIPP,
 * lebih lambat, makanya opt-in). Akses = akses halaman (atasan / ADMIN / SD).
 * Auth: session cookie atau Basic Auth Exodus (src/lib/kpiApiAuth.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { getHospitalBreakdown, getKpiPersonDetail, getKpiSubordinates, lastCompletedPeriod, type KpiScheme } from "@/app/actions/kpiDetail";
import { withKpiViewer } from "@/lib/kpiApiAuth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function GET(req: NextRequest) {
  return withKpiViewer(req, () => handle(req));
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scheme: KpiScheme = sp.get("scheme") === "non-hospital" ? "non-hospital" : "hospital";
  const nip = sp.get("nip")?.trim();

  if (!nip) {
    const period = sp.get("period")?.trim() || (await lastCompletedPeriod());
    const page = Number(sp.get("page") ?? 1);
    const limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
    if (!Number.isInteger(page) || page < 1) return NextResponse.json({ error: "page harus integer >= 1." }, { status: 400 });
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return NextResponse.json({ error: `limit harus integer 1-${MAX_LIMIT}.` }, { status: 400 });
    const all = await getKpiSubordinates(scheme, period);
    const rows = all.slice((page - 1) * limit, page * limit);
    return NextResponse.json({ scheme, period, page, limit, total: all.length, count: rows.length, rows });
  }

  const [detail, breakdown] = await Promise.all([
    getKpiPersonDetail(scheme, nip),
    scheme === "hospital" && sp.get("breakdown") === "1" ? getHospitalBreakdown(nip) : null,
  ]);
  if (!detail) return NextResponse.json({ error: "Tidak ditemukan atau di luar lingkup Anda" }, { status: 404 });
  return NextResponse.json({ ...detail, breakdown });
}
