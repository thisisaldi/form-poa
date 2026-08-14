"use client";

import { useMemo, useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import type { Product } from "@/lib/masterData";
import type { CustomerOption } from "@/app/actions/customer";
import { createCustomerAction } from "@/app/actions/customer";
import { GolonganBadge } from "@/components/poaStandarisasi/GolonganBadge";
import {
  savePlanningAction,
  advanceToApprovalAtasanAction,
  approvePoaStandarisasiAtasanAction,
  saveApprovalUserDokterAction,
  advanceToFinalisasiAction,
  saveFinalisasiAction,
  submitPoaStandarisasiAction,
  findOrCreateKpdmAction,
  findOrCreateJabatanAction,
  uploadPoaStandarisasiFileAction,
  type PoaStandarisasiDetail,
  type PlanningInput,
  type PlanningProdukInput,
} from "@/app/actions/poaStandarisasi";

const PHASES = [
  { id: "PLANNING", label: "Planning Standarisasi" },
  { id: "APPROVAL_ATASAN", label: "Approval Atasan" },
  { id: "APPROVAL_USER_DOKTER", label: "Approval User / Dokter" },
  { id: "FINALISASI", label: "Finalisasi" },
] as const;

function formatRp(n: number | null | undefined): string {
  if (n == null) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function hargaSTFromProduct(p: Product): number {
  const hna = parseFloat(p.hna) || 0;
  const konversi = parseFloat(p.konversiPembagi ?? "1") || 1;
  return hna / konversi;
}

interface ProdukFormState {
  id?: string;
  kodeProduk: string;
  jumlahPasien: string;
  resepPerPasienSt: string;
  estimasiDiskonPct: string;
  estimasiBiayaListingRp: string;
  estimasiEntertainRp: string;
  dokterCustomerIds: string[];
  finalDiscountPct: string;
  diskonDistributorPct: string;
  finalBiayaListingRp: string;
  dokterUser: { customerId: string; jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }[];
}

function emptyProduk(inherit?: ProdukFormState): ProdukFormState {
  return {
    kodeProduk: "",
    jumlahPasien: "",
    resepPerPasienSt: "",
    estimasiDiskonPct: "",
    estimasiBiayaListingRp: "",
    estimasiEntertainRp: "",
    dokterCustomerIds: inherit ? [...inherit.dokterCustomerIds] : [],
    finalDiscountPct: "",
    diskonDistributorPct: "",
    finalBiayaListingRp: "",
    dokterUser: [],
  };
}

function produkFromDetail(p: PoaStandarisasiDetail["produk"][number]): ProdukFormState {
  return {
    id: p.id,
    kodeProduk: p.kodeProduk,
    jumlahPasien: p.jumlahPasien != null ? String(p.jumlahPasien) : "",
    resepPerPasienSt: p.resepPerPasienSt != null ? String(p.resepPerPasienSt) : "",
    estimasiDiskonPct: p.estimasiDiskonPct != null ? String(p.estimasiDiskonPct) : "",
    estimasiBiayaListingRp: p.estimasiBiayaListingRp != null ? String(p.estimasiBiayaListingRp) : "",
    estimasiEntertainRp: p.estimasiEntertainRp != null ? String(p.estimasiEntertainRp) : "",
    dokterCustomerIds: p.dokterApproval.map((d) => d.customerId),
    finalDiscountPct: p.finalDiscountPct != null ? String(p.finalDiscountPct) : "",
    diskonDistributorPct: p.diskonDistributorPct != null ? String(p.diskonDistributorPct) : "",
    finalBiayaListingRp: p.finalBiayaListingRp != null ? String(p.finalBiayaListingRp) : "",
    dokterUser:
      p.dokterUser.length > 0
        ? p.dokterUser.map((d) => ({
            customerId: d.customerId,
            jumlahPasien: d.jumlahPasien != null ? String(d.jumlahPasien) : "",
            resepPerPasienSt: d.resepPerPasienSt != null ? String(d.resepPerPasienSt) : "",
            entertainRp: d.entertainRp != null ? String(d.entertainRp) : "",
          }))
        : // Default candidates: dokter who already signed (sudahTtd) in Phase 3.
          p.dokterApproval
            .filter((d) => d.sudahTtd)
            .map((d) => ({ customerId: d.customerId, jumlahPasien: "", resepPerPasienSt: "", entertainRp: "" })),
  };
}

function isoDateInput(v: string | Date | null): string {
  if (!v) return "";
  const dt = typeof v === "string" ? new Date(v) : v;
  return dt.toISOString().slice(0, 10);
}

function isoDatetimeLocalInput(v: string | Date | null): string {
  if (!v) return "";
  const dt = typeof v === "string" ? new Date(v) : v;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function PoaStandarisasiWizard({
  pengajuan,
  productOptions,
  kpdmOptions,
  jabatanOptions,
  distributorOptions,
  dokterOptions,
  canEdit,
  canApproveAsm,
  canApproveSm,
  isOwner,
}: {
  pengajuan: PoaStandarisasiDetail;
  productOptions: Product[];
  kpdmOptions: { id: string; nama: string; jabatanId: string | null }[];
  jabatanOptions: { id: string; nama: string }[];
  distributorOptions: { id: string; nama: string }[];
  dokterOptions: CustomerOption[];
  canEdit: boolean;
  canApproveAsm: boolean;
  canApproveSm: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentStepIdx = PHASES.findIndex((p) => p.id === pengajuan.currentPhase);

  // ── Local mutable master data (grows when "+ Tambah baru" is used) ───────
  const [kpdmList, setKpdmList] = useState(kpdmOptions);
  const [jabatanList, setJabatanList] = useState(jabatanOptions);
  const [dokterList, setDokterList] = useState(dokterOptions);

  // ── Phase 1 state ──────────────────────────────────────────────────────
  const [kpdmId, setKpdmId] = useState(pengajuan.kpdmId);
  const [kpdmNama, setKpdmNama] = useState(pengajuan.kpdmNamaSnapshot);
  const initialKpdm = kpdmOptions.find((k) => k.id === pengajuan.kpdmId);
  const [jabatanId, setJabatanId] = useState<string | null>(initialKpdm?.jabatanId ?? null);
  const [jabatanNama, setJabatanNama] = useState(pengajuan.jabatanNamaSnapshot ?? "");
  const [kpdmEntertainEstimasi, setKpdmEntertainEstimasi] = useState(pengajuan.kpdmEntertainEstimasi != null ? String(pengajuan.kpdmEntertainEstimasi) : "");
  const [tipeStandarisasi, setTipeStandarisasi] = useState(pengajuan.tipeStandarisasi);
  const [periodeBulan, setPeriodeBulan] = useState(pengajuan.periodeBulan != null ? String(pengajuan.periodeBulan) : "");
  const [jumlahBedRs, setJumlahBedRs] = useState(pengajuan.jumlahBedRs != null ? String(pengajuan.jumlahBedRs) : "");
  const [estimasiTimelineSelesai, setEstimasiTimelineSelesai] = useState(isoDateInput(pengajuan.estimasiTimelineSelesai));
  const [produkList, setProdukList] = useState<ProdukFormState[]>(() =>
    pengajuan.produk.length > 0 ? pengajuan.produk.map(produkFromDetail) : [emptyProduk()]
  );

  // ── Phase 3 state ──────────────────────────────────────────────────────
  const [jadwalMeetingKft, setJadwalMeetingKft] = useState(isoDatetimeLocalInput(pengajuan.jadwalMeetingKft));
  const [sudahTtdMap, setSudahTtdMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const p of pengajuan.produk) for (const d of p.dokterApproval) map[`${p.id}:${d.customerId}`] = d.sudahTtd;
    return map;
  });

  // ── Phase 4 state ──────────────────────────────────────────────────────
  const [distributorId, setDistributorId] = useState(pengajuan.distributorId ?? "");
  const [kpdmEntertainFinal, setKpdmEntertainFinal] = useState(
    pengajuan.kpdmEntertainFinal != null ? String(pengajuan.kpdmEntertainFinal) : kpdmEntertainEstimasi
  );

  const dokterById = useMemo(() => new Map(dokterList.map((d) => [d.id, d])), [dokterList]);
  const productByKode = useMemo(() => new Map(productOptions.map((p) => [p.kodeProduk, p])), [productOptions]);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      }
    });
  }

  /** Materializes a "nexus:<...>" synthetic id into a real Customer row before it's used as a FK — same pattern as LineItemEditor's dokter picker. */
  async function resolveDokterId(rawId: string): Promise<string> {
    if (!rawId.startsWith("nexus:")) return rawId;
    const opt = dokterById.get(rawId);
    if (!opt) return rawId;
    const fd = new FormData();
    fd.set("namaCustomer", opt.namaCustomer);
    fd.set("spesialisasi", opt.spesialisasi);
    fd.set("kodePI", pengajuan.kodePI);
    if (opt.kodeCustomer) fd.set("kodeCustomer", opt.kodeCustomer);
    const res = await createCustomerAction(fd);
    if (!res.ok || !res.customerId) throw new Error(res.error ?? "Gagal mendaftarkan dokter.");
    setDokterList((prev) => prev.map((d) => (d.id === rawId ? { ...d, id: res.customerId! } : d)));
    return res.customerId;
  }

  function buildPlanningPayload(): PlanningInput {
    return {
      kpdmId,
      kpdmNama,
      jabatanId,
      jabatanNama: jabatanNama || null,
      kpdmEntertainEstimasi: kpdmEntertainEstimasi || null,
      tipeStandarisasi,
      periodeBulan: tipeStandarisasi === "PERMANEN" ? null : periodeBulan || null,
      jumlahBedRs: jumlahBedRs || null,
      estimasiTimelineSelesai: estimasiTimelineSelesai || null,
      produk: produkList
        .filter((p) => p.kodeProduk)
        .map(
          (p): PlanningProdukInput => ({
            id: p.id,
            kodeProduk: p.kodeProduk,
            jumlahPasien: p.jumlahPasien || null,
            resepPerPasienSt: p.resepPerPasienSt || null,
            estimasiDiskonPct: p.estimasiDiskonPct || null,
            estimasiBiayaListingRp: p.estimasiBiayaListingRp || null,
            estimasiEntertainRp: p.estimasiEntertainRp || null,
            dokterCustomerIds: p.dokterCustomerIds,
          })
        ),
    };
  }

  function handleSavePlanning() {
    run(async () => savePlanningAction(pengajuan.id, buildPlanningPayload()));
  }

  function handleAdvanceToApprovalAtasan() {
    run(async () => {
      await savePlanningAction(pengajuan.id, buildPlanningPayload());
      await advanceToApprovalAtasanAction(pengajuan.id);
    });
  }

  function handleApprove(level: "ASM" | "SM", decision: "DISETUJUI" | "DITOLAK") {
    run(async () => approvePoaStandarisasiAtasanAction(pengajuan.id, level, decision));
  }

  function handleSavePhase3() {
    run(async () =>
      saveApprovalUserDokterAction(pengajuan.id, {
        jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft).toISOString() : null,
        sudahTtd: Object.entries(sudahTtdMap).map(([key, sudahTtd]) => {
          const [produkId, customerId] = key.split(":");
          return { produkId, customerId, sudahTtd };
        }),
      })
    );
  }

  function handleAdvanceToFinalisasi() {
    run(async () => {
      await saveApprovalUserDokterAction(pengajuan.id, {
        jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft).toISOString() : null,
        sudahTtd: Object.entries(sudahTtdMap).map(([key, sudahTtd]) => {
          const [produkId, customerId] = key.split(":");
          return { produkId, customerId, sudahTtd };
        }),
      });
      await advanceToFinalisasiAction(pengajuan.id);
    });
  }

  function buildFinalisasiPayload() {
    return {
      distributorId: distributorId || null,
      kpdmEntertainFinal: kpdmEntertainFinal || null,
      produk: produkList
        .filter((p) => p.id)
        .map((p) => ({
          id: p.id!,
          finalDiscountPct: p.finalDiscountPct || null,
          diskonDistributorPct: p.diskonDistributorPct || null,
          finalBiayaListingRp: p.finalBiayaListingRp || null,
          dokterUser: p.dokterUser
            .filter((d) => d.customerId)
            .map((d) => ({
              customerId: d.customerId,
              jumlahPasien: d.jumlahPasien || null,
              resepPerPasienSt: d.resepPerPasienSt || null,
              entertainRp: d.entertainRp || null,
            })),
        })),
    };
  }

  function handleSaveFinalisasi() {
    run(async () => saveFinalisasiAction(pengajuan.id, buildFinalisasiPayload()));
  }

  function handleSubmit() {
    run(async () => {
      await saveFinalisasiAction(pengajuan.id, buildFinalisasiPayload());
      await submitPoaStandarisasiAction(pengajuan.id);
    });
  }

  // ── Produk list mutators (Phase 1) ────────────────────────────────────
  function updateProduk(idx: number, patch: Partial<ProdukFormState>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function addProduk() {
    setProdukList((prev) => [...prev, emptyProduk(prev[prev.length - 1])]);
  }
  function removeProduk(idx: number) {
    setProdukList((prev) => prev.filter((_, i) => i !== idx));
  }
  async function addDokterToProduk(idx: number, rawId: string) {
    if (!rawId) return;
    const realId = await resolveDokterId(rawId);
    setProdukList((prev) =>
      prev.map((p, i) => (i === idx && !p.dokterCustomerIds.includes(realId) ? { ...p, dokterCustomerIds: [...p.dokterCustomerIds, realId] } : p))
    );
  }
  function removeDokterFromProduk(idx: number, customerId: string) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, dokterCustomerIds: p.dokterCustomerIds.filter((c) => c !== customerId) } : p)));
  }

  // ── Dokter-user mutators (Phase 4) ────────────────────────────────────
  async function addDokterUser(idx: number, rawId: string) {
    if (!rawId) return;
    const realId = await resolveDokterId(rawId);
    setProdukList((prev) =>
      prev.map((p, i) =>
        i === idx && !p.dokterUser.some((d) => d.customerId === realId)
          ? { ...p, dokterUser: [...p.dokterUser, { customerId: realId, jumlahPasien: "", resepPerPasienSt: "", entertainRp: "" }] }
          : p
      )
    );
  }
  function updateDokterUser(idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) {
    setProdukList((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, dokterUser: p.dokterUser.map((d) => (d.customerId === customerId ? { ...d, ...patch } : d)) } : p
      )
    );
  }
  function removeDokterUser(idx: number, customerId: string) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, dokterUser: p.dokterUser.filter((d) => d.customerId !== customerId) } : p)));
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <h1>Pengajuan Standarisasi — {pengajuan.outlet.namaOutlet}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Standarisasi (Produk × Outlet) — wizard 4 phase.
        </p>
      </div>

      <Stepper currentIdx={currentStepIdx} />

      {!isOwner && (
        <div className="mb-4 rounded px-3 py-2 text-xs" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
          Anda melihat pengajuan ini sebagai atasan (bukan pembuat) — hanya bagian Approval Atasan yang bisa Anda tindak lanjuti.
        </div>
      )}

      {error && (
        <div
          className="mb-4 rounded px-3 py-2 text-sm"
          style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}
        >
          {error}
        </div>
      )}

      {pengajuan.currentPhase === "PLANNING" && (
        <PlanningPhase
          canEdit={canEdit}
          kodePI={pengajuan.kodePI}
          kpdmList={kpdmList}
          setKpdmList={setKpdmList}
          jabatanList={jabatanList}
          setJabatanList={setJabatanList}
          kpdmId={kpdmId}
          setKpdmId={setKpdmId}
          kpdmNama={kpdmNama}
          setKpdmNama={setKpdmNama}
          jabatanId={jabatanId}
          setJabatanId={setJabatanId}
          jabatanNama={jabatanNama}
          setJabatanNama={setJabatanNama}
          kpdmEntertainEstimasi={kpdmEntertainEstimasi}
          setKpdmEntertainEstimasi={setKpdmEntertainEstimasi}
          tipeStandarisasi={tipeStandarisasi}
          setTipeStandarisasi={setTipeStandarisasi}
          periodeBulan={periodeBulan}
          setPeriodeBulan={setPeriodeBulan}
          jumlahBedRs={jumlahBedRs}
          setJumlahBedRs={setJumlahBedRs}
          estimasiTimelineSelesai={estimasiTimelineSelesai}
          setEstimasiTimelineSelesai={setEstimasiTimelineSelesai}
          produkList={produkList}
          productOptions={productOptions}
          productByKode={productByKode}
          dokterList={dokterList}
          dokterById={dokterById}
          updateProduk={updateProduk}
          addProduk={addProduk}
          removeProduk={removeProduk}
          addDokterToProduk={addDokterToProduk}
          removeDokterFromProduk={removeDokterFromProduk}
        />
      )}

      {pengajuan.currentPhase === "APPROVAL_ATASAN" && (
        <ApprovalAtasanPhase
          pengajuan={pengajuan}
          canApproveAsm={canApproveAsm}
          canApproveSm={canApproveSm}
          onApprove={handleApprove}
        />
      )}

      {pengajuan.currentPhase === "APPROVAL_USER_DOKTER" && (
        <ApprovalUserDokterPhase
          canEdit={canEdit}
          pengajuan={pengajuan}
          jadwalMeetingKft={jadwalMeetingKft}
          setJadwalMeetingKft={setJadwalMeetingKft}
          sudahTtdMap={sudahTtdMap}
          setSudahTtdMap={setSudahTtdMap}
        />
      )}

      {pengajuan.currentPhase === "FINALISASI" && (
        <FinalisasiPhase
          canEdit={canEdit}
          pengajuan={pengajuan}
          produkList={produkList}
          productByKode={productByKode}
          dokterList={dokterList}
          dokterById={dokterById}
          distributorOptions={distributorOptions}
          distributorId={distributorId}
          setDistributorId={setDistributorId}
          kpdmEntertainFinal={kpdmEntertainFinal}
          setKpdmEntertainFinal={setKpdmEntertainFinal}
          updateProduk={updateProduk}
          addDokterUser={addDokterUser}
          updateDokterUser={updateDokterUser}
          removeDokterUser={removeDokterUser}
        />
      )}

      <RingkasanPoa produkList={produkList} productByKode={productByKode} kpdmEntertain={kpdmEntertainEstimasi} />

      <div className="flex justify-between mt-4">
        <div />
        <div className="flex gap-2">
          {pengajuan.currentPhase === "PLANNING" && canEdit && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSavePlanning}>Simpan Draft</Button>
              <Button disabled={pending} onClick={handleAdvanceToApprovalAtasan}>Lanjut ke Approval Atasan</Button>
            </>
          )}
          {pengajuan.currentPhase === "APPROVAL_USER_DOKTER" && canEdit && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSavePhase3}>Simpan</Button>
              <Button disabled={pending} onClick={handleAdvanceToFinalisasi}>Lanjut ke Finalisasi</Button>
            </>
          )}
          {pengajuan.currentPhase === "FINALISASI" && canEdit && !pengajuan.submittedAt && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSaveFinalisasi}>Simpan</Button>
              <Button disabled={pending} onClick={handleSubmit}>Submit untuk Approval Standarisasi</Button>
            </>
          )}
          {pengajuan.submittedAt && (
            <span className="text-sm self-center" style={{ color: "var(--color-status-approved, #008f42)" }}>
              ✓ Sudah disubmit {new Date(pengajuan.submittedAt).toLocaleDateString("id-ID")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ currentIdx }: { currentIdx: number }) {
  return (
    <div className="flex items-start gap-2 mb-6 max-w-3xl">
      {PHASES.map((p, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={p.id} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div
                className="absolute h-0.5 top-4"
                style={{ left: "-50%", right: "50%", background: i <= currentIdx ? "var(--color-blue)" : "var(--color-border)" }}
              />
            )}
            <div
              className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-semibold z-10"
              style={{
                borderColor: done || active ? "var(--color-blue)" : "var(--color-border)",
                background: done ? "var(--color-blue)" : "#fff",
                color: done ? "#fff" : active ? "var(--color-blue)" : "var(--color-text-faint)",
                boxSizing: "border-box",
              }}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className="text-xs font-semibold mt-1.5 text-center max-w-[110px]"
              style={{ color: active ? "var(--color-text)" : "var(--color-text-faint)" }}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Phase 1: Planning Standarisasi ─────────────────────────────────────────

function PlanningPhase(props: {
  canEdit: boolean;
  kodePI: string;
  kpdmList: { id: string; nama: string; jabatanId: string | null }[];
  setKpdmList: React.Dispatch<React.SetStateAction<{ id: string; nama: string; jabatanId: string | null }[]>>;
  jabatanList: { id: string; nama: string }[];
  setJabatanList: React.Dispatch<React.SetStateAction<{ id: string; nama: string }[]>>;
  kpdmId: string;
  setKpdmId: (v: string) => void;
  kpdmNama: string;
  setKpdmNama: (v: string) => void;
  jabatanId: string | null;
  setJabatanId: (v: string | null) => void;
  jabatanNama: string;
  setJabatanNama: (v: string) => void;
  kpdmEntertainEstimasi: string;
  setKpdmEntertainEstimasi: (v: string) => void;
  tipeStandarisasi: "PERIODIC" | "SISIPAN" | "PERMANEN";
  setTipeStandarisasi: (v: "PERIODIC" | "SISIPAN" | "PERMANEN") => void;
  periodeBulan: string;
  setPeriodeBulan: (v: string) => void;
  jumlahBedRs: string;
  setJumlahBedRs: (v: string) => void;
  estimasiTimelineSelesai: string;
  setEstimasiTimelineSelesai: (v: string) => void;
  produkList: ProdukFormState[];
  productOptions: Product[];
  productByKode: Map<string, Product>;
  dokterList: CustomerOption[];
  dokterById: Map<string, CustomerOption>;
  updateProduk: (idx: number, patch: Partial<ProdukFormState>) => void;
  addProduk: () => void;
  removeProduk: (idx: number) => void;
  addDokterToProduk: (idx: number, rawId: string) => Promise<void>;
  removeDokterFromProduk: (idx: number, customerId: string) => void;
}) {
  const {
    canEdit, kodePI, kpdmList, setKpdmList, jabatanList, setJabatanList,
    kpdmId, setKpdmId, setKpdmNama, jabatanId, setJabatanId, setJabatanNama,
    kpdmEntertainEstimasi, setKpdmEntertainEstimasi, tipeStandarisasi, setTipeStandarisasi,
    periodeBulan, setPeriodeBulan, jumlahBedRs, setJumlahBedRs, estimasiTimelineSelesai, setEstimasiTimelineSelesai,
    produkList, productOptions, productByKode, dokterList, dokterById, updateProduk, addProduk, removeProduk,
    addDokterToProduk, removeDokterFromProduk,
  } = props;

  const [newKpdmName, setNewKpdmName] = useState("");
  const [addingKpdm, setAddingKpdm] = useState(false);
  const [newJabatanName, setNewJabatanName] = useState("");
  const [addingJabatan, setAddingJabatan] = useState(false);
  const disabled = !canEdit;

  const productComboOptions = productOptions.map((p) => ({ value: p.kodeProduk, label: p.namaProduk, sublabel: p.namaGroupBrand }));

  async function handleAddKpdm() {
    if (!newKpdmName.trim()) return;
    const kpdm = await findOrCreateKpdmAction(newKpdmName.trim());
    setKpdmList((prev) => (prev.some((k) => k.id === kpdm.id) ? prev : [...prev, kpdm]));
    setKpdmId(kpdm.id);
    setKpdmNama(kpdm.nama);
    setJabatanId(kpdm.jabatanId);
    setNewKpdmName("");
    setAddingKpdm(false);
  }

  async function handleAddJabatan() {
    if (!newJabatanName.trim()) return;
    const jab = await findOrCreateJabatanAction(newJabatanName.trim());
    setJabatanList((prev) => (prev.some((j) => j.id === jab.id) ? prev : [...prev, jab]));
    setJabatanId(jab.id);
    setJabatanNama(jab.nama);
    setNewJabatanName("");
    setAddingJabatan(false);
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader><CardTitle>Planning Standarisasi</CardTitle></CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <span className="text-sm font-medium block mb-1">KPDM Standarisasi <span style={{ color: "var(--color-error)" }}>*</span></span>
            <Combobox
              name="kpdmId"
              options={kpdmList.map((k) => ({ value: k.id, label: k.nama }))}
              value={kpdmId}
              onChange={(v) => {
                setKpdmId(v);
                const k = kpdmList.find((x) => x.id === v);
                if (k) { setKpdmNama(k.nama); setJabatanId(k.jabatanId); }
              }}
              disabled={disabled}
              placeholder="Cari KPDM…"
            />
            {!addingKpdm ? (
              <button type="button" disabled={disabled} className="text-xs mt-1" style={{ color: "var(--color-blue)" }} onClick={() => setAddingKpdm(true)}>
                + Tambah KPDM baru
              </button>
            ) : (
              <div className="flex gap-1 mt-1">
                <Input value={newKpdmName} onChange={(e) => setNewKpdmName(e.target.value)} placeholder="Nama KPDM baru" className="text-xs" />
                <Button type="button" size="sm" onClick={handleAddKpdm}>Tambah</Button>
              </div>
            )}
          </div>
          <div>
            <span className="text-sm font-medium block mb-1">Jabatan <span style={{ color: "var(--color-error)" }}>*</span></span>
            <select
              className="input-field w-full"
              value={jabatanId ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setJabatanId(v || null);
                const j = jabatanList.find((x) => x.id === v);
                setJabatanNama(j?.nama ?? "");
              }}
            >
              <option value="">— pilih jabatan —</option>
              {jabatanList.map((j) => <option key={j.id} value={j.id}>{j.nama}</option>)}
            </select>
            {!addingJabatan ? (
              <button type="button" disabled={disabled} className="text-xs mt-1" style={{ color: "var(--color-blue)" }} onClick={() => setAddingJabatan(true)}>
                + Tambah Jabatan baru…
              </button>
            ) : (
              <div className="flex gap-1 mt-1">
                <Input value={newJabatanName} onChange={(e) => setNewJabatanName(e.target.value)} placeholder="Nama jabatan baru" className="text-xs" />
                <Button type="button" size="sm" onClick={handleAddJabatan}>Tambah</Button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Input
            label="Entertain Estimasi (KPDM) — Rp"
            type="number"
            value={kpdmEntertainEstimasi}
            onChange={(e) => setKpdmEntertainEstimasi(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <span className="text-sm font-medium block mb-1">Tipe Standarisasi <span style={{ color: "var(--color-error)" }}>*</span></span>
            <select
              className="input-field w-full"
              value={tipeStandarisasi}
              disabled={disabled}
              onChange={(e) => setTipeStandarisasi(e.target.value as "PERIODIC" | "SISIPAN" | "PERMANEN")}
            >
              <option value="PERIODIC">Standarisasi Periodic</option>
              <option value="SISIPAN">Standarisasi Sisipan</option>
              <option value="PERMANEN">Standarisasi Permanen</option>
            </select>
          </div>
          {tipeStandarisasi !== "PERMANEN" && (
            <Input
              label="Periode (bulan)"
              type="number"
              value={periodeBulan}
              onChange={(e) => setPeriodeBulan(e.target.value)}
              disabled={disabled}
            />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Jumlah Bed RS" type="number" value={jumlahBedRs} onChange={(e) => setJumlahBedRs(e.target.value)} disabled={disabled} />
          <Input
            label="Target Penyelesaian Standarisasi"
            type="date"
            value={estimasiTimelineSelesai}
            onChange={(e) => setEstimasiTimelineSelesai(e.target.value)}
            disabled={disabled}
          />
        </div>
      </Card>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">Produk diajukan ({produkList.length})</span>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>
        Produk baru otomatis mewarisi pilihan dokter dari produk sebelumnya — tinggal edit kalau beda.
      </p>

      {produkList.map((p, idx) => {
        const product = productByKode.get(p.kodeProduk);
        const hst = product ? hargaSTFromProduct(product) : 0;
        const qty = (parseFloat(p.jumlahPasien) || 0) * (parseFloat(p.resepPerPasienSt) || 0);
        const nilai = qty * hst;
        return (
          <Card key={idx} className="mb-4" style={{ background: "var(--color-bg-subtle)" }}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>{idx + 1}. {product?.namaProduk ?? "Produk belum dipilih"}</span>
              {!disabled && produkList.length > 1 && (
                <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeProduk(idx)}>Hapus</button>
              )}
            </div>

            <span className="text-xs font-medium block mb-1">Nama Produk *</span>
            <Combobox
              name={`produk-${idx}`}
              options={productComboOptions}
              value={p.kodeProduk}
              onChange={(v) => updateProduk(idx, { kodeProduk: v })}
              disabled={disabled}
              placeholder="Cari produk…"
            />
            {product && (
              <div className="flex gap-4 text-xs mt-2 mb-3" style={{ color: "var(--color-text-muted)" }}>
                <span>HNA SJ: <strong>{formatRp(parseFloat(product.hna))}</strong> ({product.satuan})</span>
                <span>HNA ST: <strong>{formatRp(hst)}</strong> ({product.satuanTerkecil ?? product.satuan})</span>
              </div>
            )}

            <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Estimasi Standarisasi (per bulan)</span>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <Input label="Jumlah Pasien" type="number" value={p.jumlahPasien} onChange={(e) => updateProduk(idx, { jumlahPasien: e.target.value })} disabled={disabled} />
              <Input
                label={`Resep per Pasien${product?.satuanTerkecil ? ` (${product.satuanTerkecil})` : ""}`}
                type="number"
                value={p.resepPerPasienSt}
                onChange={(e) => updateProduk(idx, { resepPerPasienSt: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
              <div className="rounded px-3 py-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Qty / bulan</div>
                <div>{qty ? qty.toLocaleString("id-ID") : "-"} {product?.satuanTerkecil ?? ""}</div>
              </div>
              <div className="rounded px-3 py-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Sales / bulan</div>
                <div>{formatRp(nilai)}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Input label="Estimasi Discount (%)" type="number" value={p.estimasiDiskonPct} onChange={(e) => updateProduk(idx, { estimasiDiskonPct: e.target.value })} disabled={disabled} />
              <Input label="Estimasi Biaya Listing (Rp)" type="number" value={p.estimasiBiayaListingRp} onChange={(e) => updateProduk(idx, { estimasiBiayaListingRp: e.target.value })} disabled={disabled} />
              <Input label="Estimasi Entertain (Rp)" type="number" value={p.estimasiEntertainRp} onChange={(e) => updateProduk(idx, { estimasiEntertainRp: e.target.value })} disabled={disabled} />
            </div>

            <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Dokter Klinis</span>
            {p.dokterCustomerIds.map((cid) => {
              const d = dokterById.get(cid);
              return (
                <div key={cid} className="flex items-center justify-between gap-2 rounded px-3 py-2 mb-1.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <span className="text-sm">{d?.namaCustomer ?? cid}</span>
                  {p.kodeProduk && <GolonganBadge kodeCustomer={d?.kodeCustomer ?? ""} kodePI={kodePI} kodeProduk={p.kodeProduk} />}
                  {!disabled && (
                    <button type="button" className="text-xs shrink-0" style={{ color: "var(--color-error)" }} onClick={() => removeDokterFromProduk(idx, cid)}>Hapus</button>
                  )}
                </div>
              );
            })}
            {!disabled && (
              <Combobox
                name={`dokter-add-${idx}`}
                options={dokterList.filter((d) => !p.dokterCustomerIds.includes(d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.spesialisasi }))}
                value=""
                onChange={(v) => addDokterToProduk(idx, v)}
                placeholder="+ Tambah dokter klinis…"
              />
            )}
          </Card>
        );
      })}
      {!disabled && (
        <div className="flex justify-center mb-4">
          <Button type="button" variant="secondary" size="sm" onClick={addProduk}>+ Tambah produk</Button>
        </div>
      )}
    </>
  );
}

// ─── Phase 2: Approval Atasan ────────────────────────────────────────────────

function ApprovalAtasanPhase({
  pengajuan,
  canApproveAsm,
  canApproveSm,
  onApprove,
}: {
  pengajuan: PoaStandarisasiDetail;
  canApproveAsm: boolean;
  canApproveSm: boolean;
  onApprove: (level: "ASM" | "SM", decision: "DISETUJUI" | "DITOLAK") => void;
}) {
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Approval Atasan</CardTitle></CardHeader>
      <p className="text-sm mb-4" style={{ color: "var(--color-blue)" }}>
        Pengajuan ini perlu disetujui ASM lalu SM sebelum lanjut ke Approval User/Dokter.
      </p>
      <div className="rounded p-4 mb-2" style={{ background: "var(--color-bg-subtle)" }}>
        <ApprovalRow label="Approval ASM" status={pengajuan.statusApprovalAsm} canAct={canApproveAsm} onApprove={(d) => onApprove("ASM", d)} />
        <ApprovalRow
          label="Approval SM"
          status={pengajuan.statusApprovalSm}
          canAct={canApproveSm && pengajuan.statusApprovalAsm === "DISETUJUI"}
          onApprove={(d) => onApprove("SM", d)}
        />
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--color-text-faint)" }}>
        Outlet <strong>{pengajuan.outlet.namaOutlet}</strong> · {pengajuan.produk.length} produk diajukan
      </p>
    </Card>
  );
}

function ApprovalRow({ label, status, canAct, onApprove }: { label: string; status: string; canAct: boolean; onApprove: (d: "DISETUJUI" | "DITOLAK") => void }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <StatusPill status={status} />
        {canAct && status === "MENUNGGU" && (
          <>
            <Button size="sm" onClick={() => onApprove("DISETUJUI")}>Setujui</Button>
            <Button size="sm" variant="danger" onClick={() => onApprove("DITOLAK")}>Tolak</Button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    MENUNGGU: { bg: "var(--color-bg-subtle)", fg: "var(--color-text-faint)", text: "Menunggu" },
    DISETUJUI: { bg: "var(--color-status-approved-bg, #E6F5EC)", fg: "var(--color-status-approved, #008f42)", text: "Disetujui" },
    DITOLAK: { bg: "var(--color-error-bg, #FDECEA)", fg: "var(--color-error)", text: "Ditolak" },
  };
  const s = map[status] ?? map.MENUNGGU;
  return (
    <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

// ─── Phase 3: Approval User/Dokter ──────────────────────────────────────────

function ApprovalUserDokterPhase({
  canEdit,
  pengajuan,
  jadwalMeetingKft,
  setJadwalMeetingKft,
  sudahTtdMap,
  setSudahTtdMap,
}: {
  canEdit: boolean;
  pengajuan: PoaStandarisasiDetail;
  jadwalMeetingKft: string;
  setJadwalMeetingKft: (v: string) => void;
  sudahTtdMap: Record<string, boolean>;
  setSudahTtdMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  async function handleUpload(produkId: string, file: File) {
    setUploading(produkId);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("pengajuanId", pengajuan.id);
      fd.set("kind", "formApproval");
      fd.set("produkId", produkId);
      await uploadPoaStandarisasiFileAction(fd);
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload gagal.");
    } finally {
      setUploading(null);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Approval User / Dokter</CardTitle></CardHeader>
      <div className="max-w-xs mb-4">
        <Input
          label="Jadwal Meeting KFT"
          type="datetime-local"
          value={jadwalMeetingKft}
          onChange={(e) => setJadwalMeetingKft(e.target.value)}
          disabled={!canEdit}
        />
      </div>
      <p className="text-xs rounded px-3 py-2 mb-4" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
        Dokter di bawah ini sudah dipilih saat Planning Standarisasi — centang &quot;Sudah TTD&quot; untuk yang tanda tangannya sudah didapat, lalu upload Form Approval Standarisasi sebagai bukti.
      </p>

      {pengajuan.produk.map((p) => (
        <div key={p.id} className="mb-5">
          <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-blue)" }}>{p.product.namaProduk}</h3>
          {p.dokterApproval.map((d) => {
            const key = `${p.id}:${d.customerId}`;
            return (
              <div key={key} className="flex items-center gap-3 rounded px-3 py-2 mb-1.5 text-sm" style={{ border: "1px solid var(--color-border)" }}>
                <span className="flex-1">{d.customer.namaCustomer}</span>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: d.wajib ? "var(--color-error-bg, #FDECEA)" : "var(--color-bg-subtle)", color: d.wajib ? "var(--color-error)" : "var(--color-text-faint)" }}
                >
                  {d.wajib ? "Wajib" : "Opsional"}
                </span>
                <label className="flex items-center gap-1.5 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={sudahTtdMap[key] ?? false}
                    disabled={!canEdit}
                    onChange={(e) => setSudahTtdMap((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  Sudah TTD
                </label>
              </div>
            );
          })}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs font-medium">Form Approval Standarisasi:</span>
            {p.formApprovalFilePath ? (
              <span className="text-xs" style={{ color: "var(--color-status-approved, #008f42)" }}>✓ {p.formApprovalFilePath}</span>
            ) : (
              <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum diupload</span>
            )}
            {canEdit && (
              <>
                <input
                  ref={(el) => { fileInputRefs.current[p.id] = el; }}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(p.id, f); }}
                />
                <Button type="button" size="sm" variant="secondary" disabled={uploading === p.id} onClick={() => fileInputRefs.current[p.id]?.click()}>
                  {uploading === p.id ? "Mengupload…" : p.formApprovalFilePath ? "Ganti file" : "Upload"}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ─── Phase 4: Finalisasi ─────────────────────────────────────────────────────

function FinalisasiPhase({
  canEdit,
  pengajuan,
  produkList,
  productByKode,
  dokterList,
  dokterById,
  distributorOptions,
  distributorId,
  setDistributorId,
  kpdmEntertainFinal,
  setKpdmEntertainFinal,
  updateProduk,
  addDokterUser,
  updateDokterUser,
  removeDokterUser,
}: {
  canEdit: boolean;
  pengajuan: PoaStandarisasiDetail;
  produkList: ProdukFormState[];
  productByKode: Map<string, Product>;
  dokterList: CustomerOption[];
  dokterById: Map<string, CustomerOption>;
  distributorOptions: { id: string; nama: string }[];
  distributorId: string;
  setDistributorId: (v: string) => void;
  kpdmEntertainFinal: string;
  setKpdmEntertainFinal: (v: string) => void;
  updateProduk: (idx: number, patch: Partial<ProdukFormState>) => void;
  addDokterUser: (idx: number, rawId: string) => Promise<void>;
  updateDokterUser: (idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) => void;
  removeDokterUser: (idx: number, customerId: string) => void;
}) {
  const disabled = !canEdit || !!pengajuan.submittedAt;
  const [uploadingKft, setUploadingKft] = useState(false);
  const kftInputRef = useRef<HTMLInputElement | null>(null);

  async function handleUploadKft(file: File) {
    setUploadingKft(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("pengajuanId", pengajuan.id);
      fd.set("kind", "suratKft");
      await uploadPoaStandarisasiFileAction(fd);
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload gagal.");
    } finally {
      setUploadingKft(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Finalisasi</CardTitle></CardHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <span className="text-xs font-medium block mb-1">Nama KPDM</span>
          <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>{pengajuan.kpdmNamaSnapshot}</div>
        </div>
        <div>
          <span className="text-xs font-medium block mb-1">Jabatan</span>
          <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>{pengajuan.jabatanNamaSnapshot ?? "-"}</div>
        </div>
        <Input label="Entertain Final (KPDM) — Rp" type="number" value={kpdmEntertainFinal} onChange={(e) => setKpdmEntertainFinal(e.target.value)} disabled={disabled} />
      </div>

      <div className="mb-4">
        <span className="text-sm font-medium block mb-1">Surat Approval Standarisasi KFT <span style={{ color: "var(--color-error)" }}>*</span></span>
        <div className="flex items-center gap-3">
          {pengajuan.suratApprovalStandarisasiKftPath ? (
            <span className="text-xs" style={{ color: "var(--color-status-approved, #008f42)" }}>✓ {pengajuan.suratApprovalStandarisasiKftPath}</span>
          ) : (
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum diupload</span>
          )}
          {!disabled && (
            <>
              <input
                ref={kftInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadKft(f); }}
              />
              <Button type="button" size="sm" variant="secondary" disabled={uploadingKft} onClick={() => kftInputRef.current?.click()}>
                {uploadingKft ? "Mengupload…" : "Upload"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="max-w-sm mb-6">
        <span className="text-sm font-medium block mb-1">Distributor yang Akan Digunakan</span>
        <select className="input-field w-full" value={distributorId} disabled={disabled} onChange={(e) => setDistributorId(e.target.value)}>
          <option value="">— pilih distributor —</option>
          {distributorOptions.map((d) => <option key={d.id} value={d.id}>{d.nama}</option>)}
        </select>
      </div>

      {produkList.filter((p) => p.id).map((p) => {
        const idx = produkList.indexOf(p);
        const product = productByKode.get(p.kodeProduk);
        const totalQty = p.dokterUser.reduce((s, d) => s + (parseFloat(d.jumlahPasien) || 0) * (parseFloat(d.resepPerPasienSt) || 0), 0);
        const hst = product ? hargaSTFromProduct(product) : 0;
        const totalSales = totalQty * hst;
        const totalEntertain = p.dokterUser.reduce((s, d) => s + (parseFloat(d.entertainRp) || 0), 0);
        return (
          <div key={p.id} className="rounded-lg p-4 mb-4" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border-strong, var(--color-border))" }}>
            <div className="text-sm font-bold mb-3" style={{ color: "var(--color-blue)" }}>{product?.namaProduk ?? p.kodeProduk}</div>
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Finalisasi Biaya</span>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Input label="Discount Final (%)" type="number" value={p.finalDiscountPct} onChange={(e) => updateProduk(idx, { finalDiscountPct: e.target.value })} disabled={disabled} />
              <Input label="Diskon Distributor (%)" type="number" value={p.diskonDistributorPct} onChange={(e) => updateProduk(idx, { diskonDistributorPct: e.target.value })} disabled={disabled} />
              <Input label="Biaya Listing Final (Rp)" type="number" value={p.finalBiayaListingRp} onChange={(e) => updateProduk(idx, { finalBiayaListingRp: e.target.value })} disabled={disabled} />
            </div>

            <span className="text-xs font-medium block mb-2">Dokter yang Akan Menjadi User</span>
            {p.dokterUser.length === 0 ? (
              <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada dokter yang sudah TTD untuk produk ini.</p>
            ) : (
              <div className="overflow-x-auto mb-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)" }}>
                      <th className="text-left py-1">Dokter</th>
                      <th className="text-right py-1">Jumlah Pasien</th>
                      <th className="text-right py-1">Resep/Pasien</th>
                      <th className="text-right py-1">Est. Qty/bln</th>
                      <th className="text-right py-1">Est. Sales/bln</th>
                      <th className="text-right py-1">Entertain</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.dokterUser.map((d) => {
                      const dq = (parseFloat(d.jumlahPasien) || 0) * (parseFloat(d.resepPerPasienSt) || 0);
                      return (
                        <tr key={d.customerId} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td className="py-1.5">{dokterById.get(d.customerId)?.namaCustomer ?? d.customerId}</td>
                          <td className="py-1.5"><input type="number" className="input-field text-right w-20" value={d.jumlahPasien} disabled={disabled} onChange={(e) => updateDokterUser(idx, d.customerId, { jumlahPasien: e.target.value })} /></td>
                          <td className="py-1.5"><input type="number" className="input-field text-right w-20" value={d.resepPerPasienSt} disabled={disabled} onChange={(e) => updateDokterUser(idx, d.customerId, { resepPerPasienSt: e.target.value })} /></td>
                          <td className="py-1.5 text-right">{dq ? dq.toLocaleString("id-ID") : "-"}</td>
                          <td className="py-1.5 text-right">{formatRp(dq * hst)}</td>
                          <td className="py-1.5"><input type="number" className="input-field text-right w-24" value={d.entertainRp} disabled={disabled} onChange={(e) => updateDokterUser(idx, d.customerId, { entertainRp: e.target.value })} /></td>
                          <td>{!disabled && <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeDokterUser(idx, d.customerId)}>✕</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid var(--color-border-strong, var(--color-border))", fontWeight: 700 }}>
                      <td colSpan={3} className="py-1.5">Total</td>
                      <td className="py-1.5 text-right">{totalQty.toLocaleString("id-ID")}</td>
                      <td className="py-1.5 text-right">{formatRp(totalSales)}</td>
                      <td className="py-1.5 text-right">{formatRp(totalEntertain)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {!disabled && (
              <Combobox
                name={`dokteruser-add-${idx}`}
                options={dokterList.filter((d) => !p.dokterUser.some((du) => du.customerId === d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.spesialisasi }))}
                value=""
                onChange={(v) => addDokterUser(idx, v)}
                placeholder="+ Tambah dokter…"
              />
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ─── Ringkasan POA (shared, bottom) ──────────────────────────────────────────

function RingkasanPoa({ produkList, productByKode, kpdmEntertain }: { produkList: ProdukFormState[]; productByKode: Map<string, Product>; kpdmEntertain: string }) {
  const rows = produkList
    .filter((p) => p.kodeProduk)
    .map((p) => {
      const product = productByKode.get(p.kodeProduk);
      const hst = product ? hargaSTFromProduct(product) : 0;
      const qty = (parseFloat(p.jumlahPasien) || 0) * (parseFloat(p.resepPerPasienSt) || 0);
      const nilai = qty * hst;
      const discountPct = parseFloat(p.estimasiDiskonPct) || 0;
      const listingRp = parseFloat(p.estimasiBiayaListingRp) || 0;
      const entertainRp = parseFloat(p.estimasiEntertainRp) || 0;
      const listingPct = nilai ? (listingRp / nilai) * 100 : 0;
      const entertainPct = nilai ? (entertainRp / nilai) * 100 : 0;
      const totalBudgetPct = discountPct + listingPct + entertainPct;
      return { product, qty, nilai, discountPct, listingRp, listingPct, entertainRp, entertainPct, totalBudgetPct };
    });

  const totalSales = rows.reduce((s, r) => s + r.nilai, 0);
  const totalListing = rows.reduce((s, r) => s + r.listingRp, 0);
  const totalEntertainProduk = rows.reduce((s, r) => s + r.entertainRp, 0);
  const kpdmEntertainNum = parseFloat(kpdmEntertain) || 0;

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl p-5 mt-5" style={{ border: "2px dashed var(--color-blue)", background: "var(--color-surface, #fff)" }}>
      <div className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: "var(--color-text-faint)" }}>Total Semua Produk</div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
        <Stat label="Jumlah Produk" value={String(rows.length)} />
        <Stat label="Total Estimasi Sales / bln" value={formatRp(totalSales)} />
        <Stat label="Total Biaya Listing (Rp)" value={formatRp(totalListing)} />
        <Stat label="Total Biaya Entertain (Rp)" value={formatRp(totalEntertainProduk + kpdmEntertainNum)} sub={`Entertain KPDM: ${formatRp(kpdmEntertainNum)}`} />
        <Stat label="Total % Budget (avg)" value={rows.length ? `${(rows.reduce((s, r) => s + r.totalBudgetPct, 0) / rows.length).toFixed(1)}%` : "-"} />
      </div>
      <hr className="mb-3" style={{ borderColor: "var(--color-border)" }} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--color-text-faint)" }}>
              <th className="text-left py-1">Produk</th>
              <th className="text-right py-1">Qty/bln</th>
              <th className="text-right py-1">Estimasi/bln</th>
              <th className="text-right py-1">Discount</th>
              <th className="text-right py-1">Biaya Listing</th>
              <th className="text-right py-1">Entertain</th>
              <th className="text-right py-1">% Budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="py-1.5 font-semibold" style={{ color: "var(--color-blue)" }}>{r.product?.namaProduk ?? "-"}</td>
                <td className="py-1.5 text-right">{r.qty ? r.qty.toLocaleString("id-ID") : "-"} {r.product?.satuanTerkecil ?? ""}</td>
                <td className="py-1.5 text-right">{formatRp(r.nilai)}</td>
                <td className="py-1.5 text-right">{r.discountPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right">{r.listingPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right">{r.entertainPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right font-semibold">{r.totalBudgetPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-lg font-bold" style={{ color: "var(--color-blue)" }}>{value}</div>
      {sub && <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--color-text-faint)" }}>{sub}</div>}
    </div>
  );
}
