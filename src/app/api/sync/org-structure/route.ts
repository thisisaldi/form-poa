/**
 * POST /api/sync/org-structure
 *
 * Trigger the Nexus → PostgreSQL org sync externally (e.g. from a cron service).
 * Secured by a shared secret header: X-Sync-Secret must match env SYNC_SECRET.
 * Cutover 2026-08-20 (docs/org-nexus-migration/) — no longer needs
 * MSSQL_CONNECTION_STRING; Nexus auth is handled by nexusAuthHeaders().
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

  try {
    const result = await runOrgSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync] org-structure failed:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
