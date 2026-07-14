/**
 * POST /api/sync/sales-history
 *
 * Syncs outlet sales history from mkt_insight.dbo.DIR10001B into
 * OutletSalesHistory table (last 12 completed months, per kodePI × itemKode).
 * Secured by X-Sync-Secret header.
 */

import { NextRequest, NextResponse } from "next/server";
import { runSalesHistorySync } from "@/lib/sync/salesHistorySync";

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
    const result = await runSalesHistorySync(connectionString);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync] sales-history failed:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
