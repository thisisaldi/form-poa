import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseKpiPersonil } from "@/lib/kpiAccess";
import { getKpiSummary } from "@/app/actions/kpiDetail";
import { Card } from "@/components/ui/Card";
import { KpiPageNav } from "@/components/kpi/KpiPageNav";
import { periodLabel } from "@/components/kpi/kpiUi";
import { DECISION_LABEL, fmtDate, nf, titleCase } from "@/components/kpi/kpiFormat";

export const metadata = { title: "Summary KPI Personil · Form POA" };

/**
 * Summary KPI Personil — hanya personil yang evaluasinya sudah disetujui lengkap (sampai NSM).
 * NSM, Sales Director, dan ADMIN (= "PIC" di mockup). Spec: docs/kpi-monitoring/04-final-layout.md §9.
 */
export default async function KpiSummaryPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!["ADMIN", "SD", "NSM"].filter(canUseKpiPersonil).includes(session.role)) redirect("/dashboard");

  const d = await getKpiSummary();
  const stats: [string, string, string][] = [
    ["Personil di summary", String(d.all.n), "disetujui NSM"],
    ["Rata-rata Point final", d.all.n ? nf(d.all.avg.total) : "–", ""],
    ["Belum sampai approval NSM", String(d.waiting), "tidak ditampilkan"],
    ["Belum dievaluasi", String(Math.max(0, d.total - d.evaluated)), `dari ${d.total} personil Hospital`],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1>Summary KPI Personil</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Hospital · {periodLabel(d.window.start)} – {periodLabel(d.window.end)} · hanya personil yang sudah disetujui sampai NSM
        </p>
      </div>
      <KpiPageNav current="summary" role={session.role} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([k, v, s]) => (
          <Card key={k} className="p-4!">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            {s && <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{s}</p>}
          </Card>
        ))}
      </div>

      {d.all.n === 0 ? (
        <Card>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada personil yang sampai approval NSM. Summary akan terisi setelah NSM menyetujui evaluasi.</p>
        </Card>
      ) : (
        <>
          <Card padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
              <div>
                <h2 className="text-base font-semibold">Point final per jabatan</h2>
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Rata-rata Point final tiap KPI untuk personil yang sudah disetujui NSM.</p>
              </div>
              <a href="/api/kpi-personil/summary-pdf" className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--color-blue)", color: "#fff" }}>Unduh PDF Summary</a>
            </div>
            <Tbl head={["Jabatan", "Jumlah", "Sales (50%)", "Call Activity (25%)", "Customer Aktif (15%)", "Absensi (10%)", "Point final"]} numFrom={1}
              rows={d.groups.map((g) => [<b key="l">{g.key}</b>, g.people.length, nf(g.avg.sales), nf(g.avg.activity), nf(g.avg.customer), nf(g.avg.absensi), <b key="t">{nf(g.avg.total)}</b>])}
              foot={["Semua", d.all.n, nf(d.all.avg.sales), nf(d.all.avg.activity), nf(d.all.avg.customer), nf(d.all.avg.absensi), nf(d.all.avg.total)]} />
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-3">
              <h2 className="text-base font-semibold">Personil yang diperpanjang</h2>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {d.extended.length} personil diperpanjang{d.notExtended ? ` · ${d.notExtended} personil tidak diperpanjang` : ""}.
              </p>
            </div>
            <Tbl head={["NO", "Personil", "Jabatan", "Area", "Atasan (NSM)", "Point final", "Perpanjangan", "Kontrak baru", "Disetujui NSM"]} numFrom={5}
              rows={d.extended.map((p, i) => [i + 1, <Who key="w" p={p} />, p.role === "ASM" || p.role === "SM" ? p.role : "MR/SPV", p.area ?? "–", p.nsmName ?? "–", <b key="t">{nf(p.total)}</b>, <b key="d">{DECISION_LABEL[p.decisionMonths]}</b>,
                p.newContract ? `${fmtDate(p.newContract.start)} – ${fmtDate(p.newContract.end)}` : "–", fmtDate(p.approvedAt)])} />
          </Card>

          {d.groups.map((g) => (
            <Card key={g.key} padded={false}>
              <div className="p-5 pb-3">
                <h2 className="text-base font-semibold">{g.key}</h2>
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {g.people.length} personil · urut peringkat leaderboard · rata-rata Point final {nf(g.avg.total)}
                </p>
              </div>
              <Tbl head={["NO", "Personil", "Atasan (NSM)", "Area", "Sales (50%)", "Call (25%)", "Customer (15%)", "Absensi (10%)", "Point final", "Peringkat jabatan", "Keputusan"]} numFrom={4}
                rows={g.people.map((p, i) => [i + 1, <Who key="w" p={p} />, p.nsmName ?? "–", p.area ?? "–", nf(p.pillars.sales), nf(p.pillars.activity), nf(p.pillars.customer), nf(p.pillars.absensi),
                  <b key="t">{nf(p.total)}</b>, p.rank ? `${p.rank} dari ${p.rankOf}` : "–", DECISION_LABEL[p.decisionMonths]])}
                foot={["", "", "", `Rata-rata ${g.key}`, nf(g.avg.sales), nf(g.avg.activity), nf(g.avg.customer), nf(g.avg.absensi), nf(g.avg.total), "", ""]} />
            </Card>
          ))}
          <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
            Point final per KPI = nilai band × bobot. Peringkat jabatan = peringkat di Leaderboard bulan {periodLabel(d.window.end)} di antara jabatan yang sama.
          </p>
        </>
      )}
    </div>
  );
}

function Who({ p }: { p: { name: string; nip: string; role: string } }) {
  return <>{titleCase(p.name)}<span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{p.nip} · {p.role}</span></>;
}

function Tbl({ head, rows, foot, numFrom }: { head: string[]; rows: React.ReactNode[][]; foot?: React.ReactNode[]; numFrom: number }) {
  const cell = (c: React.ReactNode, i: number, bold?: boolean) => (
    <td key={i} className={`whitespace-nowrap px-3 py-2 ${i >= numFrom && typeof c !== "string" || (i >= numFrom && /^[-\d.,]+$/.test(String(c))) ? "text-right tabular-nums" : ""} ${bold ? "font-bold" : ""}`}>{c}</td>
  );
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
          <tr className="text-left text-xs">{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>{rows.map((r, k) => <tr key={k} className="border-t" style={{ borderColor: "var(--color-border)" }}>{r.map((c, i) => cell(c, i))}</tr>)}</tbody>
        {foot && <tfoot style={{ background: "var(--color-bg-subtle)" }}><tr className="border-t" style={{ borderColor: "var(--color-border)" }}>{foot.map((c, i) => cell(c, i, true))}</tr></tfoot>}
      </table>
    </div>
  );
}
