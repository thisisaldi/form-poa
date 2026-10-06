/** GET /api/kpi-personil/summary-pdf — PDF Summary (NSM / SD / ADMIN), hanya personil yang disetujui lengkap. */
import { NextResponse } from "next/server";
import { getKpiSummary } from "@/app/actions/kpiDetail";
import { getCurrentUser } from "@/lib/session";
import { buildSummaryPdf } from "@/lib/kpiPdf";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const pdf = buildSummaryPdf(await getKpiSummary());
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Summary-KPI-Personil.pdf"' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal membuat PDF";
    return NextResponse.json({ error: msg }, { status: /hanya untuk/.test(msg) ? 403 : 500 });
  }
}
