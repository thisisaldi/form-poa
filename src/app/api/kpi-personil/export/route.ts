/**
 * GET /api/kpi-personil/export?scheme=hospital|non-hospital&period=YYYY-MM[&nip=…]
 *
 * Excel untuk halaman Detail KPI (docs/kpi-monitoring/04-final-layout.md §6).
 * Tanpa `nip` = satu sheet semua bawahan; dengan `nip` = kartu satu personil
 * (multi-sheet). Akses MEMAKAI action yang sama dengan halaman (hanya bawahan
 * langsung / ADMIN) — export bukan jalan memutar membaca personil lain.
 */
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getKpiPersonDetail, getKpiSubordinates, lastCompletedPeriod, type KpiScheme } from "@/app/actions/kpiDetail";
import { DECISION_LABEL, fmtDate, titleCase } from "@/components/kpi/kpiFormat";
import { periodLabel } from "@/components/kpi/kpiUi";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, string | number | null>[]) {
  const ws = wb.addWorksheet(name);
  if (rows.length === 0) { ws.addRow(["Tidak ada data"]); return; }
  const keys = Object.keys(rows[0]);
  ws.addRow(keys).font = { bold: true };
  for (const r of rows) ws.addRow(keys.map((k) => r[k] ?? ""));
  ws.columns.forEach((c) => { c.width = 18; });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scheme: KpiScheme = sp.get("scheme") === "non-hospital" ? "non-hospital" : "hospital";
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.get("period") ?? "") ? sp.get("period")! : await lastCompletedPeriod();
  const nip = sp.get("nip");
  const wb = new ExcelJS.Workbook();
  const hosp = scheme === "hospital";
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

  try {
    let filename: string;
    if (!nip) {
      const rows = await getKpiSubordinates(scheme, period);
      addSheet(wb, hosp ? "Detail KPI Hospital" : "Detail KPI Non-Hospital", rows.map((r, i) => {
        const h = r.month.h, n = r.month.n;
        const pct = (v: number | null | undefined) => (v == null ? null : r2(v * 100));
        const base = { No: i + 1, Nama: titleCase(r.name), NIP: r.nip, Jabatan: r.jabatan ?? r.role, [hosp ? "Area" : "Wilayah"]: r.area ?? "", "Akhir Kontrak": r.akhirKontrak ? fmtDate(r.akhirKontrak) : "" };
        const detail: Record<string, string | number | null> = hosp ? {
          "Target Sales (Rp)": h?.salesTarget ?? null, "Aktual Sales (Rp)": h?.salesActual ?? null, "ACV Sales (%)": r2(h?.salesPct ?? null), "Skor Sales": h?.salesScore ?? null,
          "Standar Kunjungan": h?.callStandar ?? null, "Realisasi Kunjungan": h?.callReal ?? null, "ACV Call Activity (%)": r2(h?.callPct ?? null), "Skor Call Activity": h?.callScore ?? null,
          "Customer Aktif": h?.customer ?? null, "Skor Customer": h?.customerScore ?? null,
          "Absensi (Reporting)": r2(h?.absensi ?? null), "Skor Absensi": h?.absensiScore ?? null,
        } : {
          "Target (Rp)": n?.target ?? null, "Sales (Rp)": n?.sales ?? null, "ACV Sales (%)": pct(n?.ach),
          Visit: n?.visit ?? null, "Hari Aktif": n?.hariAktif ?? null, "ACV Kunjungan (%)": pct(n?.achKunjungan),
          "SC Menang": n?.sc ?? null, "Hari Telat": n?.telat ?? null,
        };
        return {
          ...base, ...detail, [`Point ${periodLabel(period)}`]: r2(r.point),
          "Status Data": r.complete ? "Lengkap" : "Belum lengkap", "Catatan Data": r.notes.join("; "),
          "Rekomendasi (bulan)": r.rec?.months ?? "", Rekomendasi: r.rec?.label ?? "",
          "Keputusan (bulan)": r.decision?.months ?? "", "Status Approval": r.status,
        };
      }));
      filename = `Detail-KPI-${scheme}-${period}.xlsx`;
    } else {
      const d = await getKpiPersonDetail(scheme, nip);
      if (!d) return NextResponse.json({ error: "Tidak ditemukan atau bukan bawahan Anda" }, { status: 404 });
      const prof: [string, string | number | null][] = [
        ["Nama", titleCase(d.name)], ["NIP", d.nip], ["Jabatan", d.jabatan ?? d.role], ["Area/Wilayah", d.area ?? ""], ["Atasan langsung", d.atasanName ?? ""],
        ["Tanggal masuk", fmtDate(d.tglMasuk)], ["Periode evaluasi", `${periodLabel(d.window.start)} – ${periodLabel(d.window.end)}`],
        ["Point rata-rata", r2(d.avg.total)], ["Rekomendasi (bulan)", d.rec?.months ?? ""], ["Rekomendasi", d.rec?.label ?? ""],
        ["Status approval", d.status],
      ];
      if (d.decision) prof.push(["Keputusan diusulkan", DECISION_LABEL[d.decision.months]], ["Penjelasan keputusan", d.decision.reason ?? ""], ["Rencana pengembangan", d.decision.dev], ["Rasionalisasi ke direksi", d.decision.direction ?? ""], ["Dievaluasi pada", d.decision.at], ...Object.entries(d.decision.steps).map(([k, v]): [string, string] => [`Disetujui ${k}`, `${v.byName ?? ""} · ${v.at}`]));
      addSheet(wb, "Profil", prof.map(([Keterangan, Nilai]) => ({ Keterangan, Nilai })));
      addSheet(wb, "Rekap Bulanan", d.months.map((m): Record<string, string | number | null> => hosp && m.h ? {
        Bulan: periodLabel(m.period), "Target (Rp)": m.h.salesTarget, "Aktual (Rp)": m.h.salesActual, "Achievement (%)": r2(m.h.salesPct), "Band Sales": m.h.salesScore,
        "Standar Kunjungan": m.h.callStandar, "Realisasi Kunjungan": m.h.callReal, "Call Activity (%)": r2(m.h.callPct), "Band Call": m.h.callScore, "Sumber Call": m.h.callSource,
        "Customer Aktif": m.h.customer, "Band Customer": m.h.customerScore, "Absensi (Reporting)": r2(m.h.absensi), "Band Absensi": m.h.absensiScore, "Sumber Absensi": m.h.absensiSource, "Total Point": r2(m.total),
      } : {
        Bulan: periodLabel(m.period), "Target (Rp)": m.n?.target ?? null, "Sales (Rp)": m.n?.sales ?? null, "ACH Sales (%)": m.n?.ach == null ? null : r2(m.n.ach * 100),
        Visit: m.n?.visit ?? null, "Hari Aktif": m.n?.hariAktif ?? null, "ACH Kunjungan (%)": m.n?.achKunjungan == null ? null : r2(m.n.achKunjungan * 100),
        "SC Menang": m.n?.sc ?? null, "Hari Telat": m.n?.telat ?? null, Catatan: m.n?.notes.join("; ") ?? "",
      }));
      filename = `Detail-KPI-${d.nip}-${titleCase(d.name).replace(/\s+/g, "-")}.xlsx`;
    }
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal export";
    return NextResponse.json({ error: msg }, { status: /atasan/.test(msg) ? 403 : 500 });
  }
}
