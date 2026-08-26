/**
 * GET /api/poa-doctors?nip=...&keyword=...
 *
 * List of doctors (1 row per (kodePI, namaCust) pair, same doctorKey grouping
 * as DraftChecklist.tsx / PoaDoctorApproval) across the given NIP's PoaForm(s)
 * in the CURRENT calendar quarter (PoaForm.period, format "YYYY-QN" — see
 * currentQuarter()). One NIP normally has at most one PoaForm per quarter
 * (poa.ts's createPoaDraft duplicate-guard), but this returns an array in
 * case that ever changes.
 *
 * `nip` as a query param (not a /[nip]/ path segment) — this is a read-only
 * lookup, GET is the correct method, and a query param keeps it off the URL
 * path while staying valid for GET (unlike a JSON body).
 *
 * docs/exodus-poa-usage/ (2026-08-27 revision) — `keyword` narrows within
 * that NIP's own rows (NOT a company-wide search, confirmed out of scope —
 * see docs/PERFORMANCE.md), and only fully (NSM) approved + not-yet-used-in-
 * Exodus doctors are returned (buildDoctorRows already drops non-NSM rows;
 * this route additionally drops usedInExodus ones — kept out of the shared
 * helper so GET/PATCH /api/poa-doctors/[id] can still resolve an
 * already-used row, see poaDoctorsRows.ts).
 *
 * Row-building logic shared with GET /api/poa-doctors/[id] (detail by
 * uidCustomer) lives in src/lib/poaDoctorsRows.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { getActivePsspByOutlets } from "@/app/actions/customer";
import {
  poaDoctorRowsSelect,
  buildDoctorRows,
  getProductMasterByKodeProduk,
  isAuthorizedPoaDoctorsRequest,
  type PoaWithDoctorRows,
} from "@/lib/poaDoctorsRows";

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedPoaDoctorsRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="poa-doctors"' },
    });
  }

  const nip = req.nextUrl.searchParams.get("nip")?.trim();
  if (!nip) return NextResponse.json({ error: "NIP wajib diisi." }, { status: 400 });
  const keyword = req.nextUrl.searchParams.get("keyword")?.trim().toLowerCase() || null;

  const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true } });
  if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });

  const quarter = currentQuarter();
  const quarterMonths = quarterToMonths(quarter);

  const poas: PoaWithDoctorRows[] = await prisma.poaForm.findMany({
    where: { ownerId: nip, period: quarter },
    select: poaDoctorRowsSelect,
  });

  // Estimasi Aktif per dokter (PSSP contract yang masih berjalan, terpisah
  // dari estimasi rencana di atas yang bersumber dari PoaLineItem) — sama
  // sumber & cara tercacah-nya dengan doctorPsspInfo di poa/[id]/page.tsx
  // (docs/TODO.md #17, 2026-08-13): matched by kdOutlet+kdCust, diapportion
  // ke bulan-bulan kuartal berjalan.
  const allItems = poas.flatMap((poa) => poa.items);
  const outletKodes = Array.from(new Set(allItems.map((it) => it.kodePI).filter((k): k is string => !!k)));
  const [activePsspRows, productMasterByKodeProduk] = await Promise.all([
    outletKodes.length > 0 ? getActivePsspByOutlets(outletKodes) : Promise.resolve([]),
    getProductMasterByKodeProduk(allItems),
  ]);

  let result = poas.flatMap((poa) => buildDoctorRows(poa, activePsspRows, quarterMonths, productMasterByKodeProduk));

  // "Belum digunakan di Exodus" (docs/exodus-poa-usage/01-business-rules.md
  // §4, revised 2026-08-27) — only in the list response, not in the shared
  // buildDoctorRows, so PATCH can still find an already-used row (idempotent).
  result = result.filter((r) => !r.usedInExodus);

  if (keyword) {
    result = result.filter((r) =>
      r.idPoa.toLowerCase().includes(keyword)
      || r.dokter.namaCust.toLowerCase().includes(keyword)
      || r.dokter.namaOutlet.toLowerCase().includes(keyword)
      || (r.dokter.kodeCust?.toLowerCase().includes(keyword) ?? false)
      || (r.dokter.kodePI?.toLowerCase().includes(keyword) ?? false)
    );
  }

  return NextResponse.json(result);
}
