/**
 * POST /api/sync/org-structure
 *
 * Trigger the MSSQL → PostgreSQL org sync externally (e.g. from a cron service).
 * Secured by a shared secret header: X-Sync-Secret must match env SYNC_SECRET.
 *
 * TODO: Add SYNC_SECRET to env schema (lib/env.ts) when ready to lock down.
 */

import { NextRequest, NextResponse } from "next/server";
import { runOrgSync } from "@/lib/sync/orgStructureSync";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-sync-secret");
  if (
    process.env.SYNC_SECRET &&
    secret !== process.env.SYNC_SECRET
  ) {
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
    const result = await runOrgSync(connectionString);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync] org-structure failed:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
