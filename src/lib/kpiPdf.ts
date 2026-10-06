/**
 * PDF builders for KPI Personil (docs/kpi-monitoring/04-final-layout.md §9):
 * Form Approval per personil and the Summary. Server-side jsPDF + autotable,
 * layout follows the mockup (`internal/KPI Personil (Copy) (1).html`).
 * Signature boxes are for wet signatures until digital approval covers every step.
 */
import { jsPDF } from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import type { KpiSummary, PersonDetail } from "@/app/actions/kpiDetail";
import { STEP_LABEL } from "@/lib/kpiApproval";
import { DECISION_LABEL, fmtDate, nf, titleCase } from "@/components/kpi/kpiFormat";
import { periodLabel } from "@/components/kpi/kpiUi";

type RGB = [number, number, number];
const INK: RGB = [43, 40, 34], MUTE: RGB = [107, 101, 96], LINE: RGB = [200, 192, 176], SOFT: RGB = [242, 237, 228], M = 15;

function kit(doc: jsPDF) {
  const RX = doc.internal.pageSize.getWidth() - M, H = doc.internal.pageSize.getHeight();
  const T = (t: string | number, x: number, y: number, o: { b?: boolean; s?: number; c?: RGB; align?: "right" | "center" } = {}) => {
    doc.setFont("helvetica", o.b ? "bold" : "normal"); doc.setFontSize(o.s ?? 9); doc.setTextColor(...(o.c ?? INK));
    doc.text(String(t), x, y, o.align ? { align: o.align } : undefined);
  };
  const hr = (y: number) => { doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, RX, y); };
  const title = (t: string, y: number) => { T(t.toUpperCase(), M, y, { b: true, s: 8, c: MUTE }); hr(y + 1.8); return y + 6; };
  const room = (y: number, h: number) => (y + h > H - 15 ? (doc.addPage(), 18) : y);
  const tbl = (opts: UserOptions) => {
    autoTable(doc, {
      margin: { left: M, right: 15 }, theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
      headStyles: { fillColor: SOFT, textColor: MUTE, fontStyle: "bold" }, footStyles: { fillColor: SOFT, textColor: INK, fontStyle: "bold" },
      ...opts,
    });
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  };
  return { RX, H, T, hr, title, room, tbl };
}

const num = (extra?: object) => ({ halign: "right" as const, ...extra });
const today = () => new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

export function buildApprovalPdf(d: PersonDetail, evaluatorLabel: string): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { RX, T, hr, title, room, tbl } = kit(doc);
  const hosp = d.scheme === "hospital";
  const nama = titleCase(d.name);

  T("FORM EVALUASI PERPANJANGAN KONTRAK", M, 18, { b: true, s: 15 });
  T(`KPI Personil - ${hosp ? "Hospital" : "Non-Hospital"}`, M, 24, { s: 9, c: MUTE });
  T("No. Dokumen", RX, 14, { s: 7.5, c: MUTE, align: "right" });
  T(`KPI-EVAL/${d.window.end.replace("-", "/")}/${d.nip}`, RX, 18.5, { b: true, s: 9, align: "right" });
  T(`Dicetak ${today()}`, RX, 23.5, { s: 8, c: MUTE, align: "right" });
  hr(28);

  const evaluator = d.chain.find((c) => c.step === d.evaluator)?.name ?? "-";
  let y = tbl({
    startY: 31, theme: "plain", styles: { font: "helvetica", fontSize: 9, cellPadding: 1.2, textColor: INK },
    columnStyles: { 0: { textColor: MUTE, cellWidth: 30 }, 1: { fontStyle: "bold", cellWidth: 56 }, 2: { textColor: MUTE, cellWidth: 30 }, 3: { fontStyle: "bold" } },
    body: [
      ["Nama", nama, "NIP", d.nip],
      ["Jabatan", d.jabatan ?? d.role, hosp ? "Area" : "Wilayah (GT)", d.area ?? "-"],
      ["Join date", fmtDate(d.tglMasuk), "Periode evaluasi", `${periodLabel(d.window.start)} - ${periodLabel(d.window.end)}`],
      ["Penilai (atasan)", evaluator, "Atasan langsung", d.atasanName ?? "-"],
    ],
  }) + 5;

  // Point final + rekomendasi
  doc.setDrawColor(...LINE); doc.setFillColor(...SOFT); doc.roundedRect(M, y, RX - M, 22, 2, 2, "FD");
  T("POINT FINAL", M + 5, y + 7, { b: true, s: 8, c: MUTE });
  const pt = d.avg.total == null ? "-" : nf(d.avg.total);
  T(pt, M + 5, y + 17, { b: true, s: 22 }); T("/ 100", M + 5 + doc.getTextWidth(pt) * 1.0 + 3, y + 17, { s: 10, c: MUTE });
  T("REKOMENDASI SISTEM", RX - 5, y + 7, { b: true, s: 8, c: MUTE, align: "right" });
  T(d.rec ? DECISION_LABEL[d.rec.months] : "Belum tersedia", RX - 5, y + 14.5, { b: true, s: 14, align: "right" });
  if (d.rec) T(d.rec.label, RX - 5, y + 19, { s: 8.5, c: MUTE, align: "right" });
  y += 28;

  const avg = (f: (m: PersonDetail["months"][number]) => number | null | undefined) => {
    const v = d.months.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  if (hosp) {
    y = title("Rincian indikator", y);
    const w = [50, 25, 15, 10];
    const rows: [string, string, string, string, string][] = [
      ["Sales Achievement", "50%", `${nf(avg((m) => m.h?.salesPct))}%`, nf(d.avg.sales == null ? null : (d.avg.sales / 50) * 100, 0), nf(d.avg.sales)],
      ["Call Activity", "25%", `${nf(avg((m) => m.h?.callPct), 0)}%`, nf(d.avg.activity == null ? null : (d.avg.activity / 25) * 100, 0), nf(d.avg.activity)],
      ["Customer Aktif (PS/SP)", "15%", `${nf(avg((m) => m.h?.customer), 1)} customer`, nf(d.avg.customer == null ? null : (d.avg.customer / 15) * 100, 0), nf(d.avg.customer)],
      ["Absensi (Reporting)", "10%", `${nf(avg((m) => m.h?.absensi))} reporting`, nf(d.avg.absensi == null ? null : (d.avg.absensi / 10) * 100, 0), nf(d.avg.absensi)],
    ];
    void w;
    y = tbl({ startY: y, head: [["Indikator", "Bobot", "Pencapaian", "Nilai", "Point final"]], body: rows, foot: [["Total Point final", "100%", "", "", pt]],
      columnStyles: { 1: num(), 2: num(), 3: num(), 4: num({ fontStyle: "bold" }) } }) + 5;
    y = room(y, 60); y = title("Rekap bulanan", y);
    y = tbl({
      startY: y, head: [["Bulan", "Sales", "Call Activity", "Customer aktif", "Absensi", "Total point"]],
      body: d.months.map((m) => [periodLabel(m.period), `${nf(m.h?.salesPct)}%`, `${nf(m.h?.callPct, 0)}%`, String(m.h?.customer ?? "-"), nf(m.h?.absensi), nf(m.total)]),
      foot: [["Point final", "", "", "", "", pt]], columnStyles: { 1: num(), 2: num(), 3: num(), 4: num(), 5: num({ fontStyle: "bold" }) },
    }) + 5;
  } else {
    y = title("Rekap bulanan", y);
    y = tbl({
      startY: y, head: [["Bulan", "ACH target", "ACH kunjungan", "SC Menang", "Hari telat"]],
      body: d.months.map((m) => [periodLabel(m.period), m.n?.ach == null ? "-" : `${nf(m.n.ach * 100, 1)}%`, m.n?.achKunjungan == null ? "-" : `${nf(m.n.achKunjungan * 100, 1)}%`, String(m.n?.sc ?? "-"), String(m.n?.telat ?? "-")]),
      columnStyles: { 1: num(), 2: num(), 3: num(), 4: num() },
    }) + 5;
  }

  // Keputusan (selalu satu halaman dengan persetujuan)
  y = room(y, 135); y = title("Keputusan penilai", y);
  const chosen = d.decision ? d.decision.months : null;
  T("Keputusan perpanjangan", M, y + 3, { s: 9, c: MUTE });
  let x = M + 42;
  for (const m of [12, 9, 6, 0]) {
    const label = DECISION_LABEL[m];
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.rect(x, y, 4.2, 4.2);
    if (chosen === m) { doc.setLineWidth(0.6); doc.line(x + 0.8, y + 2.2, x + 1.8, y + 3.4); doc.line(x + 1.8, y + 3.4, x + 3.6, y + 0.9); }
    T(label, x + 6, y + 3.2, { s: 9 });
    x += 6 + doc.getTextWidth(label) + 8;
  }
  y += 9;
  const fields: [string, string | null | undefined][] = [
    ["Penjelasan keputusan", d.decision?.reason], ["Evaluasi rencana pengembangan personil", d.decision?.dev], ["Rasionalisasi perpanjangan ke direksi", d.decision?.direction],
  ];
  for (const [label, text] of fields) {
    const lines = doc.splitTextToSize(text || "", RX - M - 6) as string[];
    const h = Math.max(16, lines.length * 4.2 + 6);
    y = room(y, h + 7);
    T(label, M, y + 2.5, { b: true, s: 8.5 });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(M, y + 4.5, RX - M, h);
    if (lines.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(lines, M + 3, y + 10); }
    y += h + 8;
  }

  // Persetujuan: personil + seluruh atasan di rantai
  y = room(y, 60); y = title("Persetujuan", y);
  T(d.decision ? `Dievaluasi oleh ${d.decision.byName ?? evaluatorLabel} pada ${new Date(d.decision.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}` : "Belum dievaluasi di sistem", M, y + 1, { s: 8.5, c: MUTE });
  y += 6;
  const boxes = [{ k: "SELF", name: `${nama} (${d.jabatan ?? d.role})` }, ...d.chain.map((c) => ({ k: c.step as string, name: c.name ?? c.approvedBy ?? "-" }))];
  const gap = boxes.length > 3 ? 4 : 6, bw = (RX - M - gap * (boxes.length - 1)) / boxes.length, bh = 42;
  boxes.forEach((b, i) => {
    const bx = M + i * (bw + gap), done = b.k === "SELF" ? null : d.decision?.steps[b.k];
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(bx, y, bw, bh);
    T(b.k === "SELF" ? "Mengetahui: Personil" : `Approval: ${STEP_LABEL[b.k]}`, bx + 3, y + 5.5, { b: true, s: 8.5 });
    if (done) {
      T("DISETUJUI di sistem", bx + 3, y + 10.5, { b: true, s: 7.5, c: [0, 143, 66] });
      T(new Date(done.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }), bx + 3, y + 14, { s: 7.5, c: MUTE });
    } else if (b.k !== "SELF") T("Belum disetujui (digital)", bx + 3, y + 10.5, { s: 7.5, c: MUTE });
    doc.setDrawColor(...INK); doc.line(bx + 6, y + 31, bx + bw - 6, y + 31);
    const wl = doc.splitTextToSize(b.name, bw - 6) as string[];
    T(wl[0], bx + bw / 2, y + 35.5, { s: wl[0].length > 26 ? 7.5 : 8.5, b: true, align: "center" });
    T("Tanggal: ___ / ___ / ______", bx + bw / 2, y + 40, { s: 7.5, c: MUTE, align: "center" });
  });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (i > 1) T(`Form Evaluasi Perpanjangan Kontrak - ${nama} (${d.nip})`, M, 11, { b: true, s: 8.5, c: MUTE });
    T(`${nama} (${d.nip}) - Form evaluasi perpanjangan kontrak`, M, 290, { s: 7.5, c: MUTE });
    T(`Halaman ${i} / ${n}`, RX, 290, { s: 7.5, c: MUTE, align: "right" });
  }
  return Buffer.from(doc.output("arraybuffer"));
}

export function buildSummaryPdf(s: KpiSummary): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const { RX, T, hr, title, room, tbl } = kit(doc);
  T("SUMMARY KPI PERSONIL - SALES DIRECTOR", M, 16, { b: true, s: 14 });
  T(`Hospital · ${periodLabel(s.window.start)} - ${periodLabel(s.window.end)} · personil yang sudah disetujui sampai NSM`, M, 22, { s: 9, c: MUTE });
  T(`Dicetak ${today()}`, RX, 16, { s: 8, c: MUTE, align: "right" });
  hr(25);
  let y = title("Point final per jabatan", 31);
  y = tbl({
    startY: y, head: [["Jabatan", "Jumlah", "Sales (50%)", "Call Activity (25%)", "Customer Aktif (15%)", "Absensi (10%)", "Point final"]],
    body: s.groups.map((g) => [g.key, String(g.people.length), nf(g.avg.sales), nf(g.avg.activity), nf(g.avg.customer), nf(g.avg.absensi), nf(g.avg.total)]),
    foot: [["Semua", String(s.all.n), nf(s.all.avg.sales), nf(s.all.avg.activity), nf(s.all.avg.customer), nf(s.all.avg.absensi), nf(s.all.avg.total)]],
    columnStyles: { 1: num(), 2: num(), 3: num(), 4: num(), 5: num(), 6: num({ fontStyle: "bold" }) },
  }) + 6;

  y = room(y, 40); y = title(`Personil yang diperpanjang (${s.extended.length})`, y);
  y = tbl({
    startY: y, head: [["NO", "Personil", "Jabatan", "Area", "Atasan (NSM)", "Point final", "Perpanjangan", "Kontrak baru", "Disetujui NSM"]],
    body: s.extended.map((p, i) => [String(i + 1), `${titleCase(p.name)} (${p.nip})`, p.role === "ASM" || p.role === "SM" ? p.role : "MR/SPV", p.area ?? "-", p.nsmName ?? "-", nf(p.total),
      DECISION_LABEL[p.decisionMonths], p.newContract ? `${fmtDate(p.newContract.start)} - ${fmtDate(p.newContract.end)}` : "-", fmtDate(p.approvedAt)]),
    columnStyles: { 5: num({ fontStyle: "bold" }) },
  }) + 6;

  for (const g of s.groups) {
    y = room(y, 40); y = title(`${g.key} - ${g.people.length} personil, urut peringkat leaderboard`, y);
    y = tbl({
      startY: y, head: [["NO", "Personil", "Atasan (NSM)", "Area", "Sales", "Call", "Customer", "Absensi", "Point final", "Peringkat", "Keputusan"]],
      body: g.people.map((p, i) => [String(i + 1), `${titleCase(p.name)} (${p.nip})`, p.nsmName ?? "-", p.area ?? "-", nf(p.pillars.sales), nf(p.pillars.activity), nf(p.pillars.customer), nf(p.pillars.absensi),
        nf(p.total), p.rank ? `${p.rank} dari ${p.rankOf}` : "-", DECISION_LABEL[p.decisionMonths]]),
      foot: [["", "", "", `Rata-rata ${g.key}`, nf(g.avg.sales), nf(g.avg.activity), nf(g.avg.customer), nf(g.avg.absensi), nf(g.avg.total), "", ""]],
      columnStyles: { 4: num(), 5: num(), 6: num(), 7: num(), 8: num({ fontStyle: "bold" }) },
    }) + 6;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); T(`Halaman ${i} / ${n}`, RX, 205, { s: 7.5, c: MUTE, align: "right" }); }
  return Buffer.from(doc.output("arraybuffer"));
}
