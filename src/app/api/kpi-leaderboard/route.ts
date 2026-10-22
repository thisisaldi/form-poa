/**
 * GET /api/kpi-leaderboard?scheme=hospital|non-hospital&period=YYYY-MM
 *
 * Leaderboard KPI Personil — payload yang sama dengan halaman /kpi-leaderboard
 * (getKpiLeaderboard): company-wide, point saja, untuk semua role login.
 * Auth: session cookie atau Basic Auth Exodus (src/lib/kpiApiAuth.ts).
 * `period` default = bulan terakhir yang sudah selesai (sama dengan halaman).
 * `rank` = posisi setelah urut point tertinggi (dihitung sebelum filter `nip`
 * dan pagination, jadi `?nip=` = "rank saya").
 */
import { NextRequest, NextResponse } from "next/server";
import { getKpiLeaderboard } from "@/app/actions/kpi";
import { lastCompletedPeriod } from "@/app/actions/kpiDetail";
import { withKpiViewer } from "@/lib/kpiApiAuth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function GET(req: NextRequest) {
  return withKpiViewer(req, () => handle(req));
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scheme = sp.get("scheme") === "non-hospital" ? "non-hospital" : "hospital";
  const period = sp.get("period")?.trim() || (await lastCompletedPeriod());
  const nips = sp.get("nip")?.split(",").map((n) => n.trim()).filter(Boolean);
  const page = Number(sp.get("page") ?? 1);
  const limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isInteger(page) || page < 1) return NextResponse.json({ error: "page harus integer >= 1." }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return NextResponse.json({ error: `limit harus integer 1-${MAX_LIMIT}.` }, { status: 400 });

  const { rows, unscored } = await getKpiLeaderboard(scheme, period);
  const ranked = rows.map((r, i) => ({ rank: i + 1, ...r }));
  const filtered = nips?.length ? ranked.filter((r) => nips.includes(r.nip)) : ranked;
  const out = filtered.slice((page - 1) * limit, page * limit);
  return NextResponse.json({ scheme, period, page, limit, total: filtered.length, ranked: rows.length, unscored, count: out.length, rows: out });
}
