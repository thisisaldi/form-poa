/**
 * POST /api/sync/outlet
 *
 * Trigger the Nexus → PostgreSQL outlet + MR-outlet assignment sync externally
 * (e.g. from a cron service). Secured by a shared secret header: X-Sync-Secret
 * must match env SYNC_SECRET. Mirrors /api/sync/org-structure — same pattern.
 *
 * docs/outlet-nexus-migration/ shipped runOutletSync() with NO route (OQ-5,
 * deliberately deferred) — only triggerable via `npx tsx scripts/syncOrg.ts`
 * run by hand. With no recurring trigger, outlet→MR mappings silently go
 * stale the moment Nexus's own data changes (2026-08-21 bug report: outlet
 * F4002393 mapped to the wrong MR in production — confirmed live against
 * Nexus that its current data had already moved on, our DB just hadn't been
 * re-synced since the last manual run). This route closes that gap so a cron
 * can keep it fresh the same way org-structure/sales-history already are.
 *
 * Run order matters (per scripts/syncOrg.ts): org-structure must run first —
 * outlet sync reads its NIP list from `User`.
 */

import { NextRequest, NextResponse } from "next/server";
import { runOutletSync } from "@/lib/sync/outletSync";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-sync-secret");
  if (
    process.env.SYNC_SECRET &&
    secret !== process.env.SYNC_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runOutletSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync] outlet failed:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
