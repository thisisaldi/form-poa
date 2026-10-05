"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveKpiEvaluationAction, type Decision, type KpiScheme } from "@/app/actions/kpiDetail";
import { DECISION_LABEL, fmtDateTime, nf } from "./kpiFormat";

const fieldCls = "w-full rounded-md border px-3 py-2 text-sm";
const fieldStyle = { borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };
const labelCls = "mb-1 block text-xs font-semibold";

/**
 * Form Evaluasi Atasan (04-final-layout.md §5). Rekomendasi dihitung ulang di
 * server saat simpan — angka di sini hanya untuk hint. Dua klik untuk
 * konfirmasi; setelah tersimpan jadi tampilan read-only.
 */
export function KpiEvaluationForm({ scheme, nip, evaluatorName, rec, total, decision }: {
  scheme: KpiScheme;
  nip: string;
  evaluatorName: string;
  rec: { months: number; label: string } | null;
  total: number | null;
  decision: Decision | null;
}) {
  const router = useRouter();
  const [months, setMonths] = useState("");
  const [reason, setReason] = useState("");
  const [dev, setDev] = useState("");
  const [direction, setDirection] = useState("");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (decision) {
    const same = decision.systemMonths != null && decision.systemMonths === decision.months;
    return (
      <div className="space-y-4">
        <div className="rounded-md border p-4 font-semibold" style={{ background: "var(--color-green-light)", color: "#006B32", borderColor: "var(--color-border)" }}>
          ✓ Disetujui: perpanjangan {DECISION_LABEL[decision.months]} · {fmtDateTime(decision.at)}{decision.byName ? ` · ${decision.byName}` : ""}
          <div className="mt-0.5 text-xs font-normal">
            Rekomendasi sistem: {decision.systemMonths == null ? "belum tersedia" : DECISION_LABEL[decision.systemMonths]}
            {decision.systemMonths == null ? "" : same ? " · sesuai rekomendasi" : " · berbeda dari rekomendasi"}
          </div>
        </div>
        {[["Penjelasan keputusan", decision.reason], ["Evaluasi rencana pengembangan personil", decision.dev], ["Rasionalisasi perpanjangan ke direksi", decision.direction]].map(([l, v]) => (
          <div key={l}>
            <span className={labelCls} style={{ color: "var(--color-text-muted)" }}>{l}</span>
            <div className="min-h-9 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>{v || "—"}</div>
          </div>
        ))}
      </div>
    );
  }

  const hint = months === "" ? "" : rec && Number(months) === rec.months ? "Sesuai rekomendasi sistem." : "Berbeda dari rekomendasi: penjelasan wajib diisi.";

  function submit() {
    setError("");
    if (months === "") return setError("Pilih keputusan perpanjangan.");
    if ((!rec || Number(months) !== rec.months) && !reason.trim()) return setError("Keputusan berbeda dari rekomendasi: isi penjelasan keputusan.");
    if (!dev.trim()) return setError("Rencana pengembangan personil wajib diisi.");
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    start(async () => {
      const res = await saveKpiEvaluationAction({ scheme, nip, months: Number(months), reason, dev, direction });
      if (res.ok) router.refresh();
      else { setError(res.error); setArmed(false); }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label htmlFor="evDecision" className={labelCls} style={{ color: "var(--color-text-muted)" }}>Keputusan perpanjangan</label>
        <select id="evDecision" value={months} onChange={(e) => setMonths(e.target.value)} className={fieldCls} style={fieldStyle}>
          <option value="">Pilih durasi…</option>
          {[12, 9, 6, 0].map((m) => <option key={m} value={m}>{DECISION_LABEL[m]}{rec?.months === m ? " (rekomendasi)" : ""}</option>)}
        </select>
        <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-faint)" }}>{hint}</p>
      </div>
      <div className="self-end rounded-md border px-4 py-2.5" style={{ background: "var(--color-blue-light)", borderColor: "var(--color-border)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-blue)" }}>Rekomendasi sistem</div>
        <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{rec ? DECISION_LABEL[rec.months] : "Belum tersedia"}</div>
        <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{rec ? `${rec.label} · Point ${nf(total)}` : "Skor belum lengkap — keputusan wajib disertai penjelasan"}</div>
      </div>
      <div className="md:col-span-2">
        <label htmlFor="evBy" className={labelCls} style={{ color: "var(--color-text-muted)" }}>Penilai</label>
        <input id="evBy" value={evaluatorName} readOnly className={fieldCls} style={fieldStyle} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="evReason" className={labelCls} style={{ color: "var(--color-text-muted)" }}>Penjelasan keputusan</label>
        <textarea id="evReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className={fieldCls} style={fieldStyle}
          placeholder="Jelaskan alasan keputusan secara jelas dan logis. Wajib diisi bila keputusan berbeda dari rekomendasi." />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="evDev" className={labelCls} style={{ color: "var(--color-text-muted)" }}>Evaluasi rencana pengembangan personil (wajib)</label>
        <textarea id="evDev" value={dev} onChange={(e) => setDev(e.target.value)} rows={4} className={fieldCls} style={fieldStyle} placeholder="Rencana pengembangan untuk periode kontrak berikutnya." />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="evDir" className={labelCls} style={{ color: "var(--color-text-muted)" }}>Rasionalisasi perpanjangan ke direksi</label>
        <textarea id="evDir" value={direction} onChange={(e) => setDirection(e.target.value)} rows={4} className={fieldCls} style={fieldStyle} placeholder="Dilengkapi data dan fakta." />
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-blue)" }}
        >
          {pending ? "Menyimpan…" : armed ? "Klik lagi untuk konfirmasi" : "Setujui Perpanjangan"}
        </button>
        {error && <span className="text-xs" role="alert" style={{ color: "var(--color-error)" }}>{error}</span>}
      </div>
    </div>
  );
}
