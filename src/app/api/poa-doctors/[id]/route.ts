/**
 * GET /api/poa-doctors/[id]
 *
 * Detail for a single doctor row — same shape as one entry of
 * GET /api/poa-doctors, looked up directly by `uidCustomer` (the anchor
 * PoaLineItem.id from that list's response) instead of listing by NIP.
 * `id` alone is enough to resolve the row: PoaLineItem.id is globally
 * unique, so there's no need for the caller to also pass uidPoa.
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
 * Exodus "mark as used" call (docs/exodus-poa-usage/) — sets usedInExodus
 * to true, permanently. No body needed: this is a one-way action, not a
 * general field update, so there's nothing to pass other than the id
 * already in the path. Idempotent — calling it again on an
 * already-used row is a no-op 200, not an error (safe to retry).
 * There's no way to un-mark a row (see docs/exodus-poa-usage/01-business-rules.md
 * §2 — a reject on the Exodus side does NOT revert this flag).
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

  if (!row.usedInExodus) {
    await prisma.poaDoctorApproval.update({
      where: {
        poaId_kodePI_namaCust: { poaId: row.uidPoa, kodePI: row.dokter.kodePI ?? "", namaCust: row.dokter.namaCust },
      },
      data: { usedInExodus: true, usedInExodusAt: new Date() },
    });
  }

  return NextResponse.json({ ...row, usedInExodus: true });
}
