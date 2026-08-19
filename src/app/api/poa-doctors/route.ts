/**
 * GET /api/poa-doctors?nip=...
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
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { currentQuarter, quarterToMonths } from "@/lib/quarterUtils";
import { verifyBasicAuth } from "@/lib/apiBasicAuth";
import { getActivePsspByOutlets } from "@/app/actions/customer";
import { computeActivePsspStats } from "@/lib/activePssp";

function doctorKey(item: { kodePI: string | null; namaCust: string }): string {
  return `${item.kodePI ?? ""}|${item.namaCust}`;
}

const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Mirrors computeItemValues() in /api/poa/[id]/export/route.ts — estimasi =
// rencanaTotalBiaya as-is, nilai PSSP = rencanaTotalBiaya × %PSSP × pengali
// nilai R (pengaliNilaiR defaults to 1 when null, same convention used
// everywhere else this field is read).
function computeEstimasiNilaiPssp(item: { rencanaTotalBiaya: unknown; persenPsspDokter: unknown; pengaliNilaiR: unknown }) {
  const estimasi = toNum(item.rencanaTotalBiaya);
  const pengaliNilaiR = item.pengaliNilaiR != null ? toNum(item.pengaliNilaiR) : 1;
  const nilaiPssp = estimasi * toNum(item.persenPsspDokter) * pengaliNilaiR;
  return { estimasi, nilaiPssp };
}

export async function GET(req: NextRequest) {
  // Two credential paths (2026-08-19): the app's own browser calls carry a
  // session cookie (getCurrentUser); an external app has no session, so it
  // authenticates with HTTP Basic Auth instead, checked against the
  // admin-managed PoaDoctorsApiCredential row (see apiBasicAuth.ts,
  // admin/page.tsx). Either is sufficient — the DB lookup only runs when
  // there's no session, so the app's own normal traffic pays no extra cost.
  const session = await getCurrentUser();
  if (!session) {
    const credential = await prisma.poaDoctorsApiCredential.findUnique({ where: { id: 1 } });
    if (!verifyBasicAuth(req, credential)) {
      return NextResponse.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="poa-doctors"' },
      });
    }
  }

  const nip = req.nextUrl.searchParams.get("nip")?.trim();
  if (!nip) return NextResponse.json({ error: "NIP wajib diisi." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { nip }, select: { nip: true } });
  if (!user) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });

  const quarter = currentQuarter();
  const quarterMonths = quarterToMonths(quarter);

  const poas = await prisma.poaForm.findMany({
    where: { ownerId: nip, period: quarter },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          id: true,
          kodeCust: true,
          namaCust: true,
          spesialisasi: true,
          kodePI: true,
          namaOutlet: true,
          kodeProduk: true,
          namaProduk: true,
          rencanaTotalBiaya: true,
          persenPsspDokter: true,
          pengaliNilaiR: true,
        },
        orderBy: { createdAt: "asc" },
      },
      doctorApprovals: {
        select: { kodePI: true, namaCust: true, status: true },
      },
    },
  });

  type Poa = (typeof poas)[number];

  // Estimasi Aktif per dokter (PSSP contract yang masih berjalan, terpisah
  // dari estimasi rencana di atas yang bersumber dari PoaLineItem) — sama
  // sumber & cara tercacah-nya dengan doctorPsspInfo di poa/[id]/page.tsx
  // (docs/TODO.md #17, 2026-08-13): matched by kdOutlet+kdCust, diapportion
  // ke bulan-bulan kuartal berjalan.
  type Item = Poa["items"][number];
  const allKodePI: string[] = poas.flatMap((poa: Poa) =>
    poa.items.map((it: Item) => it.kodePI).filter((k: string | null): k is string => !!k)
  );
  const outletKodes: string[] = Array.from(new Set(allKodePI));
  const activePsspRows = outletKodes.length > 0 ? await getActivePsspByOutlets(outletKodes) : [];

  const result = poas.flatMap((poa: Poa) => {
    type Doctor = {
      // First line item id encountered for this doctor — same "anchor item"
      // concept /poa/[id]/doctor/[itemId]/edit uses (it re-queries every row
      // sharing kodePI+namaCust, so any one of the doctor's item ids works).
      anchorItemId: string;
      kodeCust: string | null;
      namaCust: string;
      spesialisasi: string;
      kodePI: string | null;
      namaOutlet: string;
      produk: { kodeProduk: string; namaProduk: string; estimasi: number; nilaiPssp: number }[];
      estimasiTotal: number;
      nilaiPsspTotal: number;
    };
    const doctorMap = new Map<string, Doctor>();

    for (const item of poa.items) {
      const key = doctorKey(item);
      let entry = doctorMap.get(key);
      if (!entry) {
        entry = {
          anchorItemId: item.id,
          kodeCust: item.kodeCust,
          namaCust: item.namaCust,
          spesialisasi: item.spesialisasi,
          kodePI: item.kodePI,
          namaOutlet: item.namaOutlet,
          produk: [],
          estimasiTotal: 0,
          nilaiPsspTotal: 0,
        };
        doctorMap.set(key, entry);
      }
      const { estimasi, nilaiPssp } = computeEstimasiNilaiPssp(item);
      entry.estimasiTotal += estimasi;
      entry.nilaiPsspTotal += nilaiPssp;
      // One row per (doctor, produk) in practice, but guard against a
      // duplicate kodeProduk row the same way the produk-listing loop
      // already did — accumulate into the existing entry instead of adding
      // a second one.
      const existingProduk = entry.produk.find((p) => p.kodeProduk === item.kodeProduk);
      if (existingProduk) {
        existingProduk.estimasi += estimasi;
        existingProduk.nilaiPssp += nilaiPssp;
      } else {
        entry.produk.push({ kodeProduk: item.kodeProduk, namaProduk: item.namaProduk, estimasi, nilaiPssp });
      }
    }

    // A doctor still sitting in DRAFT/REVISI within an otherwise in-flight
    // draft has no PoaDoctorApproval row yet (created lazily on submit) —
    // falls back to the PoaForm's own status, which is DRAFT in that case.
    type DoctorApproval = Poa["doctorApprovals"][number];
    const approvalStatusByKey = new Map(
      poa.doctorApprovals.map((a: DoctorApproval) => [doctorKey(a), a.status])
    );

    return [...doctorMap.entries()].map(([key, dokter]) => {
      const aktifStats = dokter.kodeCust && dokter.kodePI
        ? computeActivePsspStats(
            activePsspRows.filter((r) => r.kdOutlet === dokter.kodePI && r.kdCust === dokter.kodeCust),
            quarterMonths
          )
        : null;

      return {
        uidPoa: poa.id,
        uidCustomer: dokter.anchorItemId,
        path: `/poa/${poa.id}/doctor/${dokter.anchorItemId}/edit`,
        approveUntil: approvalStatusByKey.get(key) ?? poa.status,
        dokter: {
          kodeCust: dokter.kodeCust,
          namaCust: dokter.namaCust,
          spesialisasi: dokter.spesialisasi,
          kodePI: dokter.kodePI,
          namaOutlet: dokter.namaOutlet,
        },
        estimasi: dokter.estimasiTotal,
        nilaiPssp: dokter.nilaiPsspTotal,
        estimasiAktif: aktifStats?.estBarisTercacah ?? 0,
        nilaiPsspAktif: aktifStats?.nilaiTercacah ?? 0,
        produk: dokter.produk,
      };
    });
  });

  return NextResponse.json(result);
}
