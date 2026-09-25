"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";
import { decideNonHospitalEvaluationAction, saveNonHospitalMonthlyEntryAction } from "@/app/actions/nonHospitalEvaluation";
import type { NhEvalRow, NhMonthRow } from "@/lib/nonHospitalEvaluation";
import { TONE_STYLE, recommendationTone, scoreTone } from "./kpiUi";

type SortKey = "name" | "akhirKontrak" | "totalScore";
type StatusFilter = "ALL" | "COMPLETE" | "PROBLEM" | "UNDECIDED";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "Semua status" },
  { value: "COMPLETE", label: "Lengkap" },
  { value: "PROBLEM", label: "Bermasalah" },
  { value: "UNDECIDED", label: "Belum diputuskan" },
];
const TH_PLAIN = "text-left py-2.5 px-3 font-medium whitespace-nowrap";
const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const titleCase = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : "–");
function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}
function fmtMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_ID[m - 1]} ${y}`;
}
const rupiah = (n: number | null) => (n == null ? "–" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const pct = (n: number | null) => (n == null ? "–" : `${(n * 100).toFixed(1)}%`);
const decisionLabel = (s: string) => (s === "DISETUJUI" ? "Disetujui" : "Diubah");

function Pill({ tone, children }: { tone: keyof typeof TONE_STYLE; children: React.ReactNode }) {
  const t = TONE_STYLE[tone];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ color: t.fg, background: t.bg }}>
      {children}
    </span>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-pressed={active} onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        borderColor: active ? "var(--color-blue)" : "var(--color-border)",
        background: active ? "var(--color-blue-light)" : "var(--color-surface)",
        color: active ? "var(--color-blue)" : "var(--color-text-muted)",
      }}
    >
      {children}
    </button>
  );
}

/** Small monthly table used inside the drawer blocks. */
function MonthTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--color-bg-subtle)" }}>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-1.5 font-medium ${i === 0 ? "text-left" : "text-right"}`} style={{ color: "var(--color-text-faint)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ borderTop: "1px solid var(--color-border)" }}>
              {r.map((c, i) => (
                <td key={i} className={`px-3 py-1.5 tabular-nums ${i === 0 ? "text-left" : "text-right"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorBlock({ title, note, footer, children }: { title: string; note: string; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{note}</span>
      </div>
      {children}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{footer}</div>
    </section>
  );
}

function IndicatorFooter({ ind }: { ind: NhEvalRow["indicators"][number] }) {
  const tone = TONE_STYLE[scoreTone(ind.nilai)];
  return (
    <>
      <span>Real <b className="tabular-nums">{ind.realLabel}</b></span>
      <span>Nilai <b className="tabular-nums">{ind.nilai ?? "–"}</b></span>
      <span>Bobot <b className="tabular-nums">{Math.round(ind.weight * 100)}%</b></span>
      <span>Point Final <b className="tabular-nums" style={{ color: ind.score != null ? tone.fg : undefined }}>{ind.score ?? "–"}</b></span>
      {ind.nilaiNote && <span style={{ color: TONE_STYLE.warn.fg }}>⚠ {ind.nilaiNote}</span>}
    </>
  );
}

/** Monthly SC Menang / hari telat input (no automatic source yet — spec OQ-2/OQ-3). */
function MonthlyEntryEditor({ row, onSaved }: { row: NhEvalRow; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, { sc: string; telat: string }>>(() =>
    Object.fromEntries(row.months.map((m: NhMonthRow) => [m.period, { sc: m.sc?.toString() ?? "", telat: m.telat?.toString() ?? "" }]))
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    startTransition(async () => {
      setMsg(null);
      for (const m of row.months) {
        const v = vals[m.period];
        const res = await saveNonHospitalMonthlyEntryAction({
          nip: row.nip, period: m.period,
          scMenang: v.sc === "" ? null : Number(v.sc),
          absensiHariTelat: v.telat === "" ? null : Number(v.telat),
        });
        if (!res.ok) { setMsg(res.error); return; }
      }
      setMsg("Tersimpan");
      onSaved();
    });
  }

  const cell = "w-16 rounded-md border px-2 py-1 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1";
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">Input bulanan (SC Menang &amp; Absensi)</h4>
      <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--color-bg-subtle)" }}>
              <th className="px-3 py-1.5 text-left font-medium" style={{ color: "var(--color-text-faint)" }}>Bulan</th>
              <th className="px-3 py-1.5 text-right font-medium" style={{ color: "var(--color-text-faint)" }}>SC Menang</th>
              <th className="px-3 py-1.5 text-right font-medium" style={{ color: "var(--color-text-faint)" }}>Hari telat</th>
            </tr>
          </thead>
          <tbody>
            {row.months.map((m: NhMonthRow) => (
              <tr key={m.period} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="px-3 py-1.5">{fmtMonth(m.period)}</td>
                <td className="px-3 py-1.5 text-right">
                  <input type="number" min={0} max={31} className={cell} style={{ borderColor: "var(--color-border)" }} aria-label={`SC menang ${fmtMonth(m.period)}`}
                    value={vals[m.period].sc} onChange={(e) => setVals({ ...vals, [m.period]: { ...vals[m.period], sc: e.target.value } })} />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input type="number" min={0} max={31} className={cell} style={{ borderColor: "var(--color-border)" }} aria-label={`Hari telat ${fmtMonth(m.period)}`}
                    value={vals[m.period].telat} onChange={(e) => setVals({ ...vals, [m.period]: { ...vals[m.period], telat: e.target.value } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={save} loading={pending}>Simpan input bulanan</Button>
        {msg && <span className="text-xs" style={{ color: msg === "Tersimpan" ? TONE_STYLE.good.fg : TONE_STYLE.bad.fg }}>{msg}</span>}
      </div>
    </section>
  );
}

function DecisionSection({ row, onDone }: { row: NhEvalRow; onDone: () => void }) {
  const rec = row.recommendation?.months ?? null;
  const [months, setMonths] = useState<number>(rec ?? 6);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const differs = rec == null || months !== rec;

  if (row.decision) {
    const d = row.decision;
    return (
      <section className="space-y-2 rounded-md border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Keputusan</h4>
          <Pill tone={d.status === "DISETUJUI" ? "good" : "warn"}>{decisionLabel(d.status)} · {d.decisionMonths} bulan</Pill>
        </div>
        {d.decisionReason && <p className="text-xs"><b>Alasan:</b> {d.decisionReason}</p>}
        <p className="text-xs"><b>Rencana pengembangan:</b> {d.developmentPlanNotes}</p>
        <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          {d.decidedByName ?? "–"} · {new Date(d.decidedAt).toLocaleString("id-ID")}
        </p>
      </section>
    );
  }

  function submit() {
    startTransition(async () => {
      const res = await decideNonHospitalEvaluationAction({ contractId: row.contractId, decisionMonths: months, decisionReason: reason, developmentPlanNotes: plan });
      setConfirming(false);
      if (!res.ok) { setError(res.error); return; }
      onDone();
    });
  }

  function tryConfirm() {
    if (!plan.trim()) return setError("Rencana pengembangan wajib diisi");
    if (differs && !reason.trim()) return setError(rec == null ? "Alasan wajib diisi (skor belum bisa dihitung)" : "Alasan wajib diisi karena berbeda dari rekomendasi sistem");
    setError(null);
    setConfirming(true);
  }

  const field = "w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1";
  return (
    <section className="space-y-3 rounded-md border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Keputusan perpanjangan</h4>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {rec != null ? `Rekomendasi sistem: ${rec} bulan` : "Rekomendasi sistem belum tersedia"}
        </span>
      </div>
      <label className="block text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
        Keputusan (bulan)
        <select className={`${field} mt-1`} style={{ borderColor: "var(--color-border)" }} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[12, 9, 6, 0].map((m) => <option key={m} value={m}>{m === 0 ? "0 — tidak diperpanjang" : `${m} bulan`}</option>)}
        </select>
      </label>
      {differs && (
        <label className="block text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
          Alasan <span style={{ color: TONE_STYLE.bad.fg }}>*</span>
          <textarea className={`${field} mt-1`} style={{ borderColor: "var(--color-border)" }} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={rec == null ? "Mis. data belum lengkap, dievaluasi manual" : "Jelaskan mengapa berbeda dari rekomendasi sistem"} />
        </label>
      )}
      <label className="block text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
        Evaluasi rencana pengembangan personil <span style={{ color: TONE_STYLE.bad.fg }}>*</span>
        <textarea className={`${field} mt-1`} style={{ borderColor: "var(--color-border)" }} rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-xs" style={{ color: TONE_STYLE.bad.fg }}>{error}</p>}
      <Button onClick={tryConfirm}>{differs ? "Simpan Keputusan" : "Setujui Perpanjangan"}</Button>
      <ConfirmDialog
        open={confirming}
        tone="success"
        title={differs ? "Simpan keputusan?" : "Setujui perpanjangan?"}
        message={`${titleCase(row.name)} — ${months === 0 ? "tidak diperpanjang" : `diperpanjang ${months} bulan`}. Keputusan tidak dapat diubah setelah disimpan (koreksi dicatat sebagai keputusan baru).`}
        confirmLabel="Ya, simpan"
        confirmPending={pending}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function DetailDrawer({ row, onClose, onChanged }: { row: NhEvalRow; onClose: () => void; onChanged: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = TONE_STYLE[scoreTone(row.totalScore)];
  const ind = Object.fromEntries(row.indicators.map((i) => [i.key, i]));
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Detail skor ${row.name}`}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto shadow-xl" style={{ background: "var(--color-surface)" }}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div>
            <h3 className="text-base font-semibold">{titleCase(row.name)}</h3>
            <p className="text-xs tabular-nums" style={{ color: "var(--color-text-faint)" }}>{row.nip} · {titleCase(row.jabatan)} · {titleCase(row.cabang)}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Tutup" className="rounded-md px-2 py-1 text-lg leading-none hover:bg-[var(--color-bg-subtle)] focus-visible:outline-2">×</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Periode Kontrak", row.periodeBulan != null ? `${row.periodeBulan} bulan` : "–"],
              ["Akhir Kontrak", fmtDate(row.akhirKontrak)],
              ["Total Score", row.totalScore != null ? String(row.totalScore) : "–"],
              ["Rekomendasi", row.recommendation ? `${row.recommendation.months} bulan` : "–"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md p-2.5" style={{ background: "var(--color-bg-subtle)" }}>
                <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{k}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums" style={k === "Total Score" && row.totalScore != null ? { color: tone.fg } : undefined}>{v}</p>
              </div>
            ))}
          </div>

          <IndicatorBlock title="Achievement Target (Sales)" note="bobot 50%" footer={<IndicatorFooter ind={ind.sales} />}>
            <MonthTable head={["Bulan", "Target", "Sales", "ACH"]} rows={row.months.map((m) => [fmtMonth(m.period), rupiah(m.target), rupiah(m.sales), pct(m.ach)])} />
          </IndicatorBlock>
          <IndicatorBlock title="Jumlah Kunjungan" note={`bobot 25% · target ${row.visitTargetPerDay} visit/hari`} footer={<IndicatorFooter ind={ind.kunjungan} />}>
            <MonthTable head={["Bulan", "Jml Visit", "Hari Aktif", "ACH"]} rows={row.months.map((m) => [fmtMonth(m.period), m.visit ?? "–", m.hariAktif ?? "–", pct(m.achKunjungan)])} />
          </IndicatorBlock>
          <IndicatorBlock title="Jumlah SC Menang" note="bobot 15%" footer={<IndicatorFooter ind={ind.sc} />}>
            <MonthTable head={["Bulan", "SC Menang"]} rows={row.months.map((m) => [fmtMonth(m.period), m.sc ?? "–"])} />
          </IndicatorBlock>
          <IndicatorBlock title="Absensi" note="bobot 10% · hari telat/bulan" footer={<IndicatorFooter ind={ind.absensi} />}>
            <MonthTable head={["Bulan", "Hari Telat"]} rows={row.months.map((m) => [fmtMonth(m.period), m.telat ?? "–"])} />
          </IndicatorBlock>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Ringkasan Perhitungan KPI</h4>
            <MonthTable
              head={["Indikator", "Real", "Nilai", "Bobot", "Score"]}
              rows={[
                ...row.indicators.map((i) => [i.name, i.realLabel, i.nilai ?? "–", `${Math.round(i.weight * 100)}%`, i.score ?? "–"]),
                ["Total Score", "", "", "100%", row.totalScore ?? "–"],
              ]}
            />
          </section>

          {row.recommendation ? (
            <div className="rounded-md p-3 text-sm" style={{ background: TONE_STYLE[recommendationTone(row.recommendation.months)].bg, color: TONE_STYLE[recommendationTone(row.recommendation.months)].fg }}>
              <b>{row.recommendation.label}</b> — Total Score {row.totalScore}.
            </div>
          ) : (
            <div className="rounded-md p-3 text-sm" style={{ background: TONE_STYLE.none.bg, color: "var(--color-text-muted)" }}>
              Total Score belum dapat dihitung karena ada indikator yang belum bernilai.
            </div>
          )}
          {row.notes.length > 0 && (
            <div className="rounded-md border p-3 text-xs" style={{ borderColor: TONE_STYLE.warn.solid, background: TONE_STYLE.warn.bg, color: TONE_STYLE.warn.fg }}>
              <b>Catatan data:</b>
              <ul className="mt-1 list-disc pl-4">{row.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}

          <MonthlyEntryEditor row={row} onSaved={onChanged} />
          <DecisionSection row={row} onDone={onChanged} />
        </div>
      </aside>
    </div>
  );
}

export function NhEvalTable({ rows, akhirPeriod }: { rows: NhEvalRow[]; akhirPeriod: string }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey | null>("totalScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [jabatan, setJabatan] = useState("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);

  const jabatanOptions = useMemo(() => [...new Set(rows.map((r) => r.jabatan).filter((j): j is string => !!j))], [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (q && !`${r.name} ${r.nip} ${r.cabang ?? ""}`.toLowerCase().includes(q)) return false;
      if (jabatan !== "ALL" && r.jabatan !== jabatan) return false;
      if (status === "COMPLETE" && r.notes.length) return false;
      if (status === "PROBLEM" && !r.notes.length) return false;
      if (status === "UNDECIDED" && r.decision) return false;
      return true;
    });
    if (!sortKey) return list;
    return [...list].sort((a, b) => compareSortValues(a[sortKey] as string | number | null, b[sortKey] as string | number | null, sortDir));
  }, [rows, query, jabatan, status, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "totalScore" ? "desc" : "asc"); }
  }

  const open = openId ? rows.find((r) => r.contractId === openId) ?? null : null;

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada kontrak yang berakhir pada {fmtMonth(akhirPeriod)}. Data kontrak diimpor ADMIN
          (<code className="text-[11px]">scripts/importNonHospitalContracts.ts</code>).
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama, NIP, atau cabang…" aria-label="Cari personil"
            className="w-full rounded-md border px-3 py-1.5 text-sm sm:w-64 focus-visible:outline-2 focus-visible:outline-offset-1"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter jabatan">
            <FilterChip active={jabatan === "ALL"} onClick={() => setJabatan("ALL")}>Semua jabatan</FilterChip>
            {jabatanOptions.map((j) => <FilterChip key={j} active={jabatan === j} onClick={() => setJabatan(j)}>{titleCase(j)}</FilterChip>)}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter status">
            {STATUS_FILTERS.map((f) => <FilterChip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)}>{f.label}</FilterChip>)}
          </div>
          <p className="ml-auto text-xs tabular-nums" style={{ color: "var(--color-text-faint)" }} aria-live="polite">{visible.length} dari {rows.length} personil</p>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <p>Tidak ada personil yang cocok dengan filter.</p>
            <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setJabatan("ALL"); setStatus("ALL"); }}>Reset filter</Button>
          </div>
        ) : (
          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead className="sticky top-0 z-20" style={{ background: "var(--color-surface)", boxShadow: "0 1px 0 var(--color-border)" }}>
                <tr>
                  <SortableTh label="Personil" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" sticky />
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Jabatan</th>
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Cabang</th>
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <SortableTh label="Akhir Kontrak" sortKey="akhirKontrak" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" />
                  <SortableTh label="Total Score" sortKey="totalScore" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="left" />
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Rekomendasi</th>
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Keputusan</th>
                  <th className={TH_PLAIN} style={{ color: "var(--color-text-faint)" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const t = TONE_STYLE[scoreTone(r.totalScore)];
                  const cell = { borderBottom: "1px solid var(--color-border)" };
                  return (
                    <tr key={r.contractId} className="group hover:bg-[var(--color-bg-subtle)]">
                      <td className="sticky left-0 z-10 px-3 py-2.5 group-hover:bg-[var(--color-bg-subtle)]" style={{ background: "var(--color-surface)", borderRight: "1px solid var(--color-border)", ...cell }}>
                        <p className="max-w-[14rem] truncate text-[13px] font-medium">{titleCase(r.name)}</p>
                        <p className="tabular-nums" style={{ color: "var(--color-text-faint)" }}>{r.nip}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={cell}>
                        <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>{titleCase(r.jabatan)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={cell}>{titleCase(r.cabang)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums" style={cell}>{r.periodeBulan != null ? `${r.periodeBulan} bln` : "–"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums" style={cell}>{fmtDate(r.akhirKontrak)}</td>
                      <td className="px-3 py-2.5" style={cell}>
                        {r.totalScore != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--color-bg-subtle)" }} role="presentation">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, r.totalScore))}%`, background: t.solid }} />
                            </div>
                            <span className="w-12 text-[13px] font-semibold tabular-nums" style={{ color: t.fg }}>{r.totalScore.toFixed(2)}</span>
                          </div>
                        ) : <span style={{ color: "var(--color-text-faint)" }}>Belum lengkap</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={cell}>
                        {r.recommendation ? <Pill tone={recommendationTone(r.recommendation.months)}><b className="tabular-nums">{r.recommendation.months} bln</b></Pill> : <span style={{ color: "var(--color-text-faint)" }}>–</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={cell}>
                        {r.decision ? <Pill tone={r.decision.status === "DISETUJUI" ? "good" : "warn"}>{decisionLabel(r.decision.status)} · {r.decision.decisionMonths} bln</Pill> : <span style={{ color: "var(--color-text-faint)" }}>Belum</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={cell}>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setOpenId(r.contractId)} aria-label={`Detail skor ${r.name}`}
                            className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                            Detail Skor
                          </button>
                          {r.notes.length > 0 && <span title={r.notes.join("\n")} aria-label="Ada catatan data" style={{ color: TONE_STYLE.warn.fg }}>⚠</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <DetailDrawer row={open} onClose={() => setOpenId(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
