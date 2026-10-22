import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseKpiPersonil } from "@/lib/kpiAccess";
import { getHospitalBreakdown, getKpiPersonDetail, getKpiSubordinates, lastCompletedPeriod, type Breakdown, type DetailMonth, type KpiScheme, type PersonDetail } from "@/app/actions/kpiDetail";
import { Card } from "@/components/ui/Card";
import { KpiEvaluationForm } from "@/components/kpi/KpiEvaluationForm";
import { KpiDetailKeys } from "@/components/kpi/KpiDetailKeys";
import { periodLabel, roleLabel } from "@/components/kpi/kpiUi";
import { STEP_LABEL } from "@/lib/kpiApproval";
import { DECISION_LABEL, bandOf, fmtDate, fmtDateTime, initials, nf, pct, rp, titleCase } from "@/components/kpi/kpiFormat";

export const metadata = { title: "Kartu KPI Personil · Form POA" };

type Col<T> = { head: string; cell: (m: T) => React.ReactNode; num?: boolean };

export default async function KpiDetailCardPage({
  params, searchParams,
}: { params: Promise<{ nip: string }>; searchParams: Promise<Record<string, string>> }) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!["ADMIN", "SD", "ASM", "SM", "NSM"].filter(canUseKpiPersonil).includes(session.role)) redirect("/dashboard");

  const { nip } = await params;
  const sp = await searchParams;
  const scheme: KpiScheme = sp.scheme === "non-hospital" ? "non-hospital" : "hospital";
  const period = sp.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : await lastCompletedPeriod();

  // Independent reads, started together (the sibling list alone is ~7s for ADMIN).
  const personNip = decodeURIComponent(nip);
  const [detail, breakdown, siblings] = await Promise.all([
    getKpiPersonDetail(scheme, personNip),
    scheme === "hospital" ? getHospitalBreakdown(personNip) : Promise.resolve(null),
    getKpiSubordinates(scheme, period),
  ]);
  if (!detail) notFound(); // bukan bawahan langsung / tidak ada

  const absMonth = sp.absMonth && detail.months.some((m) => m.period === sp.absMonth) ? sp.absMonth : detail.window.end;

  // Urutan prev/next = urutan daftar bawahan di halaman sebelumnya.
  const order = siblings.map((r) => r.nip);
  const i = order.indexOf(detail.nip);
  const q = `scheme=${scheme}&period=${period}`;
  const href = (n: string) => `/kpi-detail/${n}?${q}`;
  const prev = i > 0 ? href(order[i - 1]) : null;
  const next = i >= 0 && i < order.length - 1 ? href(order[i + 1]) : null;
  const back = `/kpi-detail?${q}`;
  const hosp = scheme === "hospital";

  const jumps: [string, string][] = hosp
    ? [["profil", "Profil"], ["rekap", "Rekap Bulanan"], ["sales", "Sales"], ["call", "Call Activity"], ["customer", "Customer Aktif"], ["absensi", "Absensi"], ["evaluasi", "Evaluasi & Approval"]]
    : [["profil", "Profil"], ["rekap", "Rekap Bulanan"], ["evaluasi", "Evaluasi & Approval"]];

  return (
    <div className="space-y-4 scroll-smooth">
      <KpiDetailKeys back={back} prev={prev} next={next} />

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
        <Link href={back} className="rounded-md border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--color-border)" }}>← Daftar bawahan</Link>
        <span className="flex-1" />
        <a href={`/api/kpi-personil/export?${q}&nip=${detail.nip}`} className="rounded-md border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--color-border)" }}>Export Excel · kartu ini</a>
        <a href={`/api/kpi-personil/approval-pdf?scheme=${scheme}&nip=${detail.nip}`} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--color-blue)", color: "#fff" }}>Unduh Form Approval (PDF)</a>
        {i >= 0 && <span className="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>{i + 1} / {order.length}</span>}
        <NavBtn href={prev}>‹ Sebelumnya</NavBtn>
        <NavBtn href={next}>Berikutnya ›</NavBtn>
      </div>

      <nav aria-label="Bagian kartu" className="flex gap-0.5 overflow-x-auto rounded-md border px-2" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
        {jumps.map(([id, label]) => <a key={id} href={`#sec-${id}`} className="whitespace-nowrap px-3 py-2.5 text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>{label}</a>)}
      </nav>

      <Profile d={detail} hosp={hosp} b={breakdown} />

      {hosp ? <HospitalSections d={detail} b={breakdown} absMonth={absMonth} q={q} /> : <NonHospitalSections d={detail} />}

      <Section id="evaluasi" title="Evaluasi & Approval"
        desc="Keputusan perpanjangan, rencana pengembangan, dan rasionalisasi ke direksi diisi penilai berdasarkan data di atas, lalu disetujui sesuai rantai approval."
        legend="Rekomendasi dari Point final: >85 = 12 bulan · 71–85 = 9 · 55–70 = 6 · <55 = tidak diperpanjang. Keputusan akhir tetap di tangan atasan.">
        <KpiEvaluationForm scheme={scheme} nip={detail.nip} evaluator={detail.evaluator} evaluatorName={`${session.name} · ${session.role}`} rec={detail.rec} total={detail.avg.total}
          decision={detail.decision} chain={detail.chain} status={detail.status} fullyApproved={detail.fullyApproved} act={detail.act} />
      </Section>
    </div>
  );
}

function NavBtn({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "rounded-md border px-3 py-1.5 text-sm font-semibold";
  return href
    ? <Link href={href} className={cls} style={{ borderColor: "var(--color-border)" }}>{children}</Link>
    : <span className={`${cls} opacity-50`} style={{ borderColor: "var(--color-border)" }} aria-disabled="true">{children}</span>;
}

function Section({ id, title, desc, src, legend, point, children }: { id: string; title: string; desc?: string; src?: string; legend?: string; point?: [number | null, number]; children: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-20">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {desc && <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{desc}</p>}
            {src && <p className="mt-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{src}</p>}
          </div>
          {point && (
            <div className="text-right">
              <div className="text-3xl font-bold leading-tight tabular-nums">{nf(point[0])}<small className="text-sm font-normal" style={{ color: "var(--color-text-faint)" }}> / {point[1]}</small></div>
              <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Point final</div>
            </div>
          )}
        </div>
        <div className="mt-4">{children}</div>
        {legend && <p className="mt-3 text-[11px]" style={{ color: "var(--color-text-faint)" }}>{legend}</p>}
      </Card>
    </section>
  );
}

function Table<T>({ rows, cols, foot }: { rows: T[]; cols: Col<T>[]; foot?: React.ReactNode }) {
  return (
    <div className="overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
      <table className="w-full text-sm">
        <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
          <tr className="text-xs">{cols.map((c) => <th key={c.head} className={`whitespace-nowrap px-3 py-2 ${c.num ? "text-right" : "text-left"}`}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-t" style={{ borderColor: "var(--color-border)" }}>
              {cols.map((c) => <td key={c.head} className={`whitespace-nowrap px-3 py-2 ${c.num ? "text-right tabular-nums" : ""}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">{foot}</tfoot>}
      </table>
    </div>
  );
}

function Chip({ score }: { score: number | null }) {
  const b = bandOf(score);
  if (!b) return <>–</>;
  const tone = b === "ST" ? ["var(--color-green-light)", "#006B32"] : b === "T" ? ["var(--color-blue-light)", "var(--color-blue)"]
    : b === "S" ? ["var(--color-bg-subtle)", "var(--color-text-muted)"] : b === "R" ? ["var(--color-warning-bg)", "#7A5A12"] : ["var(--color-error-bg)", "var(--color-error)"];
  return <span className="inline-block min-w-8 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold" style={{ background: tone[0], color: tone[1] }}>{b}</span>;
}

const Src = ({ s }: { s: string | null }) => (
  <span className="rounded px-1.5 py-0.5 text-[11px]" style={s === "MANUAL" ? { background: "var(--color-warning-bg)", color: "#7A5A12" } : { background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>{s ?? "–"}</span>
);

function Profile({ d, hosp, b }: { d: PersonDetail; hosp: boolean; b: Breakdown | null }) {
  const info: [string, string][] = [
    ["Penilai (atasan)", d.chain.find((c) => c.step === d.evaluator)?.name ?? "–"],
    ["Atasan langsung", d.atasanName ?? "–"],
    ["Rantai approval", d.chain.map((c) => STEP_LABEL[c.step]).join(" → ")],
    ["Join date", fmtDate(d.tglMasuk)],
    ["Periode evaluasi", `${periodLabel(d.window.start)} – ${periodLabel(d.window.end)} (${d.months.length} bulan terakhir)`],
    ...(hosp ? [["Standar kunjungan", `${d.months.find((m) => m.h)?.h?.callStandar ?? "–"} / bulan`] as [string, string], [b?.salesKind === "mr" ? "MR/SPV di bawahnya" : "Outlet dikelola", b ? String(b.salesUnits.length) : "–"] as [string, string]] : [["Wilayah (GT)", d.area ?? "–"] as [string, string], ["Akhir kontrak", fmtDate(d.akhirKontrak)] as [string, string]]),
  ];
  return (
    <section id="sec-profil" className="scroll-mt-20">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 pb-4" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-3.5">
            <div className="grid h-14 w-14 place-items-center rounded-full text-xl font-bold" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>{initials(d.name)}</div>
            <div>
              <h2 className="text-2xl font-bold">{titleCase(d.name)}</h2>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{d.nip} · {roleLabel(d.role, d.jabatan)}{d.area ? ` · ${d.area}` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-full px-2 py-0.5" style={{ background: d.avg.complete === d.months.length ? "var(--color-green-light)" : "var(--color-warning-bg)" }}>Data lengkap {d.avg.complete}/{d.months.length} bulan</span>
                <span className="rounded-full px-2 py-0.5" style={{ background: "var(--color-bg-subtle)" }}>Rekomendasi {d.rec ? DECISION_LABEL[d.rec.months] : "belum tersedia"}</span>
                {d.decision && <span className="rounded-full px-2 py-0.5" style={d.fullyApproved ? { background: "var(--color-green-light)", color: "#006B32" } : { background: "var(--color-warning-bg)", color: "#7A5A12" }}>{d.fullyApproved ? `✓ Disetujui lengkap ${DECISION_LABEL[d.decision.months]}` : d.status}</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold leading-none tabular-nums">{nf(d.avg.total)}<small className="text-base font-normal" style={{ color: "var(--color-text-faint)" }}> / 100</small></div>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Point final · {periodLabel(d.window.start)} – {periodLabel(d.window.end)}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {info.map(([k, v]) => (
            <div key={k}><dt className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        {!hosp && <p className="mt-4 rounded-md px-3 py-2 text-xs" style={{ background: "var(--color-warning-bg)", color: "#7A5A12" }}>Band nilai SC Menang dan Absensi Non-Hospital belum dikonfirmasi (OQ-2/OQ-3), jadi Point total belum bisa dihitung. Data mentah per bulan tetap ditampilkan; keputusan wajib disertai penjelasan.</p>}
      </Card>
    </section>
  );
}

function HospitalSections({ d, b, absMonth, q }: { d: PersonDetail; b: Breakdown | null; absMonth: string; q: string }) {
  type M = DetailMonth & { h: NonNullable<DetailMonth["h"]> };
  const ms = d.months.filter((m): m is M => m.h != null);
  const lbl = (m: DetailMonth) => <b>{periodLabel(m.period)}</b>;
  const short = (p: string) => periodLabel(p).split(" ")[0].slice(0, 3);
  const pts = (m: DetailMonth, k: "salesScore" | "callScore" | "customerScore" | "absensiScore", w: number) => {
    const v = m.h?.[k];
    return v == null ? null : v * w;
  };
  const aver = (f: (m: DetailMonth) => number | null | undefined) => {
    const v = d.months.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };

  // Absensi per month from the daily records (same formula as the score: Σ jam telat ÷ record).
  const abs = b?.absensi ?? [];
  const absRows = abs.map((a, i) => {
    if (!a) return { period: d.months[i].period, ok: false as const };
    const tot = a.days.reduce((s, x) => s + x.jam, 0);
    return { period: a.period, ok: true as const, recs: a.days.length, late: a.days.filter((x) => x.telat).length, tot, avg: a.days.length ? tot / a.days.length : null };
  });
  const sel = abs.find((a) => a?.period === absMonth) ?? null;
  const selTot = sel ? sel.days.reduce((s, x) => s + x.jam, 0) : 0;

  return (
    <>
      <Section id="rekap" title="Rekap bulanan" desc="Satu baris per bulan dalam window evaluasi. Point final dihitung dari baris-baris ini."
        legend="Band: SR = 40 · R = 55 · S = 70 · T = 85 · ST = 100. Point = nilai band × bobot.">
        <div className="overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              <tr className="text-xs">
                <th rowSpan={2} className="px-3 py-2 text-left">Bulan</th>
                <th colSpan={5} className="border-l px-3 py-1.5 text-center" style={{ borderColor: "var(--color-border)" }}>Sales Achievement (50%)</th>
                <th colSpan={4} className="border-l px-3 py-1.5 text-center" style={{ borderColor: "var(--color-border)" }}>Call Activity (25%)</th>
                <th colSpan={3} className="border-l px-3 py-1.5 text-center" style={{ borderColor: "var(--color-border)" }}>Customer Aktif (15%)</th>
                <th colSpan={3} className="border-l px-3 py-1.5 text-center" style={{ borderColor: "var(--color-border)" }}>Absensi (10%)</th>
                <th rowSpan={2} className="border-l px-3 py-2 text-right" style={{ borderColor: "var(--color-border)" }}>Total Point</th>
              </tr>
              <tr className="text-xs">
                {["Target", "Aktual", "%", "Band", "Point", "Real/Std", "%", "Band", "Point", "Jumlah", "Band", "Point", "Reporting", "Band", "Point"].map((h, k) => (
                  <th key={k} className={`whitespace-nowrap px-3 py-1.5 ${[0, 5, 9, 12].includes(k) ? "border-l" : ""} ${["Band"].includes(h) ? "text-left" : "text-right"}`} style={{ borderColor: "var(--color-border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.months.map((m) => (
                <tr key={m.period} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="whitespace-nowrap px-3 py-2">{lbl(m)}</td>
                  <td className="border-l px-3 py-2 text-right tabular-nums" style={{ borderColor: "var(--color-border)" }}>{rp(m.h?.salesTarget)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rp(m.h?.salesActual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(m.h?.salesPct)}</td>
                  <td className="px-3 py-2"><Chip score={m.h?.salesScore ?? null} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{nf(pts(m, "salesScore", 0.5))}</td>
                  <td className="border-l px-3 py-2 text-right tabular-nums" style={{ borderColor: "var(--color-border)" }}>{m.h?.callReal ?? "–"}/{m.h?.callStandar ?? "–"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(m.h?.callPct, 0)}</td>
                  <td className="px-3 py-2"><Chip score={m.h?.callScore ?? null} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{nf(pts(m, "callScore", 0.25))}</td>
                  <td className="border-l px-3 py-2 text-right tabular-nums" style={{ borderColor: "var(--color-border)" }}>{m.h?.customer ?? "–"}</td>
                  <td className="px-3 py-2"><Chip score={m.h?.customerScore ?? null} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{nf(pts(m, "customerScore", 0.15))}</td>
                  <td className="border-l px-3 py-2 text-right tabular-nums" style={{ borderColor: "var(--color-border)" }}>{nf(m.h?.absensi)}</td>
                  <td className="px-3 py-2"><Chip score={m.h?.absensiScore ?? null} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{nf(pts(m, "absensiScore", 0.1))}</td>
                  <td className="border-l px-3 py-2 text-right font-bold tabular-nums" style={{ borderColor: "var(--color-border)" }}>{nf(m.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">
              <tr>
                <td className="px-3 py-2">Point final</td><td /><td />
                <td className="px-3 py-2 text-right tabular-nums">{pct(aver((m) => m.h?.salesPct))}</td><td />
                <td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.sales)}</td><td />
                <td className="px-3 py-2 text-right tabular-nums">{pct(aver((m) => m.h?.callPct), 0)}</td><td />
                <td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.activity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(aver((m) => m.h?.customer), 1)}</td><td />
                <td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.customer)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(aver((m) => m.h?.absensi))}</td><td />
                <td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.absensi)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section id="sales" point={[d.avg.sales, 50]} title="Sales Achievement · 50%"
        desc={b?.salesKind === "mr" ? "Total penjualan seluruh MR/SPV di bawahnya dibanding total target mereka." : "Penjualan aktual seluruh outlet yang dikelola dibanding target GT."}
        src="Sumber: TargetHospitalValue (target) · OutletSalesValueMonthly (aktual, sync DIR10001B)"
        legend="Achievement = total aktual ÷ target × 100. Band: <80 SR · 80–89 R · 90–99 S · 100–109 T · ≥110 ST. “–” = outlet tidak ditugaskan pada bulan itu.">
        <div className="overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              <tr className="text-xs">
                <th className="px-3 py-2 text-left">{b?.salesKind === "mr" ? "MR/SPV" : "Outlet"}</th>
                {d.months.map((m) => <th key={m.period} className="px-3 py-2 text-right">{short(m.period)}</th>)}
                <th className="border-l px-3 py-2 text-right" style={{ borderColor: "var(--color-border)" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(b?.salesUnits ?? []).map((u) => (
                <tr key={u.sub} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-3 py-2">{u.label}<span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{u.sub}</span></td>
                  {u.v.map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{v == null ? "–" : rp(v)}</td>)}
                  <td className="whitespace-nowrap border-l px-3 py-2 text-right font-bold tabular-nums" style={{ borderColor: "var(--color-border)" }}>{rp(u.v.reduce<number>((s, x) => s + (x ?? 0), 0))}</td>
                </tr>
              ))}
              {(b?.salesUnits.length ?? 0) === 0 && <tr><td colSpan={d.months.length + 2} className="px-3 py-4 text-center" style={{ color: "var(--color-text-faint)" }}>Tidak ada penugasan outlet pada window ini</td></tr>}
            </tbody>
            <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">
              {([
                ["Total aktual", (m: M) => rp(m.h.salesActual), rp(ms.reduce((s, m) => s + m.h.salesActual, 0))],
                ["Target", (m: M) => rp(m.h.salesTarget), rp(ms.reduce((s, m) => s + m.h.salesTarget, 0))],
                ["Achievement", (m: M) => pct(m.h.salesPct), pct(ms.reduce((s, m) => s + m.h.salesTarget, 0) > 0 ? (ms.reduce((s, m) => s + m.h.salesActual, 0) / ms.reduce((s, m) => s + m.h.salesTarget, 0)) * 100 : null)],
              ] as [string, (m: M) => string, string][]).map(([l, f, t]) => (
                <tr key={l}><td className="px-3 py-2">{l}</td>{d.months.map((m) => <td key={m.period} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.h ? f(m as M) : "–"}</td>)}<td className="whitespace-nowrap border-l px-3 py-2 text-right tabular-nums" style={{ borderColor: "var(--color-border)" }}>{t}</td></tr>
              ))}
              <tr><td className="px-3 py-2">Band · Point</td>{d.months.map((m) => <td key={m.period} className="whitespace-nowrap px-3 py-2 text-right">{bandOf(m.h?.salesScore ?? null) ?? "–"} · {nf(pts(m, "salesScore", 0.5))}</td>)}<td className="border-l px-3 py-2 text-right" style={{ borderColor: "var(--color-border)" }}>final {nf(d.avg.sales)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section id="call" point={[d.avg.activity, 25]} title="Call Activity · 25%" desc="Realisasi kunjungan dibanding standar kunjungan."
        src="Sumber: Exodus Activity “Get Count Visit By NIP” (sync) · input manual ADMIN menimpa hasil sync"
        legend={`Achievement = realisasi ÷ standar × 100. Band: <70 SR · 70–79 R · 80–89 S · 90–99 T · ≥100 ST. Standar ${ms[0]?.h.callStandar ?? "–"} kunjungan adalah asumsi kerja dari memo.`}>
        <Table rows={ms} cols={[
          { head: "Bulan", cell: lbl }, { head: "Standar", num: true, cell: (m) => m.h.callStandar }, { head: "Realisasi", num: true, cell: (m) => m.h.callReal ?? "–" },
          { head: "Achievement", num: true, cell: (m) => pct(m.h.callPct, 0) }, { head: "Band", cell: (m) => <Chip score={m.h.callScore} /> },
          { head: "Point", num: true, cell: (m) => <b>{nf(pts(m, "callScore", 0.25))}</b> }, { head: "Sumber", cell: (m) => <Src s={m.h.callSource} /> },
          { head: "Diinput oleh", cell: (m) => m.h.callInputBy ?? (m.h.callSource ? "Sistem" : "–") }, { head: "Waktu", cell: (m) => (m.h.callInputAt ? fmtDateTime(m.h.callInputAt) : "–") },
        ]} foot={<tr><td className="px-3 py-2">Final</td><td className="px-3 py-2 text-right">{ms[0]?.h.callStandar ?? "–"}</td><td className="px-3 py-2 text-right tabular-nums">{nf(aver((m) => m.h?.callReal), 1)}</td><td className="px-3 py-2 text-right tabular-nums">{pct(aver((m) => m.h?.callPct), 0)}</td><td /><td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.activity)}</td><td colSpan={3} /></tr>} />
      </Section>

      <Section id="customer" point={[d.avg.customer, 15]} title="Customer Aktif (PS/SP) · 15%"
        desc={b?.custUnits ? "Rata-rata jumlah customer aktif seluruh MR/SPV di bawahnya, bukan hitungan langsung milik sendiri." : "Kontrak PSSP aktif pada outlet yang dikelola. Kontrak dihitung aktif selama bulan itu berada di antara bulan mulai dan berakhir."}
        src="Sumber: PsspKontrak · seluruh kontrak aktif dihitung tanpa filter jenis PS/SP"
        legend="Band: <6 SR · 6–8 R · 9–11 S · 12–14 T · ≥15 ST. Baris “Dipakai penilaian” adalah angka yang masuk skor; bisa berbeda dari hitungan matriks karena skor memakai kontrak yang aktif saat ini.">
        {b?.pssp && (
          <div className="overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                <tr className="text-xs">
                  {["Kode", "Customer", "Outlet", "PSSP mulai", "PSSP berakhir"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left">{h}</th>)}
                  {d.months.map((m) => <th key={m.period} className="border-l px-3 py-2 text-center" style={{ borderColor: "var(--color-border)" }}>{short(m.period)}</th>)}
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {b.pssp.map((c) => (
                  <tr key={`${c.kdCust}${c.prdAwal}${c.prdAkhir}${c.kdOutlet}`} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-3 py-2">{c.kdCust}</td>
                    <td className="px-3 py-2">{c.nmCust}{c.nmSpc && <span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{c.nmSpc}</span>}</td>
                    <td className="px-3 py-2">{c.nmOutlet ?? c.kdOutlet ?? "–"}</td>
                    <td className="px-3 py-2">{c.prdAwal}</td><td className="px-3 py-2">{c.prdAkhir}</td>
                    {c.active.map((a, i) => <td key={i} className="border-l px-3 py-2 text-center" style={{ borderColor: "var(--color-border)", color: a ? "var(--color-green)" : "var(--color-text-faint)", fontWeight: a ? 700 : 400 }}>{a ? "✓" : "–"}</td>)}
                    <td className="whitespace-nowrap px-3 py-2">{c.status}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">
                <tr><td colSpan={5} className="px-3 py-2">Aktif menurut matriks</td>{d.months.map((m, i) => <td key={m.period} className="border-l px-3 py-2 text-center" style={{ borderColor: "var(--color-border)" }}>{b.pssp!.filter((c) => c.active[i]).length}</td>)}<td /></tr>
                <tr><td colSpan={5} className="px-3 py-2">Dipakai penilaian · Band · Point</td>{d.months.map((m) => <td key={m.period} className="whitespace-nowrap border-l px-3 py-2 text-center" style={{ borderColor: "var(--color-border)" }}>{m.h?.customer ?? "–"} · {bandOf(m.h?.customerScore ?? null) ?? "–"} · {nf(pts(m, "customerScore", 0.15))}</td>)}<td className="px-3 py-2">final {nf(d.avg.customer)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
        {b?.custUnits && (
          <div className="overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                <tr className="text-xs"><th className="px-3 py-2 text-left">MR/SPV</th>{d.months.map((m) => <th key={m.period} className="px-3 py-2 text-right">{short(m.period)}</th>)}</tr>
              </thead>
              <tbody>
                {b.custUnits.map((u) => (
                  <tr key={u.sub} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="px-3 py-2">{u.label}<span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{u.sub}</span></td>
                    {u.v.map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{v}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">
                <tr><td className="px-3 py-2">Rata-rata (dibulatkan) → dipakai</td>{d.months.map((m) => <td key={m.period} className="px-3 py-2 text-right">{m.h?.customer ?? "–"}</td>)}</tr>
                <tr><td className="px-3 py-2">Band · Point</td>{d.months.map((m) => <td key={m.period} className="whitespace-nowrap px-3 py-2 text-right">{bandOf(m.h?.customerScore ?? null) ?? "–"} · {nf(pts(m, "customerScore", 0.15))}</td>)}</tr>
              </tfoot>
            </table>
          </div>
        )}
        {!b?.pssp && !b?.custUnits && <Table rows={ms} cols={[{ head: "Bulan", cell: lbl }, { head: "Customer aktif", num: true, cell: (m) => m.h.customer }, { head: "Band", cell: (m) => <Chip score={m.h.customerScore} /> }]} />}
      </Section>

      <Section id="absensi" point={[d.avg.absensi, 10]} title="Kepatuhan Absensi (Reporting) · 10%"
        desc="Rata-rata jam keterlambatan terhadap deadline 08:00 WIB, dihitung dari seluruh record kehadiran bulan itu."
        src="Sumber: SIPP Trade Marketing get=absensi (AbsDateIn, AbsTelatYN), dibaca langsung saat kartu dibuka"
        legend="Jam telat = max(0, jam check-in − 08:00) untuk record bertanda telat; record tepat waktu dihitung 0. Band: >2 SR · 1–2 R · 0,5–1 S · 0–0,5 T · 0 ST.">
        <Table rows={d.months} cols={[
          { head: "Bulan", cell: lbl },
          { head: "Record", num: true, cell: (m) => { const r = absRows.find((x) => x.period === m.period); return r?.ok ? r.recs : "–"; } },
          { head: "Hari telat", num: true, cell: (m) => { const r = absRows.find((x) => x.period === m.period); return r?.ok ? r.late : "–"; } },
          { head: "Total jam telat", num: true, cell: (m) => { const r = absRows.find((x) => x.period === m.period); return r?.ok ? nf(r.tot) : "–"; } },
          { head: "Reporting (nilai skor)", num: true, cell: (m) => <b>{nf(m.h?.absensi)}</b> },
          { head: "Band", cell: (m) => <Chip score={m.h?.absensiScore ?? null} /> }, { head: "Point", num: true, cell: (m) => <b>{nf(pts(m, "absensiScore", 0.1))}</b> },
          { head: "Sumber", cell: (m) => <Src s={m.h?.absensiSource ?? null} /> },
        ]} foot={<tr><td className="px-3 py-2">Final</td><td colSpan={3} /><td className="px-3 py-2 text-right tabular-nums">{nf(aver((m) => m.h?.absensi))}</td><td /><td className="px-3 py-2 text-right tabular-nums">{nf(d.avg.absensi)}</td><td /></tr>} />

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>Record kehadiran harian</h3>
        <div className="mb-3 flex flex-wrap overflow-hidden rounded-md border" style={{ borderColor: "var(--color-border)", width: "fit-content", maxWidth: "100%" }}>
          {d.months.map((m) => (
            <a key={m.period} href={`?${q}&absMonth=${m.period}#sec-absensi`} className="px-3 py-1.5 text-sm"
              style={m.period === absMonth ? { background: "var(--color-blue)", color: "#fff" } : { background: "var(--color-surface)", color: "var(--color-text-muted)" }}>
              {periodLabel(m.period).split(" ")[0]}
            </a>
          ))}
        </div>
        {sel ? (
          <div className="max-h-96 overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                <tr className="text-xs"><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Hari</th><th className="px-3 py-2 text-right">Check-in</th><th className="px-3 py-2 text-left">Telat (Y/N)</th><th className="px-3 py-2 text-right">Jam telat</th></tr>
              </thead>
              <tbody>
                {sel.days.map((x, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)", color: x.telat ? "var(--color-error)" : undefined }}>
                    <td className="px-3 py-1.5">{x.iso.split("-").reverse().join("/")}</td><td className="px-3 py-1.5">{x.hari}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{String(Math.floor(x.min / 60)).padStart(2, "0")}:{String(x.min % 60).padStart(2, "0")}</td>
                    <td className="px-3 py-1.5">{x.telat ? "Y" : "N"}</td><td className="px-3 py-1.5 text-right tabular-nums">{nf(x.jam)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: "var(--color-bg-subtle)" }} className="font-bold">
                <tr><td colSpan={3} className="px-3 py-2">{sel.days.length} record · {sel.days.filter((x) => x.telat).length} telat</td><td className="px-3 py-2">Σ jam telat</td><td className="px-3 py-2 text-right tabular-nums">{nf(selTot)}</td></tr>
                <tr><td colSpan={3} className="px-3 py-2">Rata-rata = {nf(selTot)} ÷ {sel.days.length}</td><td className="px-3 py-2">Reporting</td><td className="px-3 py-2 text-right tabular-nums">{sel.days.length ? nf(selTot / sel.days.length) : "–"}</td></tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="rounded-md px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
            Record harian bulan ini tidak tersedia (SIPP tidak terjangkau atau PTID personil belum terpetakan). Nilai skor di atas tetap dari data tersimpan.
          </p>
        )}
      </Section>
    </>
  );
}

function NonHospitalSections({ d }: { d: PersonDetail }) {
  type M = DetailMonth & { n: NonNullable<DetailMonth["n"]> };
  const ms = d.months.filter((m): m is M => m.n != null);
  const notes = [...new Set(ms.flatMap((m) => m.n.notes))];
  return (
    <>
      <Section id="rekap" title="Rekap bulanan" desc="Data mentah per bulan: Achievement Target 50% · Kunjungan 25% · SC Menang 15% · Absensi 10%."
        src="Sumber: TargetNonHospitalValue · OutletSalesValueMonthlyOmega · Exodus kunjungan · SC Menang & Absensi (sync/input)"
        legend="ACH kunjungan = visit ÷ (hari aktif × 12). Absensi = jumlah hari telat.">
        <Table rows={ms} cols={[
          { head: "Bulan", cell: (m) => <b>{periodLabel(m.period)}</b> },
          { head: "Target", num: true, cell: (m) => rp(m.n.target) }, { head: "Sales", num: true, cell: (m) => rp(m.n.sales) }, { head: "ACH Sales", num: true, cell: (m) => pct(m.n.ach == null ? null : m.n.ach * 100) },
          { head: "Visit", num: true, cell: (m) => m.n.visit ?? "–" }, { head: "Hari aktif", num: true, cell: (m) => m.n.hariAktif ?? "–" }, { head: "ACH Kunjungan", num: true, cell: (m) => pct(m.n.achKunjungan == null ? null : m.n.achKunjungan * 100) },
          { head: "SC Menang", num: true, cell: (m) => m.n.sc ?? "–" }, { head: "Hari telat", num: true, cell: (m) => m.n.telat ?? "–" },
        ]} />
      </Section>
      {notes.length > 0 && (
        <div className="rounded-md px-3 py-2 text-xs" style={{ background: "var(--color-warning-bg)", color: "#7A5A12" }}><b>Catatan data:</b> {notes.join("; ")}</div>
      )}
    </>
  );
}
