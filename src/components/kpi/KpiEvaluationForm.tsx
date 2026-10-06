"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveKpiStepAction, saveKpiEvaluationAction, type Decision, type KpiScheme } from "@/app/actions/kpiDetail";
import { STEP_LABEL, type Action, type ApprovalStep } from "@/lib/kpiApproval";
import { DECISION_LABEL, fmtDateTime, nf } from "./kpiFormat";

const fieldCls = "w-full rounded-md border px-3 py-2 text-sm";
const fieldStyle = { borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };
const labelCls = "mb-1 block text-xs font-semibold";
const muted = { color: "var(--color-text-muted)" };

type Chain = { step: ApprovalStep; name: string | null; approvedBy: string | null }[];

/** Two-click confirm shared by "save evaluation" and "approve" (3s window). */
function useArm() {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    armed,
    arm: () => { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 3000); },
    reset: () => setArmed(false),
  };
}

/** Rantai approval: satu kotak per langkah (mockup `.chain`). */
function ChainPanel({ chain, decision }: { chain: Chain; decision: Decision | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-stretch gap-2">
      {chain.map((c, i) => {
        const done = decision?.steps[c.step];
        return (
          <div key={c.step} className="flex min-w-44 flex-1 items-center gap-2">
            {i > 0 && <span aria-hidden="true" style={{ color: "var(--color-text-faint)" }}>→</span>}
            <div className="flex-1 rounded-md border px-3.5 py-2.5" style={{ background: done ? "var(--color-green-light)" : "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={muted}>{i + 1}. {STEP_LABEL[c.step]}</div>
              <div className="font-semibold">{c.name ?? c.approvedBy ?? "—"}</div>
              <div className="text-xs" style={{ color: done ? "#006B32" : "var(--color-text-muted)" }}>
                {done ? `✓ Disetujui ${fmtDateTime(done.at)}${c.approvedBy && c.name && c.approvedBy !== c.name ? ` · oleh ${c.approvedBy}` : ""}` : decision ? "Menunggu approval" : "Menunggu evaluasi"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Evaluasi & Approval (04-final-layout.md §5, §9). Rekomendasi, hak akses, dan
 * langkah yang berlaku dihitung ulang di server; di sini hanya tampilan.
 */
export function KpiEvaluationForm({ scheme, nip, evaluator, evaluatorName, rec, total, decision, chain, status, fullyApproved, act }: {
  scheme: KpiScheme;
  nip: string;
  evaluator: "SM" | "NSM" | null;
  evaluatorName: string;
  rec: { months: number; label: string } | null;
  total: number | null;
  decision: Decision | null;
  chain: Chain;
  status: string;
  fullyApproved: boolean;
  act: Action;
}) {
  const router = useRouter();
  const [months, setMonths] = useState("");
  const [reason, setReason] = useState("");
  const [dev, setDev] = useState("");
  const [direction, setDirection] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const { armed, arm, reset } = useArm();

  // ─ Sudah dievaluasi: kotak status + rantai + isi keputusan (+ tombol approve bila giliran Anda)
  if (decision) {
    const same = decision.systemMonths != null && decision.systemMonths === decision.months;
    const approve = () => {
      setError("");
      if (!armed) return arm();
      start(async () => {
        const res = await approveKpiStepAction({ scheme, nip });
        if (res.ok) router.refresh();
        else { setError(res.error); reset(); }
      });
    };
    return (
      <div className="space-y-4">
        <div className="rounded-md border p-4 font-semibold" style={fullyApproved
          ? { background: "var(--color-green-light)", color: "#006B32", borderColor: "var(--color-border)" }
          : { background: "var(--color-warning-bg)", color: "#7A5A12", borderColor: "var(--color-border)" }}>
          {fullyApproved ? `✓ Disetujui lengkap: perpanjangan ${DECISION_LABEL[decision.months]}` : status}
          <div className="mt-0.5 text-xs font-normal">
            Diusulkan {DECISION_LABEL[decision.months]} · {fmtDateTime(decision.at)}{decision.byName ? ` · ${decision.byName}` : ""} · Rekomendasi sistem:{" "}
            {decision.systemMonths == null ? "belum tersedia" : DECISION_LABEL[decision.systemMonths]}
            {decision.systemMonths == null ? "" : same ? " · sesuai rekomendasi" : " · berbeda dari rekomendasi"}
          </div>
        </div>
        <ChainPanel chain={chain} decision={decision} />
        {[["Penjelasan keputusan", decision.reason], ["Evaluasi rencana pengembangan personil", decision.dev], ["Rasionalisasi perpanjangan ke direksi", decision.direction]].map(([l, v]) => (
          <div key={l}>
            <span className={labelCls} style={muted}>{l}</span>
            <div className="min-h-9 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>{v || "—"}</div>
          </div>
        ))}
        {act?.kind === "approve" && act.step && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={approve} disabled={pending} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--color-blue)" }}>
              {pending ? "Menyimpan…" : armed ? "Klik lagi untuk konfirmasi" : `Setujui sebagai ${STEP_LABEL[act.step]}`}
            </button>
            {error && <span className="text-xs" role="alert" style={{ color: "var(--color-error)" }}>{error}</span>}
          </div>
        )}
      </div>
    );
  }

  // ─ Belum dievaluasi dan Anda bukan pengisi evaluasi
  if (act?.kind !== "evaluasi") {
    return (
      <>
        <ChainPanel chain={chain} decision={null} />
        <div className="rounded-md border p-3.5 text-sm leading-relaxed" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", ...muted }}>
          {evaluator
            ? `Belum dievaluasi. Evaluasi diisi oleh ${STEP_LABEL[evaluator]}; setelah itu approval berlanjut sesuai rantai di atas.`
            : "Belum dievaluasi, dan tidak ada atasan di struktur yang dapat mengisi evaluasi untuk personil ini."}
        </div>
      </>
    );
  }

  // ─ Form evaluasi
  const hint = months === "" ? "" : rec && Number(months) === rec.months ? "Sesuai rekomendasi sistem." : "Berbeda dari rekomendasi: penjelasan wajib diisi.";
  const saveLabel = act.step ? "Simpan Evaluasi & Setujui" : "Simpan Evaluasi";

  function submit() {
    setError("");
    if (months === "") return setError("Pilih keputusan perpanjangan.");
    if ((!rec || Number(months) !== rec.months) && !reason.trim()) return setError("Keputusan berbeda dari rekomendasi: isi penjelasan keputusan.");
    if (!dev.trim()) return setError("Rencana pengembangan personil wajib diisi.");
    if (!armed) return arm();
    start(async () => {
      const res = await saveKpiEvaluationAction({ scheme, nip, months: Number(months), reason, dev, direction });
      if (res.ok) router.refresh();
      else { setError(res.error); reset(); }
    });
  }

  return (
    <>
      <ChainPanel chain={chain} decision={null} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="evDecision" className={labelCls} style={muted}>Keputusan perpanjangan</label>
          <select id="evDecision" value={months} onChange={(e) => setMonths(e.target.value)} className={fieldCls} style={fieldStyle}>
            <option value="">Pilih durasi…</option>
            {[12, 9, 6, 0].map((m) => <option key={m} value={m}>{DECISION_LABEL[m]}{rec?.months === m ? " (rekomendasi)" : ""}</option>)}
          </select>
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-faint)" }}>{hint}</p>
        </div>
        <div className="self-end rounded-md border px-4 py-2.5" style={{ background: "var(--color-blue-light)", borderColor: "var(--color-border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-blue)" }}>Rekomendasi sistem</div>
          <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{rec ? DECISION_LABEL[rec.months] : "Belum tersedia"}</div>
          <div className="text-xs" style={muted}>{rec ? `${rec.label} · Point final ${nf(total)}` : "Skor belum lengkap — keputusan wajib disertai penjelasan"}</div>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="evBy" className={labelCls} style={muted}>Penilai</label>
          <input id="evBy" value={evaluatorName} readOnly className={fieldCls} style={fieldStyle} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="evReason" className={labelCls} style={muted}>Penjelasan keputusan</label>
          <textarea id="evReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className={fieldCls} style={fieldStyle}
            placeholder="Jelaskan alasan keputusan secara jelas dan logis. Wajib diisi bila keputusan berbeda dari rekomendasi." />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="evDev" className={labelCls} style={muted}>Evaluasi rencana pengembangan personil (wajib)</label>
          <textarea id="evDev" value={dev} onChange={(e) => setDev(e.target.value)} rows={4} className={fieldCls} style={fieldStyle} placeholder="Rencana pengembangan untuk periode kontrak berikutnya." />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="evDir" className={labelCls} style={muted}>Rasionalisasi perpanjangan ke direksi</label>
          <textarea id="evDir" value={direction} onChange={(e) => setDirection(e.target.value)} rows={4} className={fieldCls} style={fieldStyle} placeholder="Dilengkapi data dan fakta." />
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <button type="button" onClick={submit} disabled={pending} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--color-blue)" }}>
            {pending ? "Menyimpan…" : armed ? "Klik lagi untuk konfirmasi" : saveLabel}
          </button>
          {error && <span className="text-xs" role="alert" style={{ color: "var(--color-error)" }}>{error}</span>}
        </div>
      </div>
    </>
  );
}
