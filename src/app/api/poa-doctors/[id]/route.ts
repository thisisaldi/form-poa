/**
 * GET /api/poa-doctors/[id]
 *
 * Detail for a single doctor row — same shape as one entry of
 * GET /api/poa-doctors, looked up directly by `uidCustomer` (the anchor
 * PoaLineItem.id from that list's response) instead of listing by NIP.
 * `id` alone is enough to resolve the row: PoaLineItem.id is globally
 * unique, so there's no need for the caller to also pass a draft/PoaForm id.
 *
 * Same CURRENT-quarter scoping as the list endpoint (PoaForm.period vs
 * currentQuarter()) — a stale id from a past quarter 404s, same as it
 * would simply be absent from the list. Same for a doctor that hasn't
 * been approved yet (see buildDoctorRows in poaDoctorsRows.ts): the list
 * endpoint drops those rows entirely, so this 404s too rather than
 * exposing them a different way.
 *
 * PATCH /api/poa-doctors/[id]
 *
 * Sets usedInExodus (docs/exodus-poa-usage/). Body is OPTIONAL:
 *   - no body / `{}` / `{ "usedInExodus": true }` → mark as used (the
 *     original 2026-08-26 behavior, kept bodyless-compatible)
 *   - `{ "usedInExodus": false }` → revert back to unused (2026-08-27 —
 *     Aldi confirmed Exodus needs a revert path after all, REVERSING the
 *     original "no revert" business rule from the 2026-08-24 WhatsApp
 *     thread; see docs/exodus-poa-usage/01-business-rules.md §2/§8.
 *     Originally shipped as a separate DELETE, collapsed into this single
 *     PATCH same day per Aldi's preference — one endpoint, direction
 *     carried by the body instead of the HTTP method.)
 * Idempotent either direction — setting to the value it already has is a
 * no-op 200, not an error (safe to retry). usedInExodusAt is set to now()
 * when turning on, cleared to null when turning off (full revert, not an
 * audit trail).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findDoctorRowById, isAuthorizedPoaDoctorsRequest } from "@/lib/poaDoctorsRows";

async function requireAuth(req: NextRequest) {
  if (await isAuthorizedPoaDoctorsRequest(req)) return null;
  return NextResponse.json({ error: "Unauthorized" }, {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="poa-doctors"' },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const row = await findDoctorRowById(id);
  if (!row) return NextResponse.json({ error: "Baris tidak ditemukan." }, { status: 404 });

  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const row = await findDoctorRowById(id);
  if (!row) return NextResponse.json({ error: "Baris tidak ditemukan." }, { status: 404 });

  // Body is optional — a missing/empty/unparseable body defaults to "mark as
  // used" (true), same as the original bodyless PATCH contract.
  const body: { usedInExodus?: unknown } = await req.json().catch(() => ({}));
  const targetUsed = body.usedInExodus === false ? false : true;

  if (row.usedInExodus !== targetUsed) {
    await prisma.poaDoctorApproval.update({
      where: {
        poaId_kodePI_namaCust: { poaId: row.uidPoa, kodePI: row.dokter.kodePI ?? "", namaCust: row.dokter.namaCust },
      },
      data: { usedInExodus: targetUsed, usedInExodusAt: targetUsed ? new Date() : null },
    });
  }

  return NextResponse.json({ ...row, usedInExodus: targetUsed });
}
