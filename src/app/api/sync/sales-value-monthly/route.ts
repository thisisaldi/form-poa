/**
 * POST /api/sync/sales-value-monthly
 *
 * Syncs outlet-level monthly Rupiah sales value from mkt_insight.dbo.DIR10001B
 * into OutletSalesValueMonthly (full previous year through the current year's
 * last completed month). Secured by X-Sync-Secret header.
 */

import { NextRequest, NextResponse } from "next/server";
import { runOutletSalesValueMonthlySync } from "@/lib/sync/outletSalesValueMonthlySync";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-sync-secret");
  if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectionString = process.env.MSSQL_CONNECTION_STRING;
  if (!connectionString) {
    return NextResponse.json(
      { error: "MSSQL_CONNECTION_STRING not configured" },
      { status: 500 }
    );
  }

  try {
    const result = await runOutletSalesValueMonthlySync(connectionString);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync] sales-value-monthly failed:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
