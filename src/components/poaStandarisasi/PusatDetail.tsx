"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
import { APPROVAL_LEVELS, actionableRows, type ApprovalLevel } from "@/lib/discountApprovalLevel";

const PHASE_LABEL: Record<string, string> = {
  APPROVAL_ATASAN: "Approval Atasan",
  APPROVAL_USER_DOKTER: "Approval User/Dokter",
  FINALISASI: "Finalisasi",
};

const STATUS_COLOR: Record<string, string> = { DISETUJUI: "#008f42", DITOLAK: "#C0392B", MENUNGGU: "#9A6F1B" };

/** Detail + aksi per fase pengajuan standarisasi pusat — docs/poa-standarisasi-pusat/. */
export function PusatDetailView({ detail, groupOutlets }: { detail: PusatDetail; groupOutlets: { kodePI: string; namaOutlet: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<PusatResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  const rows = detail.produk.flatMap((p) => p.approvals.map((a) => ({ produkId: p.id, level: a.level, status: a.status })));
  const submitted = !!detail.submittedAt;

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1>Standarisasi Pusat — {detail.hkaGroup}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          oleh {detail.ownerName} · {detail.tipeStandarisasi}{detail.periodeBulan ? ` ${detail.periodeBulan} bulan` : ""} ·{" "}
          <b>{submitted ? "Final (sudah disubmit)" : PHASE_LABEL[detail.currentPhase]}</b>
        </p>
      </div>

      {error && <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>{error}</div>}

      {/* Aksi approval per level yang boleh dilakukan user ini */}
      {detail.currentPhase === "APPROVAL_ATASAN" && !submitted && (
        <Card>
          <p className="mb-2 text-sm font-medium">Approval Atasan</p>
          {detail.myLevels.filter((l) => actionableRows(rows, l).length > 0).length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Tidak ada produk yang menunggu persetujuan Anda.</p>
          ) : (
            detail.myLevels.filter((l) => actionableRows(rows, l).length > 0).map((level) => (
              <div key={level} className="flex items-center gap-2 py-1">
                <span className="text-sm">Level {level}: {actionableRows(rows, level).length} produk menunggu</span>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => act(() => approvePusatAction(detail.id, level, "DITOLAK"))}>Tolak semua</Button>
                <Button size="sm" disabled={pending} onClick={() => act(() => approvePusatAction(detail.id, level, "DISETUJUI"))}>Setujui semua</Button>
              </div>
            ))
          )}
        </Card>
      )}

      {detail.produk.map((p) => (
        <Card key={p.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{p.namaProduk}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {p.skemaPembayaran === "DP"
                ? `DP Rp${p.estimasiValueDpRp?.toLocaleString("id-ID") ?? 0}`
                : `Diskon PI ${p.estimasiDiskonPct ?? 0}% · Distributor ${p.estimasiDiskonDistributorPct ?? 0}%`}
              {p.catatan ? ` · ${p.catatan}` : ""}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {[...p.approvals].sort((a, b) => APPROVAL_LEVELS.indexOf(a.level) - APPROVAL_LEVELS.indexOf(b.level)).map((a) => (
              <span key={a.level} className="rounded-full px-2.5 py-0.5" style={{ border: `1px solid ${STATUS_COLOR[a.status]}`, color: STATUS_COLOR[a.status] }}>
                {a.level}: {a.status}{a.autoApproved ? " (otomatis)" : ""}
              </span>
            ))}
          </div>

          {detail.currentPhase !== "APPROVAL_ATASAN" && (
            <DokterSection produk={p} pengajuanId={detail.id} groupOutlets={groupOutlets} canEdit={detail.canEdit && detail.currentPhase === "APPROVAL_USER_DOKTER"} act={act} pending={pending} setError={setError} />
          )}
        </Card>
      ))}

      {detail.canEdit && detail.currentPhase === "APPROVAL_USER_DOKTER" && (
        <Button disabled={pending} onClick={() => act(() => advancePusatToFinalisasiAction(detail.id))}>Lanjut ke Finalisasi</Button>
      )}
      {detail.canEdit && detail.currentPhase === "FINALISASI" && (
        <Button variant="orange" disabled={pending} onClick={() => act(() => submitPusatAction(detail.id))}>Submit Final</Button>
      )}
    </div>
  );
}

function DokterSection({
  produk, pengajuanId, groupOutlets, canEdit, act, pending, setError,
}: {
  produk: PusatDetail["produk"][number];
  pengajuanId: string;
  groupOutlets: { kodePI: string; namaOutlet: string }[];
  canEdit: boolean;
  act: (fn: () => Promise<PusatResult>) => void;
  pending: boolean;
  setError: (m: string | null) => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);

  async function pickOutlet(v: string) {
    setKodePI(v);
    setOptions(v ? await getPusatDokterOptionsAction(pengajuanId, v) : []);
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
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
      <p className="mb-1 text-xs font-medium">Dokter User</p>
      {produk.dokter.length === 0 && <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Belum ada dokter.</p>}
      <ul className="space-y-1">
        {produk.dokter.map((d) => (
          <li key={d.customerId} className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={d.sudahTtd} disabled={!canEdit || pending} onChange={(e) => act(() => setPusatDokterTtdAction(produk.id, d.customerId, e.target.checked))} />
              Sudah TTD
            </label>
            <span>{d.nama} <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>· {d.spesialisasi} · {d.outlet}</span></span>
            {canEdit && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => removePusatDokterAction(produk.id, d.customerId))}>Hapus</Button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm" value={kodePI} onChange={(e) => pickOutlet(e.target.value)}>
            <option value="">— outlet di grup —</option>
            {groupOutlets.map((o) => <option key={o.kodePI} value={o.kodePI}>{o.namaOutlet}</option>)}
          </select>
          <select className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-sm" value="" disabled={!kodePI || pending} onChange={(e) => addDokter(e.target.value)}>
            <option value="">+ tambah dokter</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.namaCustomer} — {o.spesialisasi}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
