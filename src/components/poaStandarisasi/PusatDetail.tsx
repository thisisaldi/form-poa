"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { createCustomerAction, type CustomerOption } from "@/app/actions/customer";
import {
  addPusatDokterAction,
  advancePusatToFinalisasiAction,
  approvePusatAction,
  getPusatDokterOptionsAction,
  removePusatDokterAction,
  setPusatDokterTtdAction,
  submitPusatAction,
  type PusatDetail,
  type PusatResult,
} from "@/app/actions/poaStandarisasiPusat";
import { APPROVAL_LEVELS, type ApprovalLevel } from "@/lib/discountApprovalLevel";
import { StatusPill, Stepper } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

type Produk = PusatDetail["produk"][number];

const TIPE_LABEL: Record<string, string> = { PERIODIC: "Standarisasi Periodic", SISIPAN: "Standarisasi Sisipan", PERMANEN: "Standarisasi Non Periodic" };
const levelIdx = (l: string) => APPROVAL_LEVELS.indexOf(l as ApprovalLevel);
const rp = (n: number | null) => (n == null ? "-" : "Rp " + Math.round(n).toLocaleString("id-ID"));

const PHASE_IDX: Record<PusatDetail["currentPhase"], number> = { APPROVAL_ATASAN: 1, APPROVAL_USER_DOKTER: 2, FINALISASI: 3 };

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium block mb-1">{label}</span>
      <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>{value}</div>
    </div>
  );
}

/** Detail pengajuan Standarisasi Pusat — wizard 4 langkah dengan Stepper, pola sama dengan PoaStandarisasiWizard cabang. */
export function PusatDetailView({ detail, groupOutlets }: { detail: PusatDetail; groupOutlets: { kodePI: string; namaOutlet: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submitted = !!detail.submittedAt;
  const currentIdx = submitted ? 3 : PHASE_IDX[detail.currentPhase];
  // null = ikuti fase aktif (otomatis maju setelah aksi); angka = user sedang melihat fase sebelumnya.
  const [picked, setPicked] = useState<number | null>(null);
  const viewedIdx = picked ?? currentIdx;
  const isCurrent = viewedIdx === currentIdx;
  const canEditNow = detail.canEdit && isCurrent;

  function act(fn: () => Promise<PusatResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/poa-standarisasi/pusat" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
          ← Daftar Standarisasi Pusat
        </Link>
        <h1 className="mt-1">Standarisasi Pusat — {detail.hkaGroup}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Standarisasi Pusat (Produk × Grup RS) · dibuat oleh {detail.ownerName}
        </p>
      </div>

      <Stepper
        currentIdx={currentIdx}
        allDone={submitted}
        viewedIdx={viewedIdx}
        onSelect={(i) => { if (i <= currentIdx) setPicked(i === currentIdx ? null : i); }}
      />

      {error && (
        <div className="mb-4 rounded px-3 py-2 text-sm" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>{error}</div>
      )}

      {viewedIdx === 0 && <PlanningView detail={detail} />}
      {viewedIdx === 1 && <ApprovalView detail={detail} canAct={isCurrent && !submitted} act={act} pending={pending} />}
      {viewedIdx === 2 && <DokterView detail={detail} groupOutlets={groupOutlets} canEdit={canEditNow && detail.currentPhase === "APPROVAL_USER_DOKTER"} act={act} pending={pending} setError={setError} />}
      {viewedIdx === 3 && <FinalisasiView detail={detail} />}

      <div className="flex justify-end gap-2 mt-4">
        {isCurrent && detail.canEdit && detail.currentPhase === "APPROVAL_USER_DOKTER" && !submitted && (
          <Button disabled={pending} onClick={() => act(() => advancePusatToFinalisasiAction(detail.id))}>Lanjut ke Finalisasi</Button>
        )}
        {isCurrent && detail.canEdit && detail.currentPhase === "FINALISASI" && !submitted && (
          <Button disabled={pending} onClick={() => act(() => submitPusatAction(detail.id))}>Submit Standarisasi Pusat</Button>
        )}
        {submitted && (
          <span className="text-sm self-center" style={{ color: "var(--color-status-approved, #008f42)" }}>
            ✓ Sudah disubmit {new Date(detail.submittedAt!).toLocaleDateString("id-ID")}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Fase 1: Planning (read-only setelah dibuat) ────────────────────────────

function PlanningView({ detail }: { detail: PusatDetail }) {
  return (
    <>
      <Card className="mb-4">
        <CardHeader><CardTitle>Planning Standarisasi</CardTitle></CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ReadOnlyField label="Grup RS" value={detail.hkaGroup} />
          <ReadOnlyField label="Tipe Standarisasi" value={TIPE_LABEL[detail.tipeStandarisasi] ?? detail.tipeStandarisasi} />
          <ReadOnlyField label="Periode" value={detail.periodeBulan ? `${detail.periodeBulan} Bulan` : "-"} />
        </div>
      </Card>
      <div className="mb-2"><span className="text-sm font-semibold">Produk diajukan ({detail.produk.length})</span></div>
      {detail.produk.map((p, i) => (
        <Card key={p.id} className="mb-4" style={{ background: "var(--color-bg-subtle)" }}>
          <span className="text-sm font-semibold block mb-3" style={{ color: "var(--color-blue)" }}>{i + 1}. {p.namaProduk}</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ReadOnlyField label="Skema" value={p.skemaPembayaran === "DP" ? "DP" : "Diskon"} />
            {p.skemaPembayaran === "DP" ? (
              <ReadOnlyField label="Value DP" value={rp(p.estimasiValueDpRp)} />
            ) : (
              <>
                <ReadOnlyField label="Diskon (PI)" value={`${p.estimasiDiskonPct ?? 0} %`} />
                <ReadOnlyField label="Diskon (Dist.)" value={`${p.estimasiDiskonDistributorPct ?? 0} %`} />
              </>
            )}
          </div>
          {p.catatan && <p className="text-xs mt-3" style={{ color: "var(--color-text-muted)" }}>Catatan: {p.catatan}</p>}
        </Card>
      ))}
    </>
  );
}

// ─── Fase 2: Approval Atasan ─────────────────────────────────────────────────

function ApprovalView({ detail, canAct, act, pending }: { detail: PusatDetail; canAct: boolean; act: (fn: () => Promise<PusatResult>) => void; pending: boolean }) {
  const total = detail.produk.reduce((n, p) => n + p.approvals.length, 0);
  const done = detail.produk.reduce((n, p) => n + p.approvals.filter((a) => a.status === "DISETUJUI").length, 0);
  const top = detail.produk.flatMap((p) => p.approvals.map((a) => a.level)).sort((a, b) => levelIdx(b) - levelIdx(a))[0];
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Approval Atasan</CardTitle></CardHeader>
      <p className="text-sm mb-1" style={{ color: "var(--color-blue)" }}>
        Level approval ditentukan Disc PI (beban Principal) per produk — butuh approval sampai <strong>{top}</strong>. Level setara pembuat otomatis disetujui. Lanjut ke Approval User/Dokter setelah semua produk disetujui di semua levelnya.
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>{done} dari {total} persetujuan selesai</p>
      <div className="rounded p-4 mb-2 space-y-3" style={{ background: "var(--color-bg-subtle)" }}>
        {detail.produk.map((prod) => {
          const rows = [...prod.approvals].sort((a, b) => levelIdx(a.level) - levelIdx(b.level));
          const turn = rows.find((r) => r.status !== "DISETUJUI");
          return (
            <div key={prod.id} className="pb-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-medium">{prod.namaProduk}</span>
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  {prod.skemaPembayaran === "DP" ? "Skema DP" : `Disc PI ${prod.estimasiDiskonPct ?? 0}%`}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {rows.map((r) => (
                  <div key={r.level} className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{r.level}</span>
                    <StatusPill status={r.status} />
                    {r.autoApproved && <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>otomatis</span>}
                    {canAct && turn?.level === r.level && r.status === "MENUNGGU" && detail.myLevels.includes(r.level) && (
                      <>
                        <Button size="sm" disabled={pending} onClick={() => act(() => approvePusatAction(detail.id, r.level, "DISETUJUI", [prod.id]))}>Setujui</Button>
                        <Button size="sm" variant="danger" disabled={pending} onClick={() => act(() => approvePusatAction(detail.id, r.level, "DITOLAK", [prod.id]))}>Tolak</Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--color-text-faint)" }}>
        Grup <strong>{detail.hkaGroup}</strong> · {detail.produk.length} produk diajukan
      </p>
    </Card>
  );
}

// ─── Fase 3: Approval User / Dokter ──────────────────────────────────────────

function DokterView({
  detail, groupOutlets, canEdit, act, pending, setError,
}: {
  detail: PusatDetail;
  groupOutlets: { kodePI: string; namaOutlet: string }[];
  canEdit: boolean;
  act: (fn: () => Promise<PusatResult>) => void;
  pending: boolean;
  setError: (m: string | null) => void;
}) {
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Approval User / Dokter</CardTitle></CardHeader>
      <p className="text-xs mb-4" style={{ color: "var(--color-text-faint)" }}>
        Pilih dokter user dari outlet mana pun di grup {detail.hkaGroup}, lalu centang &quot;Sudah TTD&quot; setelah tanda tangan fisik didapat.
      </p>
      {detail.produk.map((p) => (
        <ProdukDokter key={p.id} produk={p} pengajuanId={detail.id} groupOutlets={groupOutlets} canEdit={canEdit} act={act} pending={pending} setError={setError} />
      ))}
    </Card>
  );
}

function ProdukDokter({
  produk, pengajuanId, groupOutlets, canEdit, act, pending, setError,
}: {
  produk: Produk;
  pengajuanId: string;
  groupOutlets: { kodePI: string; namaOutlet: string }[];
  canEdit: boolean;
  act: (fn: () => Promise<PusatResult>) => void;
  pending: boolean;
  setError: (m: string | null) => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);

  async function pickOutlet(v: string) {
    setKodePI(v);
    setOptions([]);
    if (!v) return;
    setLoading(true);
    setOptions(await getPusatDokterOptionsAction(pengajuanId, v));
    setLoading(false);
  }

  /** "nexus:<...>" id harus dijadikan baris Customer asli dulu sebelum jadi FK — pola sama dengan wizard cabang. */
  async function addDokter(rawId: string) {
    if (!rawId) return;
    setError(null);
    let id = rawId;
    if (rawId.startsWith("nexus:")) {
      const opt = options.find((o) => o.id === rawId);
      if (!opt) return;
      const fd = new FormData();
      fd.set("namaCustomer", opt.namaCustomer);
      fd.set("spesialisasi", opt.spesialisasi);
      fd.set("kodePI", kodePI);
      if (opt.kodeCustomer) fd.set("kodeCustomer", opt.kodeCustomer);
      const res = await createCustomerAction(fd);
      if (!res.ok || !res.customerId) return setError(res.error ?? "Gagal mendaftarkan dokter.");
      id = res.customerId;
    }
    act(() => addPusatDokterAction(produk.id, id));
  }

  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-blue)" }}>{produk.namaProduk}</h3>
      {produk.dokter.length === 0 && (
        <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada dokter dipilih.</p>
      )}
      {produk.dokter.map((d) => (
        <div key={d.customerId} className="flex items-center gap-3 rounded px-3 py-2 mb-1.5 text-sm flex-wrap" style={{ border: "1px solid var(--color-border)" }}>
          <div className="flex-1 min-w-[160px]">
            <div>{d.nama}</div>
            <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{d.spesialisasi} · {d.outlet}</div>
          </div>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: d.wajib ? "var(--color-error-bg, #FDECEA)" : "var(--color-bg-subtle)", color: d.wajib ? "var(--color-error)" : "var(--color-text-faint)" }}
          >
            {d.wajib ? "Wajib" : "Opsional"}
          </span>
          <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: d.sudahTtd ? "var(--color-status-approved, #008f42)" : "var(--color-text-faint)" }}>
            <input type="checkbox" checked={d.sudahTtd} disabled={!canEdit || pending} onChange={(e) => act(() => setPusatDokterTtdAction(produk.id, d.customerId, e.target.checked))} />
            {d.sudahTtd ? "✓ Sudah TTD" : "Belum TTD"}
          </label>
          {canEdit && (
            <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} disabled={pending} onClick={() => act(() => removePusatDokterAction(produk.id, d.customerId))}>
              Hapus
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg p-3 mt-2" style={{ background: "var(--color-bg-subtle)" }}>
          <div>
            <span className="text-xs font-medium block mb-1">Outlet di grup</span>
            <Combobox
              name={`outlet-${produk.id}`}
              options={groupOutlets.map((o) => ({ value: o.kodePI, label: o.namaOutlet }))}
              value={kodePI}
              onChange={pickOutlet}
              placeholder="Pilih outlet…"
            />
          </div>
          <div>
            <span className="text-xs font-medium block mb-1">Dokter</span>
            <Combobox
              name={`dokter-${produk.id}`}
              options={options
                .filter((o) => !produk.dokter.some((d) => d.customerId === o.id))
                .map((o) => ({ value: o.id, label: o.namaCustomer, sublabel: o.jabatan, tag: o.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
              value=""
              onChange={addDokter}
              disabled={!kodePI || loading || pending}
              placeholder={loading ? "Memuat dokter…" : kodePI ? "+ Tambah dokter…" : "Pilih outlet dulu"}
              emptyMessage="Tidak ada dokter terdaftar di outlet ini."
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fase 4: Finalisasi ──────────────────────────────────────────────────────

function FinalisasiView({ detail }: { detail: PusatDetail }) {
  const totalDokter = detail.produk.reduce((n, p) => n + p.dokter.length, 0);
  const totalTtd = detail.produk.reduce((n, p) => n + p.dokter.filter((d) => d.sudahTtd).length, 0);
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Finalisasi</CardTitle></CardHeader>
      <p className="text-sm mb-4" style={{ color: "var(--color-blue)" }}>
        {detail.submittedAt
          ? `Standarisasi pusat grup ${detail.hkaGroup} sudah final. Outlet cabang di grup ini kini dapat mengajukan standarisasi untuk produk di bawah.`
          : "Periksa ringkasan di bawah, lalu submit. Setelah disubmit, standarisasi pusat membuka gateway untuk standarisasi cabang di grup ini."}
      </p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: "Produk", value: String(detail.produk.length) },
          { label: "Dokter user", value: String(totalDokter) },
          { label: "Sudah TTD", value: `${totalTtd}/${totalDokter}` },
        ].map((s) => (
          <div key={s.label} className="rounded p-3 text-center" style={{ background: "var(--color-bg-subtle)" }}>
            <div className="text-lg font-semibold">{s.value}</div>
            <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <ul className="text-sm space-y-1">
        {detail.produk.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded px-3 py-2" style={{ border: "1px solid var(--color-border)" }}>
            <span>{p.namaProduk}</span>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {p.skemaPembayaran === "DP" ? `DP ${rp(p.estimasiValueDpRp)}` : `Diskon PI ${p.estimasiDiskonPct ?? 0}% · Dist. ${p.estimasiDiskonDistributorPct ?? 0}%`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
