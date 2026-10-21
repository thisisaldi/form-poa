/**
 * GET /api/absensi-hospital/export?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Excel absensi SIPP semua orang di struktur Hospital (lihat
 * src/lib/absensiHospitalExport.ts). SFE + ADMIN saja. Rentang maks 31 hari.
 * Tarik live dari SIPP (1 panggilan per NIP, paralel terbatas) — gak ada
 * snapshot di DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { buildAbsensiHospitalWorkbook, validateRange } from "@/lib/absensiHospitalExport";

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SFE" && session.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const start = req.nextUrl.searchParams.get("start") ?? "";
  const end = req.nextUrl.searchParams.get("end") ?? "";
  const invalid = validateRange(start, end);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { workbook, people, sippFailures } = await buildAbsensiHospitalWorkbook(start, end);
  if (people > 0 && sippFailures === people) {
    return NextResponse.json({ error: "SIPP sedang tidak bisa dihubungi. Coba lagi nanti." }, { status: 502 });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Absensi_Hospital_${start}_${end}.xlsx"`,
    },
  });
}
