/**
 * GET /api/export/non-hospital-evaluation?period=YYYY-MM
 *
 * Excel recap of every contract ending in `period` (Evaluasi Kontrak
 * Non-Hospital, docs/evaluasi-kontrak-non-hospital/03-ui-and-access.md).
 * ADMIN-only. Includes the decision, its reason, who decided and when.
 */
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { getNonHospitalEvalRows } from "@/lib/nonHospitalEvaluation";

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const period = req.nextUrl.searchParams.get("period") ?? "";
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "period harus YYYY-MM" }, { status: 400 });

  const rows = await getNonHospitalEvalRows(period);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Evaluasi Non-Hospital");
  ws.columns = [
    { header: "No", width: 5 }, { header: "Nama", width: 28 }, { header: "NIP", width: 11 }, { header: "Jabatan", width: 16 },
    { header: "Cabang", width: 22 }, { header: "Periode Kontrak (bulan)", width: 12 }, { header: "Awal Kontrak", width: 13 },
    { header: "Akhir Kontrak", width: 13 }, { header: "Total Score", width: 11 }, { header: "Rekomendasi Sistem (bulan)", width: 14 },
    { header: "Keputusan (bulan)", width: 12 }, { header: "Status", width: 16 }, { header: "Alasan", width: 36 },
    { header: "Rencana Pengembangan", width: 40 }, { header: "Diputuskan Oleh", width: 22 }, { header: "Waktu Keputusan", width: 20 },
    { header: "Catatan Data", width: 44 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((r, i) => {
    const d = r.decision;
    ws.addRow([
      i + 1, r.name, r.nip, r.jabatan ?? "", r.cabang ?? "", r.periodeBulan ?? "", r.awalKontrak, r.akhirKontrak,
      r.totalScore ?? "", r.recommendation?.months ?? "", d?.decisionMonths ?? "",
      d ? (d.status === "DISETUJUI" ? "Disetujui" : "Diubah") : "Belum Diputuskan",
      d?.decisionReason ?? "", d?.developmentPlanNotes ?? "", d?.decidedByName ?? "",
      d ? new Date(d.decidedAt).toISOString().replace("T", " ").slice(0, 16) : "", r.notes.join("; "),
    ]);
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Evaluasi-Kontrak-Non-Hospital-${period}.xlsx"`,
    },
  });
}
