/**
 * GET /api/poa-doctors?nip=...&keyword=...
 *
 * List of doctors (1 row per (kodePI, namaCust) pair, same doctorKey grouping
 * as DraftChecklist.tsx / PoaDoctorApproval) in the CURRENT calendar quarter
 * (PoaForm.period, format "YYYY-QN" — see currentQuarter()). One NIP normally
 * has at most one PoaForm per quarter (poa.ts's createPoaDraft duplicate-
 * guard), but this returns an array in case that ever changes.
 *
 * `nip`/`keyword` as query params (not path segments) — read-only lookup,
 * GET is the correct method, query params keep them off the URL path while
 * staying valid for GET (unlike a JSON body).
 *
 * docs/exodus-poa-usage/ (2026-08-27, revised same day) — `nip` is now
 * OPTIONAL: `keyword` alone searches company-wide within the quarter.
 * Checked against docs/PERFORMANCE.md before making this change (not
 * assumed) — current-quarter volume is 270 PoaForm / 6140 PoaLineItem /
 * only ~33 NSM-approved doctor rows, far below the incident scale that
 * doc warns about (#47, unbounded company-wide queries), and the quarter
 * window here is already a mandatory bound (doesn't grow with history).
 * Measured company-wide (no nip filter): ~2.6s end-to-end, under the <3s
 * target but close — revisit if data volume grows significantly.
 * Both `nip` and `keyword` may be omitted — returns everything for the
 * quarter (still bounded by that window + NSM-approved + not-used-in-
 * Exodus, so not truly unfiltered).
 *
 * Only fully (NSM) approved + not-yet-used-in-Exodus doctors are returned
 * (buildDoctorRows already drops non-NSM rows; this route additionally
 * drops usedInExodus ones — kept out of the shared helper so GET/PATCH
 * /api/poa-doctors/[id] can still resolve an already-used row).
 *
 * Row-building logic shared with GET/PATCH /api/poa-doctors/[id] (detail
 * by uidCustomer) lives in src/lib/poaDoctorsRows.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentQuarter, quarterFromDate, quarterToMonths } from "@/lib/quarterUtils";
import { getActivePsspByOutlets } from "@/app/actions/customer";
import {
  poaDoctorRowsSelect,
  buildDoctorRows,
  getProductMasterByKodeProduk,
  getCustomerCodeExodusByKodeCust,
  getOutletIdsByKodePI,
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

  const nip = req.nextUrl.searchParams.get("nip")?.trim() || null;
  const keyword = req.nextUrl.searchParams.get("keyword")?.trim().toLowerCase() || null;
  const startDate = req.nextUrl.searchParams.get("startDate")?.trim() || null;

  if (nip) {
    const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true } });
    if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  let quarter: string;
  try {
    quarter = startDate ? quarterFromDate(startDate) : currentQuarter();
  } catch {
    return NextResponse.json({ error: "startDate harus format YYYY-MM-DD." }, { status: 400 });
  }
  const quarterMonths = quarterToMonths(quarter);

  const poas: PoaWithDoctorRows[] = await prisma.poaForm.findMany({
    where: { period: quarter, ...(nip ? { ownerId: nip } : {}) },
    select: poaDoctorRowsSelect,
  });

  // Estimasi Aktif per dokter (PSSP contract yang masih berjalan, terpisah
  // dari estimasi rencana di atas yang bersumber dari PoaLineItem) — sama
  // sumber & cara tercacah-nya dengan doctorPsspInfo di poa/[id]/page.tsx
  // (docs/TODO.md #17, 2026-08-13): matched by kdOutlet+kdCust, diapportion
  // ke bulan-bulan kuartal berjalan.
  const allItems = poas.flatMap((poa) => poa.items);
  const outletKodes = Array.from(new Set(allItems.map((it) => it.kodePI).filter((k): k is string => !!k)));
  const kodeCusts = Array.from(new Set(allItems.map((it) => it.kodeCust).filter((k): k is string => !!k)));
  const [activePsspRows, productMasterByKodeProduk, customerCodeExodusByKodeCust, outletIdByKodePI] = await Promise.all([
    outletKodes.length > 0 ? getActivePsspByOutlets(outletKodes) : Promise.resolve([]),
    getProductMasterByKodeProduk(allItems),
    getCustomerCodeExodusByKodeCust(kodeCusts),
    getOutletIdsByKodePI(),
  ]);

  let result = poas.flatMap((poa) => buildDoctorRows(poa, activePsspRows, quarterMonths, productMasterByKodeProduk, customerCodeExodusByKodeCust, outletIdByKodePI));

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
