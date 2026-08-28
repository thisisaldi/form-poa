"use client";

import { useMemo, useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import type { Product } from "@/lib/masterData";
import type { CustomerOption } from "@/app/actions/customer";
import { createCustomerAction } from "@/app/actions/customer";
import { GolonganBadge } from "@/components/poaStandarisasi/GolonganBadge";
import { RekomendasiSidebar } from "@/components/poaStandarisasi/RekomendasiSidebar";
import { buildProductOptions } from "@/components/poa/LineItemEditor";
import { PHASES } from "@/lib/poaStandarisasiPhases";
import {
  savePlanningAction,
  advanceToApprovalAtasanAction,
  approvePoaStandarisasiAtasanAction,
  addDokterApprovalAction,
  removeDokterApprovalAction,
  advanceToMenungguMeetingKftAction,
  saveMenungguMeetingKftAction,
  advanceToFinalisasiAction,
  saveFinalisasiAction,
  submitPoaStandarisasiAction,
  uploadPoaStandarisasiFileAction,
  getPoaStandarisasiFileAccessLogAction,
  getStatusPengajuanPreviewAction,
  getEstimasiDiskonPreviewAction,
  getMarginWarningBaselineAction,
} from "@/app/actions/poaStandarisasi";
import { POA_STANDARISASI_UPLOAD_DISABLED, POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE } from "@/lib/poaStandarisasiUploadFlag";
import {
  type PoaStandarisasiDetail,
  type PlanningInput,
  type PlanningProdukInput,
  type FileAccessLogRow,
} from "@/app/actions/poaStandarisasi";

export { PHASES };

const DOKUMEN_JENIS: { jenis: string; label: string }[] = [
  { jenis: "NIE", label: "NIE" },
  { jenis: "COA", label: "COA" },
  { jenis: "CPOB", label: "CPOB" },
  { jenis: "FLYER", label: "Flyer" },
  { jenis: "SP_NON_SALES", label: "Permintaan SP Non Sales" },
];
/** Shown at "Menunggu Meeting KFT" — dokumen yang dibawa ke rapat KFT (2026-08-27: NIE/COA/CPOB/Flyer, koreksi dari NIE/CPOB/KFA). */
const DOKUMEN_JENIS_KFT = DOKUMEN_JENIS.filter((d) => d.jenis !== "SP_NON_SALES");
/** Shown at "Finalisasi" (2026-08-26, user request) — bukan dokumen rapat KFT. */
const DOKUMEN_JENIS_FINALISASI = DOKUMEN_JENIS.filter((d) => d.jenis === "SP_NON_SALES");

/**
 * Every document link in this wizard MUST go through this authenticated
 * proxy — not a raw Drive URL — because these documents are confidential
 * (2026-08-27, user request): a raw Drive link's visibility follows the
 * shared folder's sharing setting, not this app's authz, and gives no way to
 * log who opened it. See /api/poa-standarisasi/dokumen/[driveFileId].
 */
function driveViewUrl(driveFileId: string): string {
  return `/api/poa-standarisasi/dokumen/${driveFileId}`;
}

function formatRp(n: number | null | undefined): string {
  if (n == null) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

/**
 * Rp input — plain text field (not type="number") so it can show live thousand-
 * separator formatting ("2.500.000") and never gets the browser's up/down
 * spinner arrows, which only belong on the diskon (%) fields.
 */
function RpInput({
  label,
  value,
  onChange,
  disabled,
  dense,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  dense?: boolean;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value.replace(/\D/g, ""));
  }
  const display = value ? Number(value).toLocaleString("id-ID") : "";
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{label}</span>}
      <div
        className="flex items-stretch rounded-md overflow-hidden"
        style={{ border: "1px solid var(--color-border-strong)", background: disabled ? "var(--color-bg-subtle)" : "var(--color-surface, #fff)" }}
      >
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={display}
          onChange={handleChange}
          disabled={disabled}
          className={dense ? "flex-1 min-w-0 w-0 px-2 py-1 text-xs text-right outline-none" : "flex-1 min-w-0 w-0 px-3 py-2 text-sm text-right outline-none"}
          style={{ background: "transparent", color: "var(--color-text)" }}
        />
        <span style={{ width: 1, background: "var(--color-border-strong)" }} />
        <span
          className={dense ? "flex items-center px-1.5 text-[10px] font-medium whitespace-nowrap" : "flex items-center px-2.5 text-xs font-medium whitespace-nowrap"}
          style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}
        >
          Rp
        </span>
      </div>
    </div>
  );
}

/** Standarisasi Periodic only offers these fixed periods (TODO #8) — Sisipan stays free-entry (TODO #9). */
const PERIODE_PERIODIC_OPTIONS = [6, 12, 18, 24, 30, 36];

/** Fixed set, matches the DistributorPilihan enum — not master data. */
const DISTRIBUTOR_OPTIONS = ["AMS", "PPG", "MPI"] as const;

/**
 * Plain numeric input with a unit badge (e.g. "Bulan", "Pasien", "%") — same
 * box styling as RpInput, no thousand-separator formatting. Digits-only regex
 * means it can never go negative (no "-" allowed), unlike the native
 * type="number" inputs it replaces. `dense` shrinks padding/font for use
 * inside table cells (e.g. the dokter tables).
 */
function UnitCountInput({
  label,
  unit,
  value,
  onChange,
  disabled,
  dense,
}: {
  label?: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  dense?: boolean;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
  }
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{label}</span>}
      <div
        className="flex items-stretch rounded-md overflow-hidden"
        style={{ border: "1px solid var(--color-border-strong)", background: disabled ? "var(--color-bg-subtle)" : "var(--color-surface, #fff)" }}
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={dense ? "flex-1 min-w-0 w-0 px-2 py-1 text-xs text-right outline-none" : "flex-1 min-w-0 w-0 px-3 py-2 text-sm text-right outline-none"}
          style={{ background: "transparent", color: "var(--color-text)" }}
        />
        <span style={{ width: 1, background: "var(--color-border-strong)" }} />
        <span
          className={dense ? "flex items-center px-1.5 text-[10px] font-medium whitespace-nowrap" : "flex items-center px-2.5 text-xs font-medium whitespace-nowrap"}
          style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

// Target gross margin — historical sales × this %, compared against the NEW
// discount's Rp cost on NEW estimated sales (see getMarginWarningBaselineAction).
// Replaces a flat "diskon% > 20%" cap that had no historical basis (2026-08-28
// user correction). Warning-only (matches POA Estimasi's "OVER BUDGET"
// pattern, LineItemEditor.tsx:1419) — doesn't block submit.
const MARGIN_CAP_PCT = 20;

const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Month-only picker (TODO #10) — separate Bulan + Tahun selects (not one long
 * combined dropdown) that together store the 1st of the selected month as
 * "yyyy-mm-01", not an exact date. Year range covers the longest Periodic
 * option (see PERIODE_PERIODIC_OPTIONS) plus buffer. */
function MonthYearPicker({ label, value, onChange, disabled }: { label?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const years = useMemo(() => Array.from({ length: 4 }, (_, i) => currentYear + i), [currentYear]);

  // Tracked as their OWN state (not derived solely from `value`) so picking
  // just one of the two visibly sticks right away — deriving purely from
  // `value` meant picking only the month (with no year yet) computed back to
  // "" every render, since the combined date isn't complete until both are
  // set, making the Bulan dropdown look like it never responded to a click.
  const [mm, setMm] = useState(value ? value.slice(5, 7) : "");
  const [yyyy, setYyyy] = useState(value ? value.slice(0, 4) : "");

  // Stay in sync if the parent resets/loads `value` from elsewhere (e.g. an existing pengajuan).
  useEffect(() => {
    setMm(value ? value.slice(5, 7) : "");
    setYyyy(value ? value.slice(0, 4) : "");
  }, [value]);

  // Target can't be in the past. Treat "year not chosen yet" the same as
  // "current year" for this restriction — years[] itself never goes below
  // currentYear, so that's the safe default rather than allowing an early
  // month pick that turns invalid the moment the current year gets chosen.
  const minMonth = !yyyy || Number(yyyy) === currentYear ? currentMonth : 1;
  const monthOptions = BULAN_ID
    .map((b, i) => ({ value: String(i + 1).padStart(2, "0"), label: b, num: i + 1 }))
    .filter((o) => o.num >= minMonth);

  function handleMonth(v: string) {
    setMm(v);
    onChange(v && yyyy ? `${yyyy}-${v}-01` : "");
  }
  function handleYear(v: string) {
    // Switching to the current year can strand an already-picked past month — clear it rather than silently keep an invalid combined date.
    const clearedMm = v === String(currentYear) && mm && Number(mm) < currentMonth;
    const nextMm = clearedMm ? "" : mm;
    if (clearedMm) setMm("");
    setYyyy(v);
    onChange(nextMm && v ? `${v}-${nextMm}-01` : "");
  }

  return (
    <div>
      {label && <span className="text-sm font-medium block mb-1">{label}</span>}
      <div className="flex gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <Combobox
            name="targetBulan"
            options={monthOptions}
            value={mm}
            onChange={handleMonth}
            disabled={disabled}
            placeholder="Bulan…"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Combobox
            name="targetTahun"
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            value={yyyy}
            onChange={handleYear}
            disabled={disabled}
            placeholder="Tahun…"
          />
        </div>
      </div>
    </div>
  );
}

function hargaSTFromProduct(p: Product): number {
  const hna = parseFloat(p.hna) || 0;
  const konversi = parseFloat(p.konversiPembagi ?? "1") || 1;
  return hna / konversi;
}

export interface DokterKlinisFormState {
  customerId: string;
  jumlahPasien: string;
  resepPerPasienSt: string;
  entertainRp: string;
}

/** A pengajuan can have more than one KPDM (2026-08-20) — each is a customer/dokter at the outlet, jabatan derived from spesialisasi, entertain tracked PER PERSON. */
export interface KpdmFormState {
  customerId: string;
  nama: string;
  jabatan: string;
  entertainEstimasi: string;
  entertainFinal: string;
}

function kpdmFromDetail(k: PoaStandarisasiDetail["kpdmList"][number]): KpdmFormState {
  return {
    customerId: k.customerId,
    nama: k.namaSnapshot,
    jabatan: k.jabatanSnapshot ?? "",
    entertainEstimasi: k.entertainEstimasi != null ? String(k.entertainEstimasi) : "",
    // Final defaults to the estimate already entered at Planning — Finalisasi tweaks it, doesn't start blank.
    entertainFinal: k.entertainFinal != null ? String(k.entertainFinal) : k.entertainEstimasi != null ? String(k.entertainEstimasi) : "",
  };
}

export interface ProdukFormState {
  id?: string;
  kodeProduk: string;
  // Baru vs Perpanjangan — per produk (2026-08-27: dipindah dari level
  // pengajuan, status standarisasi memang berbeda per produk).
  statusPengajuan: "BARU" | "PERPANJANGAN";
  estimasiDiskonPct: string;
  estimasiBiayaListingRp: string;
  dokterKlinis: DokterKlinisFormState[];
  finalDiscountPct: string;
  diskonDistributorPct: string;
  finalBiayaListingRp: string;
  dokterUser: { customerId: string; jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }[];
}

export function emptyProduk(inherit?: ProdukFormState): ProdukFormState {
  return {
    kodeProduk: "",
    statusPengajuan: inherit?.statusPengajuan ?? "BARU",
    estimasiDiskonPct: "",
    estimasiBiayaListingRp: "",
    // New product inherits WHICH dokter to consider, not their estimate figures.
    dokterKlinis: inherit
      ? inherit.dokterKlinis.map((dk) => ({ customerId: dk.customerId, jumlahPasien: "", resepPerPasienSt: "", entertainRp: "" }))
      : [],
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
    statusPengajuan: p.statusPengajuan,
    estimasiDiskonPct: p.estimasiDiskonPct != null ? String(p.estimasiDiskonPct) : "",
    estimasiBiayaListingRp: p.estimasiBiayaListingRp != null ? String(p.estimasiBiayaListingRp) : "",
    dokterKlinis: p.dokterApproval.map((d) => ({
      customerId: d.customerId,
      jumlahPasien: d.jumlahPasien != null ? String(d.jumlahPasien) : "",
      resepPerPasienSt: d.resepPerPasienSt != null ? String(d.resepPerPasienSt) : "",
      entertainRp: d.entertainRp != null ? String(d.entertainRp) : "",
    })),
    // Final fields default to what was already entered as the estimate at Planning — Finalisasi tweaks those numbers, not starting blank.
    finalDiscountPct:
      p.finalDiscountPct != null ? String(p.finalDiscountPct) : p.estimasiDiskonPct != null ? String(p.estimasiDiskonPct) : "",
    diskonDistributorPct: p.diskonDistributorPct != null ? String(p.diskonDistributorPct) : "",
    finalBiayaListingRp:
      p.finalBiayaListingRp != null ? String(p.finalBiayaListingRp) : p.estimasiBiayaListingRp != null ? String(p.estimasiBiayaListingRp) : "",
    dokterUser:
      p.dokterUser.length > 0
        ? p.dokterUser.map((d) => ({
            customerId: d.customerId,
            jumlahPasien: d.jumlahPasien != null ? String(d.jumlahPasien) : "",
            resepPerPasienSt: d.resepPerPasienSt != null ? String(d.resepPerPasienSt) : "",
            entertainRp: d.entertainRp != null ? String(d.entertainRp) : "",
          }))
        : // Default candidates: dokter who already signed (sudahTtd) in Phase 3,
          // pre-filled with what was already entered at Planning so Finalisasi is
          // actually a TWEAK of those numbers, not starting over from blank.
          p.dokterApproval
            .filter((d) => d.sudahTtd)
            .map((d) => ({
              customerId: d.customerId,
              jumlahPasien: d.jumlahPasien != null ? String(d.jumlahPasien) : "",
              resepPerPasienSt: d.resepPerPasienSt != null ? String(d.resepPerPasienSt) : "",
              entertainRp: d.entertainRp != null ? String(d.entertainRp) : "",
            })),
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
  dokterOptions,
  canEdit,
  canApproveAsm,
  canApproveSm,
  canApproveNsm,
  isOwner,
}: {
  pengajuan: PoaStandarisasiDetail;
  productOptions: Product[];
  dokterOptions: CustomerOption[];
  canEdit: boolean;
  canApproveAsm: boolean;
  canApproveSm: boolean;
  canApproveNsm: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentStepIdx = PHASES.findIndex((p) => p.id === pengajuan.currentPhase);

  // Which phase's content is shown — lets the Stepper navigate back to review
  // an already-completed phase without changing pengajuan.currentPhase itself.
  // Defaults to the actual current phase.
  const [viewedPhaseId, setViewedPhaseId] = useState<PoaStandarisasiDetail["currentPhase"]>(pengajuan.currentPhase);
  const viewedStepIdx = PHASES.findIndex((p) => p.id === viewedPhaseId);
  const isViewingCurrentPhase = viewedPhaseId === pengajuan.currentPhase;

  // Clicking "Lanjut ke ..." advances pengajuan.currentPhase server-side and
  // router.refresh()es this same component instance — state (viewedPhaseId)
  // survives a refresh, so without this the view stayed stuck on the phase
  // just left instead of following the newly-advanced phase.
  useEffect(() => {
    setViewedPhaseId(pengajuan.currentPhase);
  }, [pengajuan.currentPhase]);

  // ── Local mutable master data (grows when a "nexus:" id gets materialized) ─
  const [dokterList, setDokterList] = useState(dokterOptions);

  // ── Phase 1 state ──────────────────────────────────────────────────────
  // KPDM is a list of customers/dokter at this outlet (Nexus-backed, same
  // pool as Dokter Klinis below) — can be more than one (2026-08-20). Jabatan
  // per person is that customer's spesialisasi, read-only.
  const [kpdmList, setKpdmList] = useState<KpdmFormState[]>(() => pengajuan.kpdmList.map(kpdmFromDetail));
  const [tipeStandarisasi, setTipeStandarisasi] = useState(pengajuan.tipeStandarisasi);
  const [periodeBulan, setPeriodeBulan] = useState(pengajuan.periodeBulan != null ? String(pengajuan.periodeBulan) : "");
  const [jumlahBedRs, setJumlahBedRs] = useState(pengajuan.jumlahBedRs != null ? String(pengajuan.jumlahBedRs) : "");
  const [estimasiTimelineSelesai, setEstimasiTimelineSelesai] = useState(isoDateInput(pengajuan.estimasiTimelineSelesai));
  const [produkList, setProdukList] = useState<ProdukFormState[]>(() =>
    pengajuan.produk.length > 0 ? pengajuan.produk.map(produkFromDetail) : [emptyProduk()]
  );

  // ── Phase 4 state (Menunggu Meeting KFT) ────────────────────────────────
  const [jadwalMeetingKft, setJadwalMeetingKft] = useState(isoDatetimeLocalInput(pengajuan.jadwalMeetingKft));

  // ── Phase 5 state (Finalisasi) ──────────────────────────────────────────
  const [distributors, setDistributors] = useState<string[]>(pengajuan.distributors ?? []);

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

  /** KPDM is picked from the same outlet customer pool as Dokter Klinis — jabatan is that customer's spesialisasi, not independently pickable. A pengajuan can have more than one. */
  async function addKpdm(rawId: string) {
    if (!rawId) return;
    const opt = dokterById.get(rawId);
    const realId = await resolveDokterId(rawId);
    if (!opt) return;
    setKpdmList((prev) =>
      prev.some((k) => k.customerId === realId)
        ? prev
        : [...prev, { customerId: realId, nama: opt.namaCustomer, jabatan: opt.jabatan, entertainEstimasi: "", entertainFinal: "" }]
    );
  }
  function removeKpdm(customerId: string) {
    setKpdmList((prev) => prev.filter((k) => k.customerId !== customerId));
  }
  function updateKpdmEntertainEstimasi(customerId: string, v: string) {
    setKpdmList((prev) => prev.map((k) => (k.customerId === customerId ? { ...k, entertainEstimasi: v } : k)));
  }
  function updateKpdmEntertainFinal(customerId: string, v: string) {
    setKpdmList((prev) => prev.map((k) => (k.customerId === customerId ? { ...k, entertainFinal: v } : k)));
  }

  function buildPlanningPayload(): PlanningInput {
    return {
      kpdmList: kpdmList.map((k) => ({ customerId: k.customerId, nama: k.nama, jabatan: k.jabatan || null, entertainEstimasi: k.entertainEstimasi || null })),
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
            estimasiDiskonPct: p.estimasiDiskonPct || null,
            estimasiBiayaListingRp: p.estimasiBiayaListingRp || null,
            dokterKlinis: p.dokterKlinis.map((dk) => ({
              customerId: dk.customerId,
              jumlahPasien: dk.jumlahPasien || null,
              resepPerPasienSt: dk.resepPerPasienSt || null,
              entertainRp: dk.entertainRp || null,
            })),
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

  function handleApprove(level: "ASM" | "SM" | "NSM", decision: "DISETUJUI" | "DITOLAK") {
    run(async () => approvePoaStandarisasiAtasanAction(pengajuan.id, level, decision));
  }

  function handleAdvanceToMenungguKft() {
    run(async () => advanceToMenungguMeetingKftAction(pengajuan.id));
  }

  function handleSaveMenungguKft() {
    run(async () => saveMenungguMeetingKftAction(pengajuan.id, { jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft).toISOString() : null }));
  }

  function handleAdvanceToFinalisasi() {
    run(async () => {
      await saveMenungguMeetingKftAction(pengajuan.id, { jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft).toISOString() : null });
      await advanceToFinalisasiAction(pengajuan.id);
    });
  }

  function buildFinalisasiPayload() {
    return {
      distributors,
      kpdmList: kpdmList.map((k) => ({ customerId: k.customerId, entertainFinal: k.entertainFinal || null })),
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
      prev.map((p, i) =>
        i === idx && !p.dokterKlinis.some((dk) => dk.customerId === realId)
          ? { ...p, dokterKlinis: [...p.dokterKlinis, { customerId: realId, jumlahPasien: "", resepPerPasienSt: "", entertainRp: "" }] }
          : p
      )
    );
  }
  function removeDokterFromProduk(idx: number, customerId: string) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, dokterKlinis: p.dokterKlinis.filter((dk) => dk.customerId !== customerId) } : p)));
  }
  function updateDokterKlinis(idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) {
    setProdukList((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, dokterKlinis: p.dokterKlinis.map((dk) => (dk.customerId === customerId ? { ...dk, ...patch } : dk)) } : p
      )
    );
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
        <Link href="/poa-standarisasi" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
          ← Daftar POA Standarisasi
        </Link>
        <h1 className="mt-1">Pengajuan Standarisasi — {pengajuan.outlet.namaOutlet}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Standarisasi (Produk × Outlet)
        </p>
      </div>

      <Stepper
        currentIdx={currentStepIdx}
        viewedIdx={viewedStepIdx}
        onSelect={(idx) => {
          if (idx <= currentStepIdx) setViewedPhaseId(PHASES[idx].id);
        }}
      />

      {!isOwner && (
        <div className="mb-4 rounded px-3 py-2 text-xs" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
          Anda melihat pengajuan ini sebagai atasan (bukan pembuat) — hanya bagian Approval Atasan yang bisa Anda tindak lanjuti.
        </div>
      )}

      {!isViewingCurrentPhase && (
        <div className="mb-4 rounded px-3 py-2 text-xs" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
          Anda melihat histori tahap &quot;{PHASES[viewedStepIdx]?.label}&quot; — tidak bisa diedit dari sini. Klik &quot;{PHASES[currentStepIdx]?.label}&quot; di atas untuk kembali ke tahap yang sedang berjalan.
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

      {viewedPhaseId === "PLANNING" && (
        <PlanningPhase
          canEdit={canEdit && isViewingCurrentPhase}
          kodePI={pengajuan.kodePI}
          namaOutlet={pengajuan.outlet.namaOutlet}
          pengajuanId={pengajuan.id}
          kpdmList={kpdmList}
          addKpdm={addKpdm}
          removeKpdm={removeKpdm}
          updateKpdmEntertainEstimasi={updateKpdmEntertainEstimasi}
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
          updateDokterKlinis={updateDokterKlinis}
        />
      )}

      {viewedPhaseId === "APPROVAL_ATASAN" && (
        <ApprovalAtasanPhase
          pengajuan={pengajuan}
          canApproveAsm={canApproveAsm && isViewingCurrentPhase}
          canApproveSm={canApproveSm && isViewingCurrentPhase}
          canApproveNsm={canApproveNsm && isViewingCurrentPhase}
          onApprove={handleApprove}
        />
      )}

      {viewedPhaseId === "APPROVAL_USER_DOKTER" && (
        <ApprovalUserDokterPhase
          canEdit={canEdit && isViewingCurrentPhase}
          pengajuan={pengajuan}
          dokterList={dokterList}
          resolveDokterId={resolveDokterId}
        />
      )}

      {viewedPhaseId === "MENUNGGU_MEETING_KFT" && (
        <MenungguMeetingKftPhase
          canEdit={canEdit && isViewingCurrentPhase}
          pengajuan={pengajuan}
          jadwalMeetingKft={jadwalMeetingKft}
          setJadwalMeetingKft={setJadwalMeetingKft}
        />
      )}

      {viewedPhaseId === "FINALISASI" && (
        <FinalisasiPhase
          canEdit={canEdit && isViewingCurrentPhase}
          pengajuan={pengajuan}
          produkList={produkList}
          productByKode={productByKode}
          dokterList={dokterList}
          dokterById={dokterById}
          distributors={distributors}
          setDistributors={setDistributors}
          kpdmList={kpdmList}
          updateKpdmEntertainFinal={updateKpdmEntertainFinal}
          updateProduk={updateProduk}
          addDokterUser={addDokterUser}
          updateDokterUser={updateDokterUser}
          removeDokterUser={removeDokterUser}
        />
      )}

      <RingkasanPoa produkList={produkList} productByKode={productByKode} kpdmList={kpdmList} />
      <DokumenAccessLogPanel pengajuanId={pengajuan.id} />

      <div className="flex justify-between mt-4">
        <div />
        <div className="flex gap-2">
          {isViewingCurrentPhase && pengajuan.currentPhase === "PLANNING" && canEdit && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSavePlanning}>Simpan Draft</Button>
              <Button disabled={pending} onClick={handleAdvanceToApprovalAtasan}>Lanjut ke Approval Atasan</Button>
            </>
          )}
          {isViewingCurrentPhase && pengajuan.currentPhase === "APPROVAL_USER_DOKTER" && canEdit && (
            <Button disabled={pending} onClick={handleAdvanceToMenungguKft}>Lanjut ke Menunggu Meeting KFT</Button>
          )}
          {isViewingCurrentPhase && pengajuan.currentPhase === "MENUNGGU_MEETING_KFT" && canEdit && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSaveMenungguKft}>Simpan</Button>
              <Button disabled={pending} onClick={handleAdvanceToFinalisasi}>Lanjut ke Finalisasi</Button>
            </>
          )}
          {isViewingCurrentPhase && pengajuan.currentPhase === "FINALISASI" && canEdit && !pengajuan.submittedAt && (
            <>
              <Button variant="secondary" disabled={pending} onClick={handleSaveFinalisasi}>Simpan</Button>
              {/* Placeholder only (docs/poa-standarisasi/01-business-rules.md §7 Q7) — no
                  real DPL/DPF system integration in v1, not wired to anything yet. */}
              <Button variant="secondary" disabled title="Belum tersedia — integrasi sistem DPL/DPF belum ada di v1">+ Buat DPL/DPF baru</Button>
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

/**
 * currentIdx = actual server-side progress (drives the ✓/blue-line "done" state).
 * viewedIdx = which phase's content is currently shown (drives the "active"
 * highlight) — lets a step already reached (i <= currentIdx) be clicked to
 * review it without changing pengajuan.currentPhase. Defaults to currentIdx
 * for callers (e.g. the "new" create form) that have no navigation concept.
 */
export function Stepper({ currentIdx, viewedIdx, onSelect }: { currentIdx: number; viewedIdx?: number; onSelect?: (idx: number) => void }) {
  const activeIdx = viewedIdx ?? currentIdx;
  return (
    <div className="flex items-start gap-2 mb-6 max-w-3xl">
      {PHASES.map((p, i) => {
        const done = i < currentIdx;
        const active = i === activeIdx;
        const selectable = !!onSelect && i <= currentIdx;
        return (
          <div key={p.id} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div
                className="absolute h-0.5 top-4"
                style={{ left: "-50%", right: "50%", background: i <= currentIdx ? "var(--color-blue)" : "var(--color-border)" }}
              />
            )}
            <button
              type="button"
              disabled={!selectable}
              onClick={() => onSelect?.(i)}
              className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-semibold z-10"
              style={{
                borderColor: done || active ? "var(--color-blue)" : "var(--color-border)",
                background: done ? "var(--color-blue)" : "#fff",
                color: done ? "#fff" : active ? "var(--color-blue)" : "var(--color-text-faint)",
                boxSizing: "border-box",
                cursor: selectable ? "pointer" : "default",
              }}
            >
              {done ? "✓" : i + 1}
            </button>
            <button
              type="button"
              disabled={!selectable}
              onClick={() => onSelect?.(i)}
              className="text-xs font-semibold mt-1.5 text-center max-w-[110px]"
              style={{ color: active ? "var(--color-text)" : "var(--color-text-faint)", cursor: selectable ? "pointer" : "default", background: "none", border: "none" }}
            >
              {p.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Phase 1: Planning Standarisasi ─────────────────────────────────────────

export function PlanningPhase(props: {
  canEdit: boolean;
  kodePI: string;
  namaOutlet: string;
  /** Existing pengajuan's own id — passed so the "Sudah Standarisasi" sidebar tab excludes this pengajuan's own produk. Undefined on the "new" (create) form, where there's no id yet. */
  pengajuanId?: string;
  /** When set, "Nama Outlet" renders as an editable Combobox instead of a read-only box — used by the "new" (create) form, where outlet isn't fixed yet. */
  outletPicker?: { options: { value: string; label: string; sublabel?: string; tag?: string; tagColor?: "blue" | "yellow" | "red" | "green" | "orange" | "lime" | "indigo" | "purple" }[]; onChange: (v: string) => void };
  /** Can be more than one KPDM per outlet — picked from the same outlet customer pool as Dokter Klinis (dokterList below), not a separate master-data entity. */
  kpdmList: KpdmFormState[];
  addKpdm: (rawId: string) => Promise<void>;
  removeKpdm: (customerId: string) => void;
  updateKpdmEntertainEstimasi: (customerId: string, v: string) => void;
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
  updateDokterKlinis: (idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) => void;
}) {
  const {
    canEdit, kodePI, namaOutlet, pengajuanId, outletPicker,
    kpdmList, addKpdm, removeKpdm, updateKpdmEntertainEstimasi,
    tipeStandarisasi, setTipeStandarisasi,
    periodeBulan, setPeriodeBulan, jumlahBedRs, setJumlahBedRs, estimasiTimelineSelesai, setEstimasiTimelineSelesai,
    produkList, productOptions, productByKode, dokterList, dokterById, updateProduk, addProduk, removeProduk,
    addDokterToProduk, removeDokterFromProduk, updateDokterKlinis,
  } = props;

  const disabled = !canEdit;

  // Same labeling + kontes/kategori grouping as POA Estimasi's product picker
  // (LineItemEditor's buildProductOptions) — no single dokter is picked yet at
  // this Produk × Outlet level, so spesialisasi/PSSP-history/survey scoring
  // (which need one specific dokter) don't apply, only the shared paket/kontes
  // categorization.
  const productComboOptions = useMemo(() => buildProductOptions(productOptions, undefined), [productOptions]);

  // Status Pengajuan (Baru/Perpanjangan) is auto-derived server-side from 12-
  // month sales history (see getStatusPengajuanPreviewAction) — this refetches
  // the preview whenever the outlet or the SET of picked kodeProduk changes,
  // so the read-only label updates live as the MR builds the produk list,
  // without waiting for a save. Keyed on kodeProduk values only (not the
  // whole produkList) so editing unrelated fields (diskon, dokter, ...)
  // doesn't retrigger it.
  const kodeProdukKey = produkList.map((p) => p.kodeProduk).join(",");
  useEffect(() => {
    const kodeList = Array.from(new Set(kodeProdukKey.split(",").filter(Boolean)));
    if (!kodePI || kodeList.length === 0) return;
    let cancelled = false;
    getStatusPengajuanPreviewAction(kodePI, kodeList, pengajuanId).then((map) => {
      if (cancelled) return;
      produkList.forEach((p, idx) => {
        const derived = p.kodeProduk ? map[p.kodeProduk] : undefined;
        if (derived && derived !== p.statusPengajuan) updateProduk(idx, { statusPengajuan: derived });
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kodePI, kodeProdukKey]);

  // Pre-fills "Estimasi Diskon" from live Exodus discount (same source as
  // Finalisasi's read-only Discount Final) so the MR sees a real default
  // instead of a blank field and can adjust it to see the margin warning
  // react (2026-08-28 user request). Only applied when the row's own value
  // is still empty — never overwrites what the MR already typed or what was
  // already saved, so this only fires once per produk row in practice.
  useEffect(() => {
    const kodeList = Array.from(new Set(kodeProdukKey.split(",").filter(Boolean)));
    if (!kodePI || kodeList.length === 0) return;
    let cancelled = false;
    getEstimasiDiskonPreviewAction(kodePI).then((map) => {
      if (cancelled) return;
      produkList.forEach((p, idx) => {
        if (p.estimasiDiskonPct) return;
        const pct = p.kodeProduk ? map[p.kodeProduk] : undefined;
        if (pct != null) updateProduk(idx, { estimasiDiskonPct: String(pct) });
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kodePI, kodeProdukKey]);

  // Baseline for the margin warning below (2026-08-28 user correction — see
  // getMarginWarningBaselineAction): keyed by kodeProduk, value is that
  // outlet+produk's 12-month sales history. A kodeProduk missing from this
  // map means no live Exodus discount exists for it, so the warning is
  // skipped entirely for that row.
  const [marginBaseline, setMarginBaseline] = useState<Record<string, number>>({});
  useEffect(() => {
    const kodeList = Array.from(new Set(kodeProdukKey.split(",").filter(Boolean)));
    if (!kodePI || kodeList.length === 0) { setMarginBaseline({}); return; }
    let cancelled = false;
    getMarginWarningBaselineAction(kodePI, kodeList).then((map) => {
      if (!cancelled) setMarginBaseline(map);
    });
    return () => { cancelled = true; };
  }, [kodePI, kodeProdukKey]);

  return (
    <>
      <RekomendasiSidebar kodePI={kodePI} pengajuanId={pengajuanId} productByKode={productByKode} dokterList={dokterList} />
      <Card className="mb-4">
        <CardHeader><CardTitle>Planning Standarisasi</CardTitle></CardHeader>
        <div className="max-w-lg mb-4">
          <span className="text-sm font-medium block mb-1">Nama Outlet {outletPicker && <span style={{ color: "var(--color-error)" }}>*</span>}</span>
          {outletPicker ? (
            <Combobox
              name="kodePI"
              options={outletPicker.options}
              value={kodePI}
              onChange={outletPicker.onChange}
              placeholder="Cari outlet…"
              required
              emptyMessage="Tidak ada outlet di coverage Anda."
            />
          ) : (
            <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>{namaOutlet}</div>
          )}
        </div>
        <div className="mb-4">
          <span className="text-sm font-medium block mb-1">KPDM Standarisasi <span style={{ color: "var(--color-error)" }}>*</span></span>
          <p className="text-xs mb-2" style={{ color: "var(--color-text-faint)" }}>Bisa lebih dari satu KPDM untuk outlet ini.</p>
          {kpdmList.length === 0 ? (
            <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada KPDM dipilih.</p>
          ) : (
            <div className="space-y-2 mb-2">
              {kpdmList.map((k) => (
                <div key={k.customerId} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)" }}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[140px]">
                      <div className="text-sm font-medium">{k.nama}</div>
                      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{k.jabatan || "-"}</div>
                    </div>
                    <div className="w-40">
                      <RpInput label="Entertain Estimasi" value={k.entertainEstimasi} onChange={(v) => updateKpdmEntertainEstimasi(k.customerId, v)} disabled={disabled} />
                    </div>
                    {!disabled && (
                      <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeKpdm(k.customerId)}>Hapus</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!disabled && (
            <Combobox
              name="kpdmAdd"
              options={dokterList.filter((d) => !kpdmList.some((k) => k.customerId === d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.jabatan, tag: d.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
              value=""
              onChange={addKpdm}
              disabled={disabled}
              placeholder="+ Tambah KPDM…"
              emptyMessage="Tidak ada customer terdaftar di outlet ini."
            />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <span className="text-sm font-medium block mb-1">Tipe Standarisasi <span style={{ color: "var(--color-error)" }}>*</span></span>
            <Combobox
              name="tipeStandarisasi"
              options={[
                { value: "PERIODIC", label: "Standarisasi Periodic" },
                { value: "SISIPAN", label: "Standarisasi Sisipan" },
                { value: "PERMANEN", label: "Standarisasi Non Periodic" },
              ]}
              value={tipeStandarisasi}
              onChange={(v) => setTipeStandarisasi(v as "PERIODIC" | "SISIPAN" | "PERMANEN")}
              disabled={disabled}
            />
          </div>
          {tipeStandarisasi === "PERIODIC" && (
            <div>
              <span className="text-sm font-medium block mb-1">Periode <span style={{ color: "var(--color-error)" }}>*</span></span>
              <Combobox
                name="periodeBulan"
                options={PERIODE_PERIODIC_OPTIONS.map((n) => ({ value: String(n), label: `${n} Bulan` }))}
                value={periodeBulan}
                onChange={setPeriodeBulan}
                disabled={disabled}
                placeholder="Pilih periode…"
              />
            </div>
          )}
          {tipeStandarisasi === "SISIPAN" && (
            <UnitCountInput label="Periode" unit="Bulan" value={periodeBulan} onChange={setPeriodeBulan} disabled={disabled} />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UnitCountInput label="Jumlah Bed RS" unit="Bed" value={jumlahBedRs} onChange={setJumlahBedRs} disabled={disabled} />
          <MonthYearPicker
            label="Target Finalisasi Standarisasi"
            value={estimasiTimelineSelesai}
            onChange={setEstimasiTimelineSelesai}
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
        const totalQty = p.dokterKlinis.reduce((s, dk) => s + (parseFloat(dk.jumlahPasien) || 0) * (parseFloat(dk.resepPerPasienSt) || 0), 0);
        const totalSales = totalQty * hst;
        const totalEntertain = p.dokterKlinis.reduce((s, dk) => s + (parseFloat(dk.entertainRp) || 0), 0);
        return (
          <Card key={idx} className="mb-4" style={{ background: "var(--color-bg-subtle)" }}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>{idx + 1}. {product?.namaProduk ?? "Produk belum dipilih"}</span>
              {!disabled && produkList.length > 1 && (
                <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeProduk(idx)}>Hapus</button>
              )}
            </div>

            <div className="flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium block mb-1">Nama Produk *</span>
                <Combobox
                  name={`produk-${idx}`}
                  options={productComboOptions}
                  value={p.kodeProduk}
                  onChange={(v) => updateProduk(idx, { kodeProduk: v })}
                  disabled={disabled}
                  placeholder="Cari produk…"
                />
              </div>
              <div className="w-40 shrink-0">
                <span className="text-xs font-medium block mb-1">Status Pengajuan</span>
                <div
                  className="rounded px-3 py-2 text-sm font-semibold"
                  style={{
                    background: p.statusPengajuan === "PERPANJANGAN" ? "var(--color-blue-light)" : "var(--color-bg-subtle)",
                    color: p.statusPengajuan === "PERPANJANGAN" ? "var(--color-blue)" : "var(--color-text-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                  title="Otomatis: Perpanjangan kalau ada histori sales produk ini di outlet ini 12 bulan terakhir, Baru kalau tidak ada."
                >
                  {p.statusPengajuan === "PERPANJANGAN" ? "Perpanjangan" : "Baru"}
                </div>
              </div>
              <div className="w-32 shrink-0">
                <UnitCountInput label="Estimasi Diskon" unit="%" value={p.estimasiDiskonPct} onChange={(v) => updateProduk(idx, { estimasiDiskonPct: v })} disabled={disabled} />
              </div>
              <div className="w-36 shrink-0">
                <RpInput label="Estimasi Biaya Listing" value={p.estimasiBiayaListingRp} onChange={(v) => updateProduk(idx, { estimasiBiayaListingRp: v })} disabled={disabled} />
              </div>
            </div>
            {(() => {
              const salesLama12Bln = p.kodeProduk ? marginBaseline[p.kodeProduk] : undefined;
              if (salesLama12Bln === undefined) return null; // no live Exodus discount for this produk — nothing to warn against
              const biayaDiskonBaru = totalSales * ((parseFloat(p.estimasiDiskonPct) || 0) / 100);
              const marginBudgetLama = (salesLama12Bln / 12) * (MARGIN_CAP_PCT / 100);
              if (biayaDiskonBaru <= marginBudgetLama) return null;
              return (
                <p className="text-xs mt-1" style={{ color: "var(--color-error)" }}>
                  ⚠ Estimasi beban diskon {formatRp(biayaDiskonBaru)}/bln melebihi budget margin histori {formatRp(marginBudgetLama)}/bln ({MARGIN_CAP_PCT}% dari sales 12 bulan terakhir) — margin standarisasi berpotensi tergerus lebih dalam dari sebelumnya.
                </p>
              );
            })()}
            {product && (
              <div className="flex gap-4 text-xs mt-2 mb-1" style={{ color: "var(--color-text-muted)" }}>
                <span>HNA SJ: <strong>{formatRp(parseFloat(product.hna))}</strong> ({product.satuan})</span>
                <span>HNA ST: <strong>{formatRp(hst)}</strong> ({product.satuanTerkecil ?? product.satuan})</span>
              </div>
            )}
            {/* Same "Referensi PM" reference as POA Estimasi's Jml Produk ST/Pasien field (LineItemEditor.tsx) — recommended resep/pasien ratio from product master data, to help fill Resep/Pasien below. */}
            {product && (product.qtyPerRxPasien != null || product.jumlahPemberianPerHari != null) && (
              <div className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>
                <span className="font-medium">Rekomendasi Resep: </span>
                {product.qtyPerRxPasien != null && product.lamaPemberianHari != null
                  ? `${product.qtyPerRxPasien} ${product.satuanTerkecil ?? product.satuan} / ${product.lamaPemberianHari} hari`
                  : "-"}
                {product.jumlahPemberianPerHari != null && <> · Dosis per hari: {product.jumlahPemberianPerHari} / hari</>}
              </div>
            )}

            <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Dokter User</span>
            {p.dokterKlinis.length === 0 ? (
              <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada dokter user untuk produk ini.</p>
            ) : (
              <div className="overflow-x-auto mb-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)" }}>
                      <th className="text-left py-1 pr-3">Dokter</th>
                      <th className="text-right py-1 px-2">Jumlah Pasien</th>
                      <th className="text-right py-1 px-2">Resep/Pasien</th>
                      <th className="text-right py-1 px-2">Est. Qty/bln</th>
                      <th className="text-right py-1 px-2">Est. Sales/bln</th>
                      <th className="text-right py-1 px-2" style={{ minWidth: 110 }}>Entertain</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.dokterKlinis.map((dk) => {
                      const d = dokterById.get(dk.customerId);
                      const dq = (parseFloat(dk.jumlahPasien) || 0) * (parseFloat(dk.resepPerPasienSt) || 0);
                      return (
                        <tr key={dk.customerId} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td className="py-1.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              <span>{d?.namaCustomer ?? dk.customerId}</span>
                              {p.kodeProduk && <GolonganBadge kodeCustomer={d?.kodeCustomer ?? ""} kodePI={kodePI} kodeProduk={p.kodeProduk} />}
                            </div>
                          </td>
                          <td className="py-1.5 px-2"><UnitCountInput unit="Pasien" value={dk.jumlahPasien} onChange={(v) => updateDokterKlinis(idx, dk.customerId, { jumlahPasien: v })} disabled={disabled} dense /></td>
                          <td className="py-1.5 px-2"><UnitCountInput unit={product?.satuanTerkecil ?? "Resep"} value={dk.resepPerPasienSt} onChange={(v) => updateDokterKlinis(idx, dk.customerId, { resepPerPasienSt: v })} disabled={disabled} dense /></td>
                          <td className="py-1.5 px-2 text-right">{dq ? dq.toLocaleString("id-ID") : "-"}</td>
                          <td className="py-1.5 px-2 text-right">{formatRp(dq * hst)}</td>
                          <td className="py-1.5 px-2"><RpInput value={dk.entertainRp} onChange={(v) => updateDokterKlinis(idx, dk.customerId, { entertainRp: v })} disabled={disabled} dense /></td>
                          <td className="pl-1">{!disabled && <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeDokterFromProduk(idx, dk.customerId)}>✕</button>}</td>
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
                name={`dokter-add-${idx}`}
                options={dokterList.filter((d) => !p.dokterKlinis.some((dk) => dk.customerId === d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.jabatan, tag: d.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
                value=""
                onChange={(v) => addDokterToProduk(idx, v)}
                placeholder="+ Tambah dokter user…"
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
  canApproveNsm,
  onApprove,
}: {
  pengajuan: PoaStandarisasiDetail;
  canApproveAsm: boolean;
  canApproveSm: boolean;
  canApproveNsm: boolean;
  onApprove: (level: "ASM" | "SM" | "NSM", decision: "DISETUJUI" | "DITOLAK") => void;
}) {
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Approval Atasan</CardTitle></CardHeader>
      <p className="text-sm mb-4" style={{ color: "var(--color-blue)" }}>
        Pengajuan ini perlu disetujui ASM, lalu SM, lalu NSM sebelum lanjut ke Approval User/Dokter.
      </p>
      <div className="rounded p-4 mb-2" style={{ background: "var(--color-bg-subtle)" }}>
        <ApprovalRow label="Approval ASM" status={pengajuan.statusApprovalAsm} canAct={canApproveAsm} onApprove={(d) => onApprove("ASM", d)} />
        <ApprovalRow
          label="Approval SM"
          status={pengajuan.statusApprovalSm}
          canAct={canApproveSm && pengajuan.statusApprovalAsm === "DISETUJUI"}
          onApprove={(d) => onApprove("SM", d)}
        />
        <ApprovalRow
          label="Approval NSM"
          status={pengajuan.statusApprovalNsm}
          canAct={canApproveNsm && pengajuan.statusApprovalSm === "DISETUJUI"}
          onApprove={(d) => onApprove("NSM", d)}
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

// ─── Phase 4: Menunggu Meeting KFT ──────────────────────────────────────────
// Just the meeting schedule — dokumen standarisasi + Form Approval upload
// live in Approval User/Dokter instead (2026-08-20: moved back there).

function MenungguMeetingKftPhase({
  canEdit,
  pengajuan,
  jadwalMeetingKft,
  setJadwalMeetingKft,
}: {
  canEdit: boolean;
  pengajuan: PoaStandarisasiDetail;
  jadwalMeetingKft: string;
  setJadwalMeetingKft: (v: string) => void;
}) {
  // Purely a browser for Dokumen Standarisasi NIE/COA/CPOB/Flyer (read-only,
  // diupload dari tempat lain) — "Permintaan SP Non Sales" dan upload "Form
  // Approval Standarisasi" dipindah ke Finalisasi (2026-08-26, user request).
  const [selectedProdukId, setSelectedProdukId] = useState<string>(pengajuan.produk[0]?.id ?? "");
  const p = pengajuan.produk.find((x) => x.id === selectedProdukId) ?? pengajuan.produk[0];

  return (
    <div className="flex gap-4 items-start mb-4 flex-col lg:flex-row">
      <Card className="flex-1 min-w-0">
        <CardHeader><CardTitle>Menunggu Meeting KFT</CardTitle></CardHeader>
        <div className="max-w-xs mb-4">
          <Input
            label="Jadwal Meeting KFT"
            type="datetime-local"
            value={jadwalMeetingKft}
            onChange={(e) => setJadwalMeetingKft(e.target.value)}
            disabled={!canEdit}
          />
        </div>

        {!p ? (
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada produk diajukan.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-blue)" }}>{p.product.namaProduk}</h3>

            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>
              Dokumen Standarisasi (untuk dibawa ke meeting KFT)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {DOKUMEN_JENIS_KFT.map(({ jenis, label }) => {
                const doc = p.dokumen.find((dd) => dd.jenis === jenis);
                return (
                  <div key={jenis} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)" }}>
                    <div className="text-sm font-semibold">{label}</div>
                    {doc ? (
                      <>
                        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--color-text-faint)" }}>{doc.namaFile}</div>
                        <a href={driveViewUrl(doc.driveFileId)} target="_blank" rel="noreferrer" className="text-xs font-medium mt-1 inline-block" style={{ color: "var(--color-blue)" }}>
                          ↓ Download
                        </a>
                      </>
                    ) : (
                      <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>Belum diupload</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {pengajuan.produk.length > 0 && (
        <div className="w-full lg:w-64 shrink-0">
          <Card>
            <div className="text-sm font-bold mb-1">Produk Diajukan</div>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>
              Klik produk untuk pindah. Centang muncul kalau NIE/COA/CPOB/Flyer sudah lengkap.
            </p>
            <div className="space-y-2">
              {pengajuan.produk.map((prod) => {
                const active = prod.id === selectedProdukId;
                const done = DOKUMEN_JENIS_KFT.every(({ jenis }) => prod.dokumen.some((dd) => dd.jenis === jenis));
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setSelectedProdukId(prod.id)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold"
                    style={{
                      background: active ? "var(--color-blue)" : "var(--color-bg-subtle)",
                      color: active ? "#fff" : "var(--color-text)",
                    }}
                  >
                    <span className="truncate">{prod.product.namaProduk}</span>
                    <span
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                      style={{
                        background: done ? (active ? "rgba(255,255,255,0.9)" : "var(--color-status-approved-bg, #E6F5EC)") : (active ? "rgba(255,255,255,0.25)" : "var(--color-border)"),
                        color: done ? "var(--color-status-approved, #008f42)" : "transparent",
                      }}
                    >
                      {done ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Phase 3: Approval User/Dokter ──────────────────────────────────────────

function ApprovalUserDokterPhase({
  canEdit,
  pengajuan,
  dokterList,
  resolveDokterId,
}: {
  canEdit: boolean;
  pengajuan: PoaStandarisasiDetail;
  dokterList: CustomerOption[];
  resolveDokterId: (rawId: string) => Promise<string>;
}) {
  const [selectedProdukId, setSelectedProdukId] = useState<string>(pengajuan.produk[0]?.id ?? "");
  const p = pengajuan.produk.find((x) => x.id === selectedProdukId) ?? pengajuan.produk[0];
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [replacingKey, setReplacingKey] = useState<string | null>(null);

  async function handleUploadBuktiTtd(produkId: string, customerId: string, file: File) {
    const key = `${produkId}:${customerId}`;
    setUploadingKey(key);
    setLocalError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("pengajuanId", pengajuan.id);
      fd.set("kind", "buktiTtd");
      fd.set("produkId", produkId);
      fd.set("customerId", customerId);
      await uploadPoaStandarisasiFileAction(fd);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Upload gagal.");
      setUploadingKey(null);
    }
  }

  async function handleAddDokter(rawId: string) {
    if (!rawId || !p) return;
    setBusy(true);
    setLocalError(null);
    try {
      const realId = await resolveDokterId(rawId);
      await addDokterApprovalAction(p.id, realId);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Gagal menambah dokter.");
      setBusy(false);
    }
  }

  async function handleRemoveDokter(customerId: string) {
    if (!p) return;
    setBusy(true);
    setLocalError(null);
    try {
      await removeDokterApprovalAction(p.id, customerId);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Gagal menghapus dokter.");
      setBusy(false);
    }
  }

  /** "Ganti" = remove old + add new in one action, reusing the same two
   * server actions Hapus/+Tambah already call — no new backend needed. */
  async function handleReplaceDokter(oldCustomerId: string, rawId: string) {
    if (!rawId || !p) return;
    setBusy(true);
    setLocalError(null);
    try {
      const realId = await resolveDokterId(rawId);
      await removeDokterApprovalAction(p.id, oldCustomerId);
      await addDokterApprovalAction(p.id, realId);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Gagal mengganti dokter.");
      setBusy(false);
    }
  }

  if (!p) {
    return (
      <Card className="mb-4">
        <CardHeader><CardTitle>Approval User / Dokter</CardTitle></CardHeader>
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada produk diajukan.</p>
      </Card>
    );
  }

  return (
    <div className="flex gap-4 items-start mb-4 flex-col lg:flex-row">
      <Card className="flex-1 min-w-0">
        <CardHeader><CardTitle>Approval User / Dokter</CardTitle></CardHeader>
        {POA_STANDARISASI_UPLOAD_DISABLED && (
          <p className="text-xs rounded px-3 py-2 mb-3" style={{ background: "var(--color-warning-bg, #FEF9C3)", color: "var(--color-warning, #92400E)" }}>
            {POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE}
          </p>
        )}
        {localError && (
          <p className="text-xs rounded px-3 py-2 mb-3" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>
            {localError}
          </p>
        )}
        <p className="text-xs rounded px-3 py-2 mb-4" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
          Dokter di bawah ini masih bisa ditambah/dihapus di tahap ini (tidak fixed dari Planning) — upload Memo sebagai bukti tanda tangan, menggantikan checkbox &quot;Sudah TTD&quot;. Dokumen Standarisasi &amp; Form Approval Standarisasi diupload di tahap Menunggu Meeting KFT / Finalisasi.
        </p>

        <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-blue)" }}>{p.product.namaProduk}</h3>
        {p.dokterApproval.map((d) => {
          const key = `${p.id}:${d.customerId}`;
          return (
            <div key={key} className="flex items-center gap-3 rounded px-3 py-2 mb-1.5 text-sm flex-wrap" style={{ border: "1px solid var(--color-border)" }}>
              <span className="flex-1 min-w-[100px]">{d.customer.namaCustomer}</span>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: d.wajib ? "var(--color-error-bg, #FDECEA)" : "var(--color-bg-subtle)", color: d.wajib ? "var(--color-error)" : "var(--color-text-faint)" }}
              >
                {d.wajib ? "Wajib" : "Opsional"}
              </span>

              <input
                ref={(el) => { fileInputRefs.current[key] = el; }}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadBuktiTtd(p.id, d.customerId, f); }}
              />
              {d.buktiTtdDriveFileId ? (
                <a href={driveViewUrl(d.buktiTtdDriveFileId)} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--color-status-approved, #008f42)" }}>
                  ✓ Sudah TTD — lihat bukti
                </a>
              ) : (
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada bukti TTD</span>
              )}
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={uploadingKey === key || POA_STANDARISASI_UPLOAD_DISABLED}
                  title={POA_STANDARISASI_UPLOAD_DISABLED ? POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE : undefined}
                  onClick={() => fileInputRefs.current[key]?.click()}
                >
                  {uploadingKey === key ? "Mengupload…" : d.buktiTtdDriveFileId ? "Ganti" : "Upload Memo"}
                </Button>
              )}
              {canEdit && (
                <button type="button" className="text-xs" style={{ color: "var(--color-blue)" }} disabled={busy} onClick={() => setReplacingKey(replacingKey === key ? null : key)}>
                  Ganti Dokter
                </button>
              )}
              {canEdit && (
                <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} disabled={busy} onClick={() => handleRemoveDokter(d.customerId)}>
                  Hapus
                </button>
              )}
              {canEdit && replacingKey === key && (
                <div className="basis-full">
                  <Combobox
                    name={`dokterApprovalReplace-${key}`}
                    options={dokterList.filter((o) => !p.dokterApproval.some((da) => da.customerId === o.id)).map((o) => ({ value: o.id, label: o.namaCustomer, sublabel: o.jabatan, tag: o.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
                    value=""
                    onChange={(rawId) => { setReplacingKey(null); handleReplaceDokter(d.customerId, rawId); }}
                    disabled={busy}
                    placeholder={`Ganti ${d.customer.namaCustomer} dengan…`}
                  />
                </div>
              )}
            </div>
          );
        })}

        {canEdit && (
          <Combobox
            name="dokterApprovalAdd"
            options={dokterList.filter((d) => !p.dokterApproval.some((da) => da.customerId === d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.jabatan, tag: d.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
            value=""
            onChange={handleAddDokter}
            disabled={busy}
            placeholder="+ Tambah dokter…"
          />
        )}
      </Card>

      <div className="w-full lg:w-64 shrink-0">
        <Card>
          <div className="text-sm font-bold mb-1">Produk Diajukan</div>
          <p className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>
            Klik produk untuk pindah. Centang muncul kalau semua dokter wajib sudah TTD.
          </p>
          <div className="space-y-2">
            {pengajuan.produk.map((prod) => {
              const active = prod.id === selectedProdukId;
              const wajibDokter = prod.dokterApproval.filter((d) => d.wajib);
              const done = wajibDokter.length > 0 && wajibDokter.every((d) => d.sudahTtd);
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProdukId(prod.id)}
                  className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold"
                  style={{
                    background: active ? "var(--color-blue)" : "var(--color-bg-subtle)",
                    color: active ? "#fff" : "var(--color-text)",
                  }}
                >
                  <span className="truncate">{prod.product.namaProduk}</span>
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                    style={{
                      background: done ? (active ? "rgba(255,255,255,0.9)" : "var(--color-status-approved-bg, #E6F5EC)") : (active ? "rgba(255,255,255,0.25)" : "var(--color-border)"),
                      color: done ? "var(--color-status-approved, #008f42)" : "transparent",
                    }}
                  >
                    {done ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Phase 5: Finalisasi ─────────────────────────────────────────────────────

function FinalisasiPhase({
  canEdit,
  pengajuan,
  produkList,
  productByKode,
  dokterList,
  dokterById,
  distributors,
  setDistributors,
  kpdmList,
  updateKpdmEntertainFinal,
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
  distributors: string[];
  setDistributors: React.Dispatch<React.SetStateAction<string[]>>;
  kpdmList: KpdmFormState[];
  updateKpdmEntertainFinal: (customerId: string, v: string) => void;
  updateProduk: (idx: number, patch: Partial<ProdukFormState>) => void;
  addDokterUser: (idx: number, rawId: string) => Promise<void>;
  updateDokterUser: (idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) => void;
  removeDokterUser: (idx: number, customerId: string) => void;
}) {
  const disabled = !canEdit || !!pengajuan.submittedAt;
  const [uploadingKft, setUploadingKft] = useState(false);
  const kftInputRef = useRef<HTMLInputElement | null>(null);
  // Form Approval Standarisasi upload — per produk, moved here from Menunggu
  // Meeting KFT (2026-08-26, user request: sama konsepnya dengan Surat
  // Approval Standarisasi KFT di atas, jadi ditaruh berdekatan).
  const formApprovalInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingFormApproval, setUploadingFormApproval] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleUploadKft(file: File) {
    setUploadingKft(true);
    setLocalError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("pengajuanId", pengajuan.id);
      fd.set("kind", "suratKft");
      await uploadPoaStandarisasiFileAction(fd);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Upload gagal.");
    } finally {
      setUploadingKft(false);
    }
  }

  async function handleUploadFormApproval(produkId: string, file: File) {
    setUploadingFormApproval(produkId);
    setLocalError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("pengajuanId", pengajuan.id);
      fd.set("kind", "formApproval");
      fd.set("produkId", produkId);
      await uploadPoaStandarisasiFileAction(fd);
      window.location.reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Upload gagal.");
      setUploadingFormApproval(null);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Finalisasi</CardTitle></CardHeader>
      {POA_STANDARISASI_UPLOAD_DISABLED && (
        <p className="text-xs rounded px-3 py-2 mb-4" style={{ background: "var(--color-warning-bg, #FEF9C3)", color: "var(--color-warning, #92400E)" }}>
          {POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE}
        </p>
      )}
      {localError && (
        <p className="text-xs rounded px-3 py-2 mb-4" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>
          {localError}
        </p>
      )}

      <div className="mb-4">
        <span className="text-sm font-medium block mb-2">KPDM</span>
        <div className="space-y-2">
          {kpdmList.map((k) => (
            <div key={k.customerId} className="flex items-center gap-3 flex-wrap rounded-lg p-3" style={{ border: "1px solid var(--color-border)" }}>
              <div className="flex-1 min-w-[140px]">
                <div className="text-sm font-medium">{k.nama}</div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{k.jabatan || "-"}</div>
              </div>
              <div className="w-40">
                <RpInput label="Entertain Final" value={k.entertainFinal} onChange={(v) => updateKpdmEntertainFinal(k.customerId, v)} disabled={disabled} />
              </div>
            </div>
          ))}
        </div>
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
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={uploadingKft || POA_STANDARISASI_UPLOAD_DISABLED}
                title={POA_STANDARISASI_UPLOAD_DISABLED ? POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE : undefined}
                onClick={() => kftInputRef.current?.click()}
              >
                {uploadingKft ? "Mengupload…" : "Upload"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mb-6">
        <span className="text-sm font-medium block mb-2">Distributor yang Akan Digunakan</span>
        <div className="flex gap-4">
          {DISTRIBUTOR_OPTIONS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={distributors.includes(d)}
                disabled={disabled}
                onChange={(e) =>
                  setDistributors((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))
                }
              />
              {d}
            </label>
          ))}
        </div>
      </div>

      {produkList.filter((p) => p.id).map((p) => {
        const idx = produkList.indexOf(p);
        const product = productByKode.get(p.kodeProduk);
        const rawProduk = pengajuan.produk.find((x) => x.id === p.id);
        const totalQty = p.dokterUser.reduce((s, d) => s + (parseFloat(d.jumlahPasien) || 0) * (parseFloat(d.resepPerPasienSt) || 0), 0);
        const hst = product ? hargaSTFromProduct(product) : 0;
        const totalSales = totalQty * hst;
        const totalEntertain = p.dokterUser.reduce((s, d) => s + (parseFloat(d.entertainRp) || 0), 0);
        return (
          <div key={p.id} className="rounded-lg p-4 mb-4" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border-strong, var(--color-border))" }}>
            <div className="text-sm font-bold mb-3" style={{ color: "var(--color-blue)" }}>{product?.namaProduk ?? p.kodeProduk}</div>
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Finalisasi Biaya</span>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* Sourced live from Exodus discount-request API (principal_percentage), see getPoaStandarisasiDetail — no longer manually editable. */}
              <UnitCountInput label="Discount Final" unit="%" value={p.finalDiscountPct} onChange={(v) => updateProduk(idx, { finalDiscountPct: v })} disabled />
              <UnitCountInput label="Diskon Distributor" unit="%" value={p.diskonDistributorPct} onChange={(v) => updateProduk(idx, { diskonDistributorPct: v })} disabled={disabled} />
              <RpInput label="Biaya Listing Final" value={p.finalBiayaListingRp} onChange={(v) => updateProduk(idx, { finalBiayaListingRp: v })} disabled={disabled} />
            </div>

            <span className="text-xs font-medium block mb-2">Dokter yang Akan Menjadi User</span>
            {p.dokterUser.length === 0 ? (
              <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada dokter yang sudah TTD untuk produk ini.</p>
            ) : (
              <div className="overflow-x-auto mb-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)" }}>
                      <th className="text-left py-1 pr-3">Dokter</th>
                      <th className="text-right py-1 px-2">Jumlah Pasien</th>
                      <th className="text-right py-1 px-2">Resep/Pasien</th>
                      <th className="text-right py-1 px-2">Est. Qty/bln</th>
                      <th className="text-right py-1 px-2">Est. Sales/bln</th>
                      <th className="text-right py-1 px-2" style={{ minWidth: 110 }}>Entertain</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.dokterUser.map((d) => {
                      const dq = (parseFloat(d.jumlahPasien) || 0) * (parseFloat(d.resepPerPasienSt) || 0);
                      return (
                        <tr key={d.customerId} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td className="py-1.5 pr-3">{dokterById.get(d.customerId)?.namaCustomer ?? d.customerId}</td>
                          <td className="py-1.5 px-2"><UnitCountInput unit="Pasien" value={d.jumlahPasien} onChange={(v) => updateDokterUser(idx, d.customerId, { jumlahPasien: v })} disabled={disabled} dense /></td>
                          <td className="py-1.5 px-2"><UnitCountInput unit={product?.satuanTerkecil ?? "Resep"} value={d.resepPerPasienSt} onChange={(v) => updateDokterUser(idx, d.customerId, { resepPerPasienSt: v })} disabled={disabled} dense /></td>
                          <td className="py-1.5 px-2 text-right">{dq ? dq.toLocaleString("id-ID") : "-"}</td>
                          <td className="py-1.5 px-2 text-right">{formatRp(dq * hst)}</td>
                          <td className="py-1.5 px-2"><RpInput value={d.entertainRp} onChange={(v) => updateDokterUser(idx, d.customerId, { entertainRp: v })} disabled={disabled} dense /></td>
                          <td className="pl-1">{!disabled && <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => removeDokterUser(idx, d.customerId)}>✕</button>}</td>
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
                options={dokterList.filter((d) => !p.dokterUser.some((du) => du.customerId === d.id)).map((d) => ({ value: d.id, label: d.namaCustomer, sublabel: d.jabatan, tag: d.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
                value=""
                onChange={(v) => addDokterUser(idx, v)}
                placeholder="+ Tambah dokter…"
              />
            )}

            {rawProduk && (
              <>
                <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--color-text-faint)" }}>
                      {DOKUMEN_JENIS_FINALISASI[0]?.label}
                    </span>
                    {(() => {
                      const doc = rawProduk.dokumen.find((dd) => dd.jenis === DOKUMEN_JENIS_FINALISASI[0]?.jenis);
                      return doc ? (
                        <a href={driveViewUrl(doc.driveFileId)} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
                          ↓ {doc.namaFile}
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum diupload</span>
                      );
                    })()}
                  </div>

                  <div>
                    <span className="text-xs font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--color-text-faint)" }}>
                      Form Approval Standarisasi <span style={{ color: "var(--color-error)" }}>*</span>
                    </span>
                    <input
                      ref={(el) => { formApprovalInputRefs.current[p.id!] = el; }}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFormApproval(p.id!, f); }}
                    />
                    <div className="flex items-center gap-2">
                      {uploadingFormApproval === p.id ? (
                        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Mengupload…</span>
                      ) : rawProduk.formApprovalDriveFileId ? (
                        <a href={driveViewUrl(rawProduk.formApprovalDriveFileId)} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--color-status-approved, #008f42)" }}>
                          ✓ {rawProduk.formApprovalFilePath}
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum diupload</span>
                      )}
                      {!disabled && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={uploadingFormApproval === p.id || POA_STANDARISASI_UPLOAD_DISABLED}
                          title={POA_STANDARISASI_UPLOAD_DISABLED ? POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE : undefined}
                          onClick={() => formApprovalInputRefs.current[p.id!]?.click()}
                        >
                          {rawProduk.formApprovalDriveFileId ? "Ganti" : "Upload"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ─── Ringkasan POA (shared, bottom) ──────────────────────────────────────────

// ─── Riwayat Akses Dokumen (2026-08-27, user: dokumen confidential) ────────
// Every open of a Drive-backed document in this wizard is logged
// server-side (PoaStandarisasiFileAccessLog, via the download proxy route) —
// this panel surfaces that log so an MR/approver can see who opened which
// file and how many times. Collapsed by default (same space-saving pattern
// as RekomendasiSidebar's "Spesialisasi outlet" bar).

function DokumenAccessLogPanel({ pengajuanId }: { pengajuanId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FileAccessLogRow[] | null>(null);

  useEffect(() => {
    if (!open || rows !== null) return;
    getPoaStandarisasiFileAccessLogAction(pengajuanId).then(setRows);
  }, [open, rows, pengajuanId]);

  const countByFile = new Map<string, number>();
  for (const r of rows ?? []) countByFile.set(r.driveFileId, (countByFile.get(r.driveFileId) ?? 0) + 1);

  return (
    <div className="rounded-xl mt-3" style={{ border: "1px solid var(--color-border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ background: "transparent", border: "none", cursor: "pointer" }}
      >
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
          🔒 Riwayat Akses Dokumen
        </span>
        <span style={{ color: "var(--color-text-faint)", fontSize: 11 }}>{open ? "▲ tutup" : "▼ lihat"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          {rows === null ? (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada dokumen yang diakses.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--color-text-faint)" }}>
                    <th className="text-left py-1 pr-3">Dokumen</th>
                    <th className="text-left py-1 pr-3">Diakses oleh</th>
                    <th className="text-left py-1 pr-3">Waktu</th>
                    <th className="text-right py-1">Total akses file ini</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 pr-3">{r.accessedByNama} ({r.accessedByNip})</td>
                      <td className="py-1 pr-3">{new Date(r.accessedAt).toLocaleString("id-ID")}</td>
                      <td className="py-1 text-right">{countByFile.get(r.driveFileId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RingkasanPoa({ produkList, productByKode, kpdmList }: { produkList: ProdukFormState[]; productByKode: Map<string, Product>; kpdmList: KpdmFormState[] }) {
  const rows = produkList
    .filter((p) => p.kodeProduk)
    .map((p) => {
      const product = productByKode.get(p.kodeProduk);
      const hst = product ? hargaSTFromProduct(product) : 0;
      const qty = p.dokterKlinis.reduce((s, dk) => s + (parseFloat(dk.jumlahPasien) || 0) * (parseFloat(dk.resepPerPasienSt) || 0), 0);
      const nilai = qty * hst;
      const discountPct = parseFloat(p.estimasiDiskonPct) || 0;
      const listingRp = parseFloat(p.estimasiBiayaListingRp) || 0;
      const entertainRp = p.dokterKlinis.reduce((s, dk) => s + (parseFloat(dk.entertainRp) || 0), 0);
      const listingPct = nilai ? (listingRp / nilai) * 100 : 0;
      const entertainPct = nilai ? (entertainRp / nilai) * 100 : 0;
      const totalBudgetPct = discountPct + listingPct + entertainPct;
      return { product, qty, nilai, discountPct, listingRp, listingPct, entertainRp, entertainPct, totalBudgetPct };
    });

  const totalSales = rows.reduce((s, r) => s + r.nilai, 0);
  const totalListing = rows.reduce((s, r) => s + r.listingRp, 0);
  const totalEntertainProduk = rows.reduce((s, r) => s + r.entertainRp, 0);
  const kpdmEntertainNum = kpdmList.reduce((s, k) => s + (parseFloat(k.entertainEstimasi) || 0), 0);

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
