/**
 * GET /api/kpi-personil/approval-pdf?scheme=hospital|non-hospital&nip=…
 * Form Approval per personil (PDF). Akses = akses kartu Detail KPI (getKpiPersonDetail), bukan jalan memutar.
 */
import { NextRequest, NextResponse } from "next/server";
import { getKpiPersonDetail, type KpiScheme } from "@/app/actions/kpiDetail";
import { getCurrentUser } from "@/lib/session";
import { buildApprovalPdf } from "@/lib/kpiPdf";
import { titleCase } from "@/components/kpi/kpiFormat";

export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scheme: KpiScheme = req.nextUrl.searchParams.get("scheme") === "non-hospital" ? "non-hospital" : "hospital";
  const nip = req.nextUrl.searchParams.get("nip");
  if (!nip) return NextResponse.json({ error: "nip wajib" }, { status: 400 });
  try {
    const d = await getKpiPersonDetail(scheme, nip);
    if (!d) return NextResponse.json({ error: "Tidak ditemukan atau di luar lingkup Anda" }, { status: 404 });
    const pdf = buildApprovalPdf(d, session.name);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Form-Approval-KPI-${d.nip}-${titleCase(d.name).replace(/\s+/g, "-")}.pdf"` },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal membuat PDF";
    return NextResponse.json({ error: msg }, { status: /atasan/.test(msg) ? 403 : 500 });
  }
}
