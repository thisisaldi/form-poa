"use client";

import { useState, useTransition, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { PoaLineItem } from "@prisma/client";
import type { Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { getCustomersByOutlet, createCustomerAction, getPsspHistory, getPsspHospinetSnapshot, getListingFeeHistory, getKriteriaByOutlet, getDiskonByOutlet, getDiskonHistoryByOutlet, getSurveyRekomendasiInfo, getSurveyRekomendasiByOutlet, getPsspStatusByOutlet, getPsspProductNamesByOutlet, getVisitHistoryByCustomerOutlet, type CustomerOption, type PsspKontrakSummary, type PsspHospinetSnapshotSummary, type ListingFeeKontrakSummary, type KriteriaByOutlet, type DiskonByProduct, type DiskonHistoryByProduct, type PsspStatusByCustomer, type SurveyRekomendasiRow, type VisitHistorySummary } from "@/app/actions/customer";
import { computePeriodeAkhir, computeMonthlyBreakdown, formatPeriode, formatPeriodeRange } from "@/lib/poaUtils";
import { quarterToMonths } from "@/lib/quarterUtils";
import { spesLabel, ALL_SPESIALISASI_OPTIONS } from "@/lib/spesialisasi";
import { getAllPakets, sortProductsBySpesialisasi, getPaketsBySpesialisasi, getProductTier, isRelevantToSpesialisasi } from "@/lib/paketProduk";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption, TAG_COLORS } from "@/components/ui/Combobox";

// Halaman input (Tambah Rencana POA, Tambah Produk, Edit Dokter, estimasi
// real-time saat mengisi form) TETAP pakai angka asli, BUKAN skala
// ÷1.000.000 yang dipakai tampilan Ringkasan/Summary/Draft (formatCurrency
// di @/lib/format) — dikonfirmasi pengguna 2026-08-10: "di tambah rencana,
// tetap pakai angka uang yang asli jangan dibagi 1 jt". Beda dari file lain
// yang IKUT pakai skala baru (DraftChecklist.tsx, summary/page.tsx, dll).
function formatRp(val: string | number | { toString(): string } | null | undefined) {
  if (val == null) return "-";
  const n = typeof val === "number" ? val : parseFloat(val.toString());
  if (isNaN(n)) return "-";
  return Math.round(n).toLocaleString("id-ID");
}

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
  TIDAK_TAHU: "Tidak Tahu",
};

// Aggregate Standarisasi indicator for "Total Semua Produk" (worst-status wins:
// any product not yet listed → Merah, else any still Proses Pengajuan → Kuning,
// else all Sudah Standarisasi → Hijau). Empty/unset and "Tidak Tahu" count as
// not-yet-listed since neither confirms the product is actually standarisasi.
function computeStandarisasiIndicator(entries: { kodeProduk: string; statusStandarisasi: string }[]): { status: "SUDAH" | "PROSES" | "BELUM"; label: string; color: string; bg: string } | null {
  const statuses = entries.filter((e) => e.kodeProduk).map((e) => e.statusStandarisasi);
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s !== "SUDAH_STANDARISASI" && s !== "PROSES_PENGAJUAN")) {
    return { status: "BELUM", label: "Belum Listing", color: "var(--color-red, #dc2626)", bg: "var(--color-red-bg, #fee2e2)" };
  }
  if (statuses.some((s) => s === "PROSES_PENGAJUAN")) {
    return { status: "PROSES", label: "On-Proses", color: "var(--color-warning, #d97706)", bg: "var(--color-warning-bg, #fef3c7)" };
  }
  return { status: "SUDAH", label: "Sudah Listing", color: "var(--color-success, #16a34a)", bg: "var(--color-success-bg, #dcfce7)" };
}

// compact = dot + short word only (for narrow table cells, e.g. the per-produk
// breakdown table) — full pill w/ long label is for the "Total Semua Produk"
// header where there's room to spell it out.
const STANDARISASI_SHORT_LABEL: Record<"SUDAH" | "PROSES" | "BELUM", string> = {
  SUDAH: "Sudah", PROSES: "Proses", BELUM: "Belum",
};

function StandarisasiIndicator({ entries, compact = false }: { entries: { kodeProduk: string; statusStandarisasi: string }[]; compact?: boolean }) {
  const indicator = computeStandarisasiIndicator(entries);
  if (!indicator) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full"
      style={{ background: indicator.bg, color: indicator.color }}
      title={compact ? indicator.label : undefined}>
      <span className="inline-block rounded-full shrink-0" style={{ width: 7, height: 7, background: indicator.color }} />
      {compact ? STANDARISASI_SHORT_LABEL[indicator.status] : indicator.label}
    </span>
  );
}

// kriteriaBaru rows come verbatim from the ProductPMDatabase.xlsx import (see
// scripts/seedOutletProductKriteria.ts) and still read "Terstandarisasi" at the
// source — only the on-screen badge text is renamed to "Listing Corporate"
// (2026-07-24 business terminology change); matching against the raw value
// (startsWith("Produk Sudah Terstandarisasi")) must stay untouched.
function formatKriteriaLabel(kriteria: string): string {
  return kriteria.replace(/Terstandarisasi/gi, "Listing Corporate");
}

const JENIS_PSSP_LABELS: Record<string, string> = {
  PSSP: "PSSP",
  PSSP_RETENSI: "PSSP Retensi",
  PSSP_PEREMAJAAN: "PSSP Peremajaan",
  PSSP_PERPANJANGAN: "PSSP Perpanjangan",
};

// Doctor-level "Jenis PSSP" shown next to PS/SP (2026-07-28 request) — not to
// be confused with JENIS_PSSP_LABELS above (per-product, currently hidden).
const BENTUK_PSSP_LABELS: Record<string, string> = {
  CASH: "Cash",
  BARANG: "Barang",
  JASA: "Jasa",
};

// "Quarter berjalan" — the calendar quarter containing today, e.g. Jul-Sep -> ["202607","202608","202609"].
function currentQuarterMonths(): string[] {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return quarterToMonths(`${now.getFullYear()}-Q${q}`);
}

function yyyymmIndex(yyyymm: string): number {
  return parseInt(yyyymm.slice(0, 4), 10) * 12 + parseInt(yyyymm.slice(4), 10);
}


interface OutletOption { kodePI: string; namaOutlet: string; groupRS?: string | null }

// DB stores "NON CHAIN" as a literal string (not null) for outlets without a real chain group.
function isChainGroup(groupRS?: string | null): boolean {
  return !!groupRS && groupRS !== "NON CHAIN";
}

interface Props {
  poaId: string;
  poaPeriod: string;     // PoaForm.period, e.g. "2026-Q3" — bounds the Periode Awal picker
  initialItems: PoaLineItem[];
  outlets: OutletOption[];
  products: Product[];
  formOnly?: boolean;   // hides the item list; form is always visible
  redirectTo?: string;  // after save, navigate here instead of reloading
}

// ─── Per-dokter shared fields ────────────────────────────────────────────────

interface DokterFields {
  periodeAwal: string;
  lamaPeriode: number;
  hariKerjaBulan: string;
  rencanaVisitMinggu: string;
  // Doctor-level survey result (2026-08-08 request) — MR's own count of daily
  // patients from a physical survey, shown as a "Referensi PM"-style hint
  // next to the per-product "Pasien Baru / Hari" field below (see
  // ProdukEntryRow) so the MR can compare their manual estimate against it.
  // Same duplication pattern as hariKerjaBulan/rencanaVisitMinggu — copied
  // into every product row for this doctor, not a per-product value itself.
  surveyPasienHarian: string;
  jenisPsSp: string;  // "PS" | "SP" | "" (unselected — optional)
  // "Jenis PSSP" shown next to PS/SP (2026-07-28 request) — "CASH" | "BARANG" | "JASA" | "".
  bentukPssp: string;
  // Customer-level, not per-product anymore (2026-07-28 request) — one
  // multiplier shared by every product this doctor has, "" = default 1x. See
  // resolvePengaliNilaiR.
  pengaliNilaiR: string;
  // Also customer-level (2026-07-28 request) — "USER" | "KPDM", relabels
  // "% PSSP User/KPDM" below, doesn't change the formula.
  pihakPssp: string;
}

function emptyDokterFields(periodeAwal = ""): DokterFields {
  return {
    periodeAwal, lamaPeriode: 3,
    hariKerjaBulan: "",
    rencanaVisitMinggu: "4",
    surveyPasienHarian: "",
    jenisPsSp: "",
    // Jenis PSSP defaults to Cash, Pihak PSSP defaults to User (2026-08-04
    // request) — both still editable, just pre-selected instead of forcing
    // an explicit choice for the common case.
    bentukPssp: "CASH",
    pengaliNilaiR: "",
    pihakPssp: "USER",
  };
}

// ─── Per-product entry ────────────────────────────────────────────────────────

interface ProdukEntry {
  uid: string; // local react key
  kodeProduk: string;
  jumlahResepHari: string;
  qtyProdukResep: string;
  produkKompetitor: string;  // per produk
  statusStandarisasi: string;
  jenisPssp: string;
  persenPsspDokter: string;  // % as 0-100
  persenPsspKpdm: string;
  persenDiskon: string;
  persenDp: string;
  persenListingFee: string;
  persenEntertain: string;
  hariKerjaBulan: string;  // per-product override of the doctor-level default; "" = inherit
  // kriteriaProduk & rasioEstimasiGrowth: auto (not user input)
}

function emptyProdukEntry(): ProdukEntry {
  return {
    uid: Math.random().toString(36).slice(2),
    kodeProduk: "", jumlahResepHari: "", qtyProdukResep: "",
    produkKompetitor: "", statusStandarisasi: "", jenisPssp: "",
    // 0 until a product is picked — then populated with dummy defaults / auto-computed from DB
    persenPsspDokter: "", persenPsspKpdm: "0",
    persenDiskon: "0", persenDp: "0", persenListingFee: "0", persenEntertain: "1",
    hariKerjaBulan: "",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hargaST(product: Product): number {
  const hna      = parseFloat(product.hna) || 0;
  const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
  return hna / konversi;
}

// Per-product override with a doctor-level default, falling back to 1 only when
// NEITHER is set. Deliberately not `parseFloat(x) || fallback` — 0 is a valid,
// intentional multiplier ("nilai PSSP dari produk ini = 0") but is falsy in JS,
// so that pattern silently discarded an explicit 0 in favor of the fallback.
function resolvePengaliNilaiR(entryValue: string): number {
  if (entryValue.trim() !== "") {
    const n = parseFloat(entryValue);
    if (!isNaN(n)) return n;
  }
  return 1;
}

/**
 * The DiskonKontrak (DPL) row backing "% Diskon (DPL/DPF)"'s real default for
 * a product, at this outlet covering periodeAwal — PRIMARY source, imported
 * via scripts/importDpl.ts from "internal/DPL <bulan tahun>.xlsx" (e.g.
 * "internal/DPL MEI 2026.xlsx"). If more than one contract matches (a
 * duplicate for the same outlet+product+period), the one with the largest
 * newOnPi wins. Returns null when there's no contracted discount on file —
 * callers should fall back to DiskonHistory (see resolveDiskonPctWithHistory)
 * or default to 0. Exposed separately from resolveDiskonPct so callers can
 * also show its active period (prdAwal/prdAkhir), not just the resolved %.
 */
function resolveDiskonContract(diskonList: DiskonByProduct[] | undefined, kodeProduk: string, periodeAwal: string): DiskonByProduct | null {
  if (!diskonList || !kodeProduk || !periodeAwal) return null;
  const candidates = diskonList.filter((d) =>
    d.kodeProduk === kodeProduk && d.prdAwal <= periodeAwal && d.prdAkhir >= periodeAwal
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, d) => (d.newOnPi > best.newOnPi ? d : best));
}

function resolveDiskonPct(diskonList: DiskonByProduct[] | undefined, kodeProduk: string, periodeAwal: string): number | null {
  return resolveDiskonContract(diskonList, kodeProduk, periodeAwal)?.newOnPi ?? null;
}

/**
 * Same as resolveDiskonPct, but falls back to DiskonHistory (FALLBACK source,
 * the highest single-invoice historical % Total Diskon, not period-scoped —
 * imported via scripts/importDiskonHistory.ts from
 * "internal/08062026 Data Diskon All Product Jan-Apr'26.xlsx") when no DPL
 * contract covers this outlet+product+period. DPL ("internal/DPL MEI
 * 2026.xlsx" et al.) always wins when present; history is only ever used as
 * a last resort.
 */
function resolveDiskonPctWithHistory(
  diskonList: DiskonByProduct[] | undefined,
  diskonHistoryList: DiskonHistoryByProduct[] | undefined,
  kodeProduk: string,
  periodeAwal: string
): number | null {
  const fromDpl = resolveDiskonPct(diskonList, kodeProduk, periodeAwal);
  if (fromDpl != null) return fromDpl;
  const fromHistory = diskonHistoryList?.find((d) => d.kodeProduk === kodeProduk);
  return fromHistory?.maxDiskonPct ?? null;
}

/**
 * Display label for the DPL/DPF period backing the "% Diskon (DPL/DPF)"
 * field's current value (2026-07-28 request: surface the contract period,
 * not just the resolved %). Returns null when there's nothing on file for
 * this product+period at all — the field is then just a plain manual entry.
 */
function resolveDiskonPeriodLabel(
  diskonList: DiskonByProduct[] | undefined,
  diskonHistoryList: DiskonHistoryByProduct[] | undefined,
  kodeProduk: string,
  periodeAwal: string
): string | null {
  const contract = resolveDiskonContract(diskonList, kodeProduk, periodeAwal);
  if (contract) return `DPL periode ${contract.prdAwal}-${contract.prdAkhir}`;
  const fromHistory = diskonHistoryList?.find((d) => d.kodeProduk === kodeProduk);
  if (fromHistory) return "Historis (tidak terikat periode kontrak)";
  return null;
}

function computeEstimasi(entry: ProdukEntry, dokter: DokterFields, product: Product | null): number {
  if (!product) return 0;
  const hst  = hargaST(product);
  const resep = parseFloat(entry.jumlahResepHari) || 0;
  const qty   = parseFloat(entry.qtyProdukResep) || 0;
  const hari  = parseFloat(entry.hariKerjaBulan) || parseFloat(dokter.hariKerjaBulan) || 0;
  const lama  = dokter.lamaPeriode || 1;
  if (!hst || !resep || !qty || !hari) return 0;
  return Math.round(resep * qty * hari * hst * lama);
}

// Same inputs as computeEstimasi, but the unit quantity instead of the Rp value.
function computeQtyTotal(entry: ProdukEntry, dokter: DokterFields): number {
  const resep = parseFloat(entry.jumlahResepHari) || 0;
  const qty   = parseFloat(entry.qtyProdukResep) || 0;
  const hari  = parseFloat(entry.hariKerjaBulan) || parseFloat(dokter.hariKerjaBulan) || 0;
  const lama  = dokter.lamaPeriode || 1;
  if (!resep || !qty || !hari) return 0;
  return Math.round(resep * qty * hari * lama);
}

// Qty is entered/computed in ST (satuan terkecil); this converts it to SJ
// (satuan jual) — divide by konversiPembagi (ST per SJ). Function/variable
// names below still say "UB" internally; only the UI-facing label is SJ.
function qtyToUB(qtyST: number, product: Product): number {
  const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
  return qtyST / konversi;
}

// The real satuan jual name (e.g. "BOX", "STRIP") when the product has one on
// file — "SJ" is the fallback both when no product is picked yet AND when
// Product.satuan is just an import placeholder ("-"/"—"/"–", no real unit
// synced), which is most products (2026-07-28 follow-up: falling back only on
// a missing/empty string let "—" through as if it were a real unit name).
function satuanLabel(product: Product | null | undefined): string {
  const s = product?.satuan?.trim();
  return s && !/^[-—–]$/.test(s) ? s : "SJ";
}

// Returns the per-month estimate from the most recent PSSP contract for a product —
// EXPIRED OR STILL ACTIVE. Matches by product name only (Procode ≠ Item Kode across
// systems). estBaris is the full-period total, divided by months to get per-month
// baseline. Requires estBaris > 0 — active contracts often have estBaris = 0 before
// data is filled, in which case this falls through to an older contract if one exists.
// (2026-07-27 fix: used to be expired-only via a separate computeOldEstPerMonth, which
// meant "Growth Estimasi" silently disappeared whenever the doctor's most recent PSSP
// for that product was still running — reported as "ada estimasinya di PSSP
// sebelumnya" with no growth shown. Also used by the total-level growth card.)
interface PeriodComparison {
  perBulan: number;
  /** The PSSP contract period this figure was derived from — surfaced next to
   * Growth Estimasi/Pelunasan so the comparison baseline isn't a black box
   * (2026-07-28 request). */
  period: string;
}

function computeLatestEstPerMonth(history: PsspKontrakSummary[], namaProduk: string): PeriodComparison | null {
  const norm = namaProduk.toLowerCase().trim();
  const rows = history
    .filter((r) => r.nmProduk?.toLowerCase().trim() === norm && (r.estBaris ?? 0) > 0)
    .sort((a, b) => b.prdAkhir.localeCompare(a.prdAkhir));
  if (rows.length === 0) return null;
  const latest = rows[0];
  const sy = parseInt(latest.prdAwal.slice(0, 4)), sm = parseInt(latest.prdAwal.slice(4));
  const ey = parseInt(latest.prdAkhir.slice(0, 4)), em = parseInt(latest.prdAkhir.slice(4));
  const months = (ey - sy) * 12 + (em - sm) + 1;
  if (months <= 0 || latest.estBaris <= 0) return null;
  return { perBulan: latest.estBaris / months, period: `${latest.prdAwal}-${latest.prdAkhir}` };
}

// "Pernah di PSSP" product tag: pelunasan % across ALL PSSP history for this
// product (matched by name — Procode ≠ Item Kode across systems), already
// scoped to the selected doctor+outlet via kdCust, regardless of how long ago
// it ran. Used by both the product picker dropdown (buildProductOptions) and
// the "Pernah PSSP" section of the Produk Rekomendasi tab (KriteriaProdukPanel)
// — used to be windowed to the last 3 months only (rowsActiveLast3Months /
// computePelunasan3Bln, removed 2026-07-31), which meant a product with real
// but older PSSP history could show as "Pernah PSSP" in one place and not the
// other, since only the panel had been switched to all-period.
function computePelunasanAllPeriode(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const norm = namaProduk.toLowerCase().trim();
  const rows = history.filter((r) => r.nmProduk?.toLowerCase().trim() === norm);
  if (rows.length === 0) return null;
  const sumEst = rows.reduce((s, r) => s + r.estBaris, 0);
  const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
  return sumEst > 0 ? Math.round((sumLunas / sumEst) * 100) : null;
}

// Growth Pelunasan's baseline: the most recent PSSP contract for this product (active
// or expired, matched by name) with any money actually realized against it — its
// totalLunas spread across however many months it's ACTUALLY been running so far
// (elapsedMonthsCount, same "running rate" convention as ContractCard below and the
// Summary page's Pelunasan Running Rate column), NOT a fixed /3. (2026-07-27
// correction: "12jt dibagi berapa bulan sudah berjalan [...] atau selama bulannya
// sudah berjalan kalau kurang dari 3 bulan" — a contract only 1 month in was wrongly
// diluted by dividing its totalLunas by a flat 3 regardless of how long it'd run.)
function computePelunasanAktualPerMonth(history: PsspKontrakSummary[], namaProduk: string): PeriodComparison | null {
  const norm = namaProduk.toLowerCase().trim();
  const rows = history
    .filter((r) => r.nmProduk?.toLowerCase().trim() === norm && (r.totalLunas ?? 0) > 0)
    .sort((a, b) => b.prdAkhir.localeCompare(a.prdAkhir));
  if (rows.length === 0) return null;
  const latest = rows[0];
  const { elapsed } = elapsedMonthsCount(latest.prdAwal, latest.prdAkhir);
  if (elapsed <= 0) return null;
  return { perBulan: latest.totalLunas / elapsed, period: `${latest.prdAwal}-${latest.prdAkhir}` };
}

function computeLabelCustomer(history: PsspKontrakSummary[]): string {
  if (history.length === 0) return "Dokter Baru";
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byContract = new Map<string, PsspKontrakSummary[]>();
  for (const row of history) {
    const bucket = byContract.get(row.cUrut) ?? [];
    bucket.push(row);
    byContract.set(row.cUrut, bucket);
  }
  let hasActive = false;
  let activeEst = 0, activeLunas = 0, allEst = 0, allLunas = 0;
  for (const rows of byContract.values()) {
    const est = rows.reduce((s, r) => s + r.estBaris, 0);
    const lunas = rows.reduce((s, r) => s + r.totalLunas, 0);
    allEst += est; allLunas += lunas;
    if (rows[0].prdAkhir >= currentPeriod) { hasActive = true; activeEst += est; activeLunas += lunas; }
  }
  if (hasActive) {
    const pct = activeEst > 0 ? activeLunas / activeEst * 100 : 0;
    return pct >= 80 ? "Retensi, Pelunasan Bagus" : "Retensi";
  }
  const pct = allEst > 0 ? allLunas / allEst * 100 : 0;
  return pct >= 80 ? "Pernah PSSP, Pelunasan Bagus" : "Pernah PSSP";
}

// This customer's total distinct PSSP contract count — same convention as
// PsspStatusByCustomer.psspKe (customer.ts) and the sidebar's per-contract
// "PSSP ke-N" badge (PsspHistoryPanel below), so the number means the same
// thing everywhere it's shown (2026-07-28 request: surface it on the
// customer info card too, not just the sidebar/doctor-picker dropdown).
function computePsspKe(history: PsspKontrakSummary[]): number {
  return new Set(history.map((r) => r.cUrut)).size;
}

export function LabelCustomerBadge({ label }: { label: string }) {
  const isNew = label === "Dokter Baru";
  const isGood = label.includes("Bagus");
  const color = isNew
    ? "var(--color-blue)"
    : isGood ? "var(--color-success, #16a34a)"
    : "var(--color-text-muted)";
  const bg = isNew
    ? "var(--color-blue-light, #eff6ff)"
    : isGood ? "var(--color-success-bg, #dcfce7)"
    : "var(--color-bg-subtle)";
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded"
      style={{ color, background: bg, border: `1px solid ${color}` }}>
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}>{children}</p>
  );
}

function Req() {
  return <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>;
}
function Opt() {
  return <span className="ml-1 text-xs" style={{ color: "var(--color-text-faint)", fontWeight: 400 }}>(opsional)</span>;
}
const ERR_RING = { outline: "2px solid var(--color-red)", outlineOffset: 2, borderRadius: 6 } as const;

function UnitInput({ value, onChange, unit, placeholder = "0", step, min = 0, max }: {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
  /** When set, renders up/down stepper buttons that bump the value by this amount. */
  step?: number;
  min?: number;
  /** When set, typing/stepping past this value is clamped down to it (e.g. Hari Praktek ≤ 31, no month has more days). */
  max?: number;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "") { onChange(v); return; }
    if (!/^\d*\.?\d*$/.test(v)) return;
    // Clamp only once the value is a complete-enough number to compare —
    // letting a partial typed value like "3" through unclamped even though
    // "31" (the eventual target) is fine, but rejecting a keystroke that
    // would push a COMPLETE value over `max` (e.g. typing "32" over max=31).
    if (max != null) {
      const n = parseFloat(v);
      if (!isNaN(n) && n > max) { onChange(String(max)); return; }
    }
    onChange(v);
  }

  function bump(delta: number) {
    if (step == null) return;
    // Empty field displays `placeholder` (e.g. "1") as its implied value — bump from
    // that, not from 0, so the first click steps relative to what's actually shown.
    const current = parseFloat(value) || parseFloat(placeholder) || 0;
    let next = Math.max(min, current + delta);
    if (max != null) next = Math.min(max, next);
    const decimals = step % 1 === 0 ? 0 : String(step).split(".")[1]?.length ?? 1;
    onChange(next.toFixed(decimals));
  }

  return (
    <div className="flex items-stretch rounded-md overflow-hidden"
      style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
      <input type="text" inputMode="decimal" placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className="flex-1 min-w-0 w-0 px-2.5 py-1.5 text-sm outline-none"
        style={{ background: "transparent", color: "var(--color-text)" }} />
      {step != null && (
        <div className="flex flex-col shrink-0" style={{ borderLeft: "1px solid var(--color-border-strong)" }}>
          <button type="button" onClick={() => bump(step)} tabIndex={-1}
            className="flex-1 flex items-center justify-center px-1.5 leading-none"
            style={{ fontSize: 9, color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border-strong)" }}>
            ▲
          </button>
          <button type="button" onClick={() => bump(-step)} tabIndex={-1}
            className="flex-1 flex items-center justify-center px-1.5 leading-none"
            style={{ fontSize: 9, color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
            ▼
          </button>
        </div>
      )}
      {unit && (
        <>
          <span style={{ width: 1, background: "var(--color-border-strong)" }} />
          <span className="flex items-center px-2 text-xs font-medium whitespace-nowrap"
            style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
            {unit}
          </span>
        </>
      )}
    </div>
  );
}

// ─── DokterFieldsSection ──────────────────────────────────────────────────────
// Per-dokter fields: periode, hari kerja, pasien/hari, visit/minggu, kompetitor

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

// Parses a "YYYY-QN" period string (PoaForm.period, or a per-row quarter
// string built the same way — see DokterFieldsSection's rowQuarter) into its
// year, 1-indexed quarter number, and the quarter's 3 months.
function parsePoaQuarterMonths(period: string): { year: number; quarter: number; months: number[] } | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const quarter = parseInt(m[2], 10);
  const startMonth = (quarter - 1) * 3 + 1;
  return { year, quarter, months: [startMonth, startMonth + 1, startMonth + 2] };
}

// Returns an error message if periodeAwal (YYYYMM) is malformed or falls outside the given quarter.
// Returns null while the field is still incomplete.
function periodeAwalFormatError(periodeAwal: string, quarterPeriod: string): string | null {
  if (periodeAwal.length !== 6) return null;
  const year = parseInt(periodeAwal.slice(0, 4), 10);
  const month = parseInt(periodeAwal.slice(4, 6), 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return "Format tidak valid (YYYYMM)";
  const quarter = parsePoaQuarterMonths(quarterPeriod);
  if (quarter && (year !== quarter.year || !quarter.months.includes(month))) {
    const [m1, , m3] = quarter.months;
    return `Harus di ${MONTH_LABELS[m1 - 1]}-${MONTH_LABELS[m3 - 1]} ${quarter.year} (sesuai Quarter yang dipilih)`;
  }
  return null;
}

function DokterFieldsSection({ fields, onChange, poaPeriod, periodeAwalError, hariKerjaBulanError, surveyPasienHarianError, lamaPeriodeRequiredError, jenisPsSpError, bentukPsspError, showCustomerLevelFields = true, kodeCustomer, kodePI }: {
  fields: DokterFields;
  onChange: (patch: Partial<DokterFields>) => void;
  poaPeriod: string;
  periodeAwalError?: boolean;
  hariKerjaBulanError?: boolean;
  surveyPasienHarianError?: boolean;
  lamaPeriodeRequiredError?: boolean;
  jenisPsSpError?: boolean;
  bentukPsspError?: boolean;
  /** False in "Tambah Produk" (adding one more product to an existing doctor)
   * — Pihak PSSP is shared across the whole doctor and silently inherited
   * there, so it's not surfaced at all; it can only be changed via "Edit
   * Rencana POA" (EditDoctorPanel), which edits every product at once.
   * Pengali Nilai R is also doctor-level but lives in the "Total Semua
   * Produk" section instead (2026-07-28 request), not here. Survey Pasien
   * Harian follows the same rule — silently inherited, not re-collected. */
  showCustomerLevelFields?: boolean;
  /** Feeds the "Histori Visit (3 Bulan Terakhir)" hint under Rencana Visit /
   * Bulan below — undefined (e.g. brand-new doctor not yet materialized as
   * a Customer row) just hides the hint, see VisitHistoryHint. */
  kodeCustomer?: string;
  kodePI?: string;
}) {
  const lamaPeriodeTooLong = fields.lamaPeriode > 12;
  const lamaPeriodeError = lamaPeriodeTooLong || !!lamaPeriodeRequiredError;
  const periodeOk = fields.periodeAwal.length === 6;

  // Per-row Quarter picker (2026-07-31 request: "tiap baris bisa atur mau
  // masukkin poa nya ke q berapa") — a doctor's rencana no longer has to
  // fall inside the parent POA form's own quarter; each doctor row picks its
  // own target Quarter (year fixed to the POA's own year — cross-year rows
  // aren't part of this request), and Periode Awal's month options + the
  // format/range validation both key off THIS instead of poaPeriod directly.
  const poaYear = parsePoaQuarterMonths(poaPeriod)?.year ?? new Date().getFullYear();
  const [rowQuarter, setRowQuarter] = useState<number>(() => {
    if (fields.periodeAwal.length === 6) {
      return Math.ceil(parseInt(fields.periodeAwal.slice(4, 6), 10) / 3);
    }
    return parsePoaQuarterMonths(poaPeriod)?.quarter ?? 1;
  });
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;

  const periodeFormatErr = periodeAwalFormatError(fields.periodeAwal, rowQuarterPeriod);
  const periodeHasErr = periodeAwalError || !!periodeFormatErr;

  // One dropdown, options are the 3 YYYYMM values inside the ROW's chosen
  // quarter (e.g. rowQuarterPeriod "2026-Q3" → 202607, 202608, 202609) — not
  // necessarily the same quarter as the parent POA form itself anymore.
  const periodeOptions = useMemo(() => {
    const quarter = parsePoaQuarterMonths(rowQuarterPeriod);
    const opts: { value: string; label: string }[] = [];
    if (quarter) {
      for (const m of quarter.months) {
        opts.push({ value: `${quarter.year}${String(m).padStart(2, "0")}`, label: `${MONTH_LABELS[m - 1]} ${quarter.year}` });
      }
    }
    // Preserve an existing out-of-range value (e.g. pre-existing data) so the select still shows it.
    if (fields.periodeAwal && !opts.some((o) => o.value === fields.periodeAwal)) {
      const y = fields.periodeAwal.slice(0, 4);
      const m = parseInt(fields.periodeAwal.slice(4, 6), 10);
      opts.unshift({ value: fields.periodeAwal, label: `${MONTH_LABELS[m - 1] ?? "?"} ${y}` });
    }
    return opts;
  }, [fields.periodeAwal, rowQuarterPeriod]);

  return (
    <div className="space-y-4">
      {/* Rencana Kunjungan */}
      <div>
        <SectionLabel>Rencana Kunjungan</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1" {...(hariKerjaBulanError ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: hariKerjaBulanError ? "var(--color-red)" : "var(--color-text-muted)" }}>Hari Praktek / Bln<Req /></span>
            <div style={hariKerjaBulanError ? ERR_RING : undefined}>
              <UnitInput
                value={fields.hariKerjaBulan}
                onChange={(v) => onChange({ hariKerjaBulan: v })}
                unit="Hari"
                placeholder="Jumlah hari praktek / bulan"
                max={31} />
            </div>
            {hariKerjaBulanError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Bulan<Req /></span>
            <UnitInput
              value={fields.rencanaVisitMinggu}
              onChange={(v) => onChange({ rencanaVisitMinggu: v })}
              unit="Kali" />
            <VisitHistoryHint kodeCustomer={kodeCustomer} kodePI={kodePI} />
          </label>
          {/* Doctor-level, silently inherited (not re-collected) when just
              adding one more product to an existing doctor — same rule as
              Pihak PSSP above. */}
          {showCustomerLevelFields && (
            <label className="flex flex-col gap-1" {...(surveyPasienHarianError ? { "data-field-err": "true" } : {})}>
              <span className="text-xs" style={{ color: surveyPasienHarianError ? "var(--color-red)" : "var(--color-text-muted)" }}>Survey Pasien Harian<Req /></span>
              <div style={surveyPasienHarianError ? ERR_RING : undefined}>
                <UnitInput
                  value={fields.surveyPasienHarian}
                  onChange={(v) => onChange({ surveyPasienHarian: v })}
                  unit="Pasien"
                  placeholder="Hasil survey pasien harian" />
              </div>
              {surveyPasienHarianError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            </label>
          )}
        </div>
      </div>

      {/* Rencana PSSP */}
      <div>
        <SectionLabel>Rencana PSSP</SectionLabel>
        <div className="flex flex-wrap items-start gap-3">
          <label className="flex flex-col gap-1 shrink-0" style={{ width: 130 }}>
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Quarter</span>
            <select
              value={rowQuarter}
              onChange={(e) => {
                const q = parseInt(e.target.value, 10);
                setRowQuarter(q);
                // Old Periode Awal almost certainly falls outside the newly
                // picked quarter — clear it rather than leave a stale value
                // silently failing periodeAwalFormatError.
                onChange({ periodeAwal: "" });
              }}
              className="input-field w-full">
              <option value={1}>Q1 (Jan-Mar)</option>
              <option value={2}>Q2 (Apr-Jun)</option>
              <option value={3}>Q3 (Jul-Sep)</option>
              <option value={4}>Q4 (Okt-Des)</option>
            </select>
          </label>
          <div className="flex flex-col gap-1 shrink-0" style={{ width: 200 }} {...(periodeHasErr ? { "data-field-err": "true" } : {})}>
            <span className="text-xs whitespace-nowrap" style={{ color: periodeHasErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
              Periode Awal<Req />
            </span>
            <select
              value={fields.periodeAwal}
              onChange={(e) => onChange({ periodeAwal: e.target.value })}
              className="input-field font-mono w-full"
              style={{ color: fields.periodeAwal ? "var(--color-text)" : "var(--color-text-faint)", ...(periodeHasErr ? ERR_RING : undefined) }}>
              <option value="">YYYYMM</option>
              {periodeOptions.map((o) => <option key={o.value} value={o.value}>{o.value} · {o.label}</option>)}
            </select>
            {periodeAwalError && (
              <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>
            )}
            {!periodeAwalError && periodeFormatErr && (
              <span className="text-xs" style={{ color: "var(--color-red)" }}>{periodeFormatErr}</span>
            )}
          </div>
          <label className="flex flex-col gap-1 shrink-0" style={{ width: 220 }} {...(lamaPeriodeError ? { "data-field-err": "true" } : {})}>
            <span className="text-xs whitespace-nowrap" style={{ color: lamaPeriodeError ? "var(--color-red)" : "var(--color-text-muted)" }}>Lama Periode<Req /></span>
            <div style={lamaPeriodeError ? ERR_RING : undefined}>
              <UnitInput
                value={fields.lamaPeriode ? String(fields.lamaPeriode) : ""}
                onChange={(v) => onChange({ lamaPeriode: v ? parseInt(v) || 0 : 0 })}
                unit="bulan" />
            </div>
            {lamaPeriodeRequiredError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            {!lamaPeriodeRequiredError && lamaPeriodeTooLong && <span className="text-xs" style={{ color: "var(--color-red)" }}>Maksimal 12 bulan</span>}
          </label>
          {periodeOk && fields.lamaPeriode > 0 && (
            <div className="flex flex-col gap-1 shrink-0" style={{ width: 110 }}>
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>s/d</span>
              <div className="input-field flex items-center whitespace-nowrap"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)", cursor: "default" }}>
                {formatPeriode(computePeriodeAkhir(fields.periodeAwal, fields.lamaPeriode))}
              </div>
            </div>
          )}
          <label className="flex flex-col gap-1 shrink-0" style={{ width: 130 }} {...(jenisPsSpError ? { "data-field-err": "true" } : {})}>
            <span className="text-xs whitespace-nowrap" style={{ color: jenisPsSpError ? "var(--color-red)" : "var(--color-text-muted)" }}>PS / SP<Req /></span>
            <div style={jenisPsSpError ? ERR_RING : undefined}>
              <select
                value={fields.jenisPsSp}
                onChange={(e) => onChange({ jenisPsSp: e.target.value })}
                className="input-field w-full"
                style={{ color: fields.jenisPsSp ? "var(--color-text)" : "var(--color-text-faint)" }}>
                <option value="">Pilih</option>
                <option value="PS">PS - Pemberian di belakang</option>
                <option value="SP">SP - Pemberian di depan</option>
              </select>
            </div>
            {jenisPsSpError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          <label className="flex flex-col gap-1 shrink-0" style={{ width: 120 }} {...(bentukPsspError ? { "data-field-err": "true" } : {})}>
            <span className="text-xs whitespace-nowrap" style={{ color: bentukPsspError ? "var(--color-red)" : "var(--color-text-muted)" }}>Jenis PSSP<Req /></span>
            <div style={bentukPsspError ? ERR_RING : undefined}>
              <select
                value={fields.bentukPssp}
                onChange={(e) => onChange({ bentukPssp: e.target.value })}
                className="input-field w-full"
                style={{ color: fields.bentukPssp ? "var(--color-text)" : "var(--color-text-faint)" }}>
                <option value="">Pilih</option>
                {Object.entries(BENTUK_PSSP_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {bentukPsspError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          {showCustomerLevelFields && (
            <label className="flex flex-col gap-1 shrink-0" style={{ width: 120 }}>
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Pihak PSSP</span>
              <select
                value={fields.pihakPssp}
                onChange={(e) => onChange({ pihakPssp: e.target.value })}
                className="input-field text-xs">
                <option value="USER">User</option>
                <option value="KPDM">KPDM</option>
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── buildProductOptions ────────────────────────────────────────────────────
// Shared product-picker options builder — tiers by spesialisasi match, tags paket kontes.

function buildProductOptions(products: Product[], spesialisasi: string | undefined, kriteriaMap?: Map<string, { kriteriaBaru: string; kategori: string }>, psspHistory?: PsspKontrakSummary[], surveyRows?: SurveyRekomendasiRow[]): ComboboxOption[] {
  const tierSorted = spesialisasi
    ? sortProductsBySpesialisasi(products, spesialisasi)
    : products;
  const matchedPakets = spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [];
  const TIER_LABEL = ["Produk Kontes Sesuai Spesialisasi", "Produk Kontes Lainnya", "Produk Lainnya"];

  // Same "Produk Survey" grouping as the sidebar's Kriteria Produk panel
  // (KriteriaProdukPanel) — products recommended by SurveyRekomendasi for this
  // doctor+outlet, requested to appear right after the focus groups here too.
  const surveyPotensiByKode = new Map<string, number | null>();
  for (const r of surveyRows ?? []) surveyPotensiByKode.set(r.kodeProduk, r.potensiBulan);

  // New top sort priority: products with PSSP history first, then the existing
  // tier order within each of those two buckets. All-period (2026-07-31,
  // matches the "Pernah PSSP" section of Produk Rekomendasi/KriteriaProdukPanel
  // — was 3-month-windowed here, which meant a product with real but older-
  // than-3-months PSSP history could show "Pernah PSSP" in the panel but not
  // in this dropdown, or vice versa; both now agree).
  const pelunasanByProduk = new Map<string, number>();
  if (psspHistory) {
    for (const p of tierSorted) {
      const pct = computePelunasanAllPeriode(psspHistory, p.namaProduk);
      if (pct != null) pelunasanByProduk.set(p.kodeProduk, pct);
    }
  }
  const sorted = [...tierSorted].sort((a, b) => {
    const aHasPssp = pelunasanByProduk.has(a.kodeProduk) ? 0 : 1;
    const bHasPssp = pelunasanByProduk.has(b.kodeProduk) ? 0 : 1;
    if (aHasPssp !== bHasPssp) return aHasPssp - bHasPssp;
    if (aHasPssp === 1) {
      // Among non-PSSP items, keep kontes products first (tier order already
      // does that), then survey-recommended non-kontes products, then the rest.
      const aSub = getProductTier(a.namaProduk, matchedPakets) !== 2 ? 0 : surveyPotensiByKode.has(a.kodeProduk) ? 1 : 2;
      const bSub = getProductTier(b.namaProduk, matchedPakets) !== 2 ? 0 : surveyPotensiByKode.has(b.kodeProduk) ? 1 : 2;
      if (aSub !== bSub) return aSub - bSub;
    }
    return 0; // keep tier order (tierSorted is already stable-sorted by tier)
  });

  return sorted.map((p) => {
    const allPakets = getAllPakets(p.namaProduk);
    const relevantPaket = allPakets.find((pk) => matchedPakets.includes(pk)) ?? allPakets[0] ?? null;
    const tier = getProductTier(p.namaProduk, matchedPakets);
    const isSurveyOnly = tier === 2 && surveyPotensiByKode.has(p.kodeProduk);
    const kriteriaRow = kriteriaMap?.get(p.kodeProduk);
    const kriteria = kriteriaRow?.kriteriaBaru;
    // `kategori` ("Low Hanging Fruit" / "Blue Ocean" / "Red Ocean") is never shown
    // itself (2026-07-21, business owner: keep it fully out of the picker).
    // "Produk Sudah Terstandarisasi..." (kategori "Low Hanging Fruit") gets a text
    // badge showing kriteriaBaru IN FULL, colored by its own "- Ada Sales" (orange)
    // / "- Tidak Ada Sales" (yellow) suffix. NOTE: Kompetisi Rendah/Tinggi rows
    // carry that same Ada/Tidak Ada Sales suffix in the DB too, but must NOT be
    // caught here — they keep their existing blue/red dot-only treatment below.
    const isStandarisasi = kriteria?.startsWith("Produk Sudah Terstandarisasi") ?? false;
    const tagColor: "blue" | "yellow" | "red" | "orange" | undefined = isStandarisasi
      ? (kriteria?.includes("Tidak Ada Sales") ? "yellow" : "orange")
      : kriteria?.startsWith("Produk Kompetisi Rendah")
      ? "blue"
      : kriteria?.startsWith("Produk Kompetisi Tinggi")
      ? "red"
      : undefined;
    const tag = isStandarisasi && kriteria ? formatKriteriaLabel(kriteria) : undefined;
    // Only the Produk Sudah Terstandarisasi badge shows as text — every other
    // kriteria (Kompetisi Rendah/Tinggi, etc.) is still a plain color dot.
    const tagDotOnly = !isStandarisasi;
    const paketLabel = relevantPaket ?? p.namaGroupBrand;
    // "Produk Pernah di PSSP" — pelunasan % across ALL PSSP history for this
    // doctor+outlet (psspHistory is already scoped to the selected kdCust,
    // which ties doctor+outlet together), not just the last 3 months.
    const pelunasanAllPeriode = pelunasanByProduk.get(p.kodeProduk) ?? null;
    const potensiSurvey = isSurveyOnly ? surveyPotensiByKode.get(p.kodeProduk) ?? null : null;
    const tag2 = pelunasanAllPeriode != null
      ? `Pernah PSSP · Pelunasan ${pelunasanAllPeriode}%`
      : potensiSurvey != null ? `Potensi Survey ${potensiSurvey}/bln` : undefined;
    const tag2Color: "green" | "yellow" | "red" | "orange" | undefined = pelunasanAllPeriode != null
      ? (pelunasanAllPeriode >= 80 ? "green" : pelunasanAllPeriode >= 40 ? "yellow" : "red")
      : potensiSurvey != null ? "orange"
      : undefined;
    return {
      value: p.kodeProduk,
      label: p.namaProduk,
      sublabel: [`${p.kodeProduk} · ${paketLabel}`, p.zatAktif].filter(Boolean).join(" · "),
      group: pelunasanAllPeriode != null
        ? "Pernah di PSSP"
        : isSurveyOnly
        ? "Produk Survey"
        : (spesialisasi ? TIER_LABEL[tier] : allPakets.length > 0 ? "Produk Kontes" : "Produk Lainnya"),
      accent: tier === 0,
      tag,
      tagColor,
      tagDotOnly,
      tag2,
      tag2Color,
    };
  });
}

// ─── ProdukEntryRow ───────────────────────────────────────────────────────────
// Per-product: product picker + resep/hari + qty/resep + status + grey calculator

function ProdukEntryRow({
  entry, index, products, dokterFields, spesialisasi, psspHistory, kriteriaList, psspEverProductNames, diskonList, diskonHistoryList, usedKodeProduk, kodeCustomer, kodePI, onChange, onRemove, showRemove, showError,
}: {
  entry: ProdukEntry;
  index: number;
  products: Product[];
  dokterFields: DokterFields;
  spesialisasi?: string;
  psspHistory?: PsspKontrakSummary[];
  kriteriaList?: KriteriaByOutlet[];
  /** Normalized (lowercase/trim) product names that ever appeared in a PSSP
   * contract at this outlet, any customer — see getPsspProductNamesByOutlet.
   * Used to auto-mark "Sudah Standarisasi" even without a kriteria row. */
  psspEverProductNames?: Set<string>;
  /** DiskonKontrak (DPL) rows at this outlet — used to default "% Diskon (DPL/DPF)" to real data. */
  diskonList?: DiskonByProduct[];
  /** Fallback discount history when no DPL contract covers this outlet+product+period. */
  diskonHistoryList?: DiskonHistoryByProduct[];
  /** kodeProduk values already used by OTHER rows for this same doctor — excluded from the picker. */
  usedKodeProduk?: Set<string>;
  /** Selected doctor's CDB code + outlet — used to look up SurveyRekomendasi for "Produk Kompetitor" autofill. */
  kodeCustomer?: string | null;
  kodePI?: string;
  onChange: (patch: Partial<ProdukEntry>) => void;
  onRemove: () => void;
  showRemove: boolean;
  showError?: boolean;
}) {
  const kriteriaMap = useMemo(() => {
    const m = new Map<string, { kriteriaBaru: string; kategori: string }>(); // kodeProduk → kriteria
    for (const k of kriteriaList ?? []) m.set(k.kodeProduk, { kriteriaBaru: k.kriteriaBaru, kategori: k.kategori });
    return m;
  }, [kriteriaList]);

  // Guards the "Produk Kompetitor" autofill fetch below against a fast
  // second product change resolving out of order and stomping the newer
  // selection's own competitor data.
  const latestKodeProduk = useRef(entry.kodeProduk);
  // Text WE last wrote into produkKompetitor via autofill (not the MR) — lets
  // a subsequent product change tell "still exactly what we auto-filled, safe
  // to replace" apart from "MR edited/typed it themselves, leave it alone".
  // Without this, entry.produkKompetitor being non-empty (because OUR OWN
  // earlier autofill filled it) made every later product change think the MR
  // had typed something, so the old product's competitor text stuck around
  // forever (2026-07-24 bug report: "ganti produk... kompetitornya ga keganti").
  const lastAutoFilledCompetitor = useRef<string | null>(null);
  // Survey's "Potensi / Bulan" for the selected doctor+outlet+product — purely
  // informational, not part of ProdukEntry since it's never submitted.
  const [potensiBulan, setPotensiBulan] = useState<number | null>(null);

  // Full outlet survey list — same getSurveyRekomendasiByOutlet data as the
  // "Produk Survey" section of KriteriaProdukPanel (sidebar), fetched here too
  // so the product picker dropdown can show the same "Produk Survey" group
  // right after "Produk Kontes" (2026-07-28 request).
  const [surveyRows, setSurveyRows] = useState<SurveyRekomendasiRow[]>([]);
  const [, startLoadSurveyRows] = useTransition();
  useEffect(() => {
    startLoadSurveyRows(async () => {
      if (!kodeCustomer || !kodePI) { setSurveyRows([]); return; }
      setSurveyRows(await getSurveyRekomendasiByOutlet(kodeCustomer, kodePI));
    });
  }, [kodeCustomer, kodePI]);

  const productOptions = useMemo(() => {
    const opts = buildProductOptions(products, spesialisasi, kriteriaMap, psspHistory, surveyRows);
    if (!usedKodeProduk || usedKodeProduk.size === 0) return opts;
    return opts.filter((o) => o.value === entry.kodeProduk || !usedKodeProduk.has(o.value));
  }, [products, spesialisasi, kriteriaMap, usedKodeProduk, entry.kodeProduk, psspHistory, surveyRows]);

  const product = useMemo(() => products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null, [products, entry.kodeProduk]);

  const resep  = parseFloat(entry.jumlahResepHari) || 0;
  const qty    = parseFloat(entry.qtyProdukResep) || 0;
  const hari   = parseFloat(entry.hariKerjaBulan) || parseFloat(dokterFields.hariKerjaBulan) || 0;
  const hna    = product ? hargaST(product) : 0;  // price per ST
  const lama   = dokterFields.lamaPeriode || 1;
  const nilaiRPersen = product?.nilaiRPersen ? parseFloat(product.nilaiRPersen) : null;
  const pengaliNilaiR = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
  const canCalc = resep > 0 && qty > 0 && hari > 0 && hna > 0;
  const perBulan = canCalc ? Math.round(resep * qty * hari * hna) : null;
  const totalEst = perBulan != null ? perBulan * lama : null;
  const qtyPerBulanST = canCalc ? resep * qty * hari : null;
  const qtyTotalST = qtyPerBulanST != null ? qtyPerBulanST * lama : null;
  const qtyPerBulan = qtyPerBulanST != null ? Math.round(qtyToUB(qtyPerBulanST, product!)) : null;
  const qtyTotal = qtyTotalST != null ? Math.round(qtyToUB(qtyTotalST, product!)) : null;
  const nilaiPSSPBulan = perBulan != null && nilaiRPersen != null ? Math.round(perBulan * nilaiRPersen * pengaliNilaiR) : null;
  const nilaiPSSPTotal = nilaiPSSPBulan != null ? nilaiPSSPBulan * lama : null;

  const oldEst = (psspHistory && psspHistory.length > 0 && product)
    ? computeLatestEstPerMonth(psspHistory, product.namaProduk)
    : null;
  const oldEstPerMonth = oldEst?.perBulan ?? null;
  const growthRatio = (perBulan != null && oldEstPerMonth != null && oldEstPerMonth > 0)
    ? perBulan / oldEstPerMonth
    : null;
  const growthPct = growthRatio != null ? (growthRatio - 1) * 100 : null;

  // Growth Pelunasan: perBulan vs actual PSSP settlement (pelunasan) realized over the
  // last 3 months for this product — a real-money check separate from (not a
  // replacement for) the PSSP-contract-ESTIMATE-based growth above.
  const pelunasanAktual3Bln = (psspHistory && psspHistory.length > 0 && product)
    ? computePelunasanAktualPerMonth(psspHistory, product.namaProduk)
    : null;
  const pelunasanAktual3BlnPerMonth = pelunasanAktual3Bln?.perBulan ?? null;
  const growthPct3Bln = (perBulan != null && pelunasanAktual3BlnPerMonth != null && pelunasanAktual3BlnPerMonth > 0)
    ? ((perBulan / pelunasanAktual3BlnPerMonth) - 1) * 100
    : null;

  const produkErr = showError && !entry.kodeProduk;
  const resepErr = showError && !entry.jumlahResepHari;
  const qtyErr = showError && !entry.qtyProdukResep;
  const kompetitorErr = showError && !entry.produkKompetitor;

  return (
    <div className="rounded-lg border p-3 space-y-3"
      style={{ background: "var(--color-bg-subtle)", borderColor: produkErr ? "var(--color-red)" : "var(--color-border)" }}>
      {/* Product picker row */}
      <div className="flex items-start gap-2" {...(produkErr ? { "data-field-err": "true" } : {})}>
        <div className="flex-1">
          <div style={produkErr ? ERR_RING : undefined}>
            <Combobox
              name={`_produk_${index}`}
              value={entry.kodeProduk}
              onChange={(v) => {
                latestKodeProduk.current = v;
                const prod = products.find((p) => p.kodeProduk === v);
                const nr = prod?.nilaiRPersen ? parseFloat(prod.nilaiRPersen) : null;
                const kriteria = kriteriaMap.get(v)?.kriteriaBaru;
                // Pernah PSSP di outlet ini = produknya emang udah ada di sana,
                // terlepas dari apa kata kriteria import (2026-07-27 request).
                const everPssp = prod ? (psspEverProductNames?.has(prod.namaProduk.toLowerCase().trim()) ?? false) : false;
                const autoStandarisasi = everPssp || kriteria?.startsWith("Produk Sudah Terstandarisasi")
                  ? "SUDAH_STANDARISASI"
                  : kriteria
                    ? "BELUM_STANDARISASI"
                    : entry.statusStandarisasi;
                const realDiskonPct = v ? resolveDiskonPctWithHistory(diskonList, diskonHistoryList, v, dokterFields.periodeAwal) : null;
                onChange({
                  kodeProduk: v,
                  persenPsspDokter: nr != null ? (nr * 100).toFixed(2) : "",
                  statusStandarisasi: autoStandarisasi,
                  // % Diskon defaults to the real DiskonKontrak value when one's on file for
                  // this outlet+product+period; 0 when there's no contract on file
                  // (belum ada sumber data asli utk Listing Fee, jadi 0). % Entertain
                  // defaults to 1 — no source data either, but 0 read as "field left
                  // blank/forgotten" in practice, 1 is a deliberate non-zero default.
                  persenDiskon: v && realDiskonPct != null ? realDiskonPct.toFixed(2) : "0",
                  persenListingFee: "0",
                  persenEntertain: "1",
                });

                // Survey info for this doctor+outlet+product (2026-07-23):
                // auto-suggests "Produk Kompetitor Utama" from History Produk
                // and shows "Potensi / Bulan" alongside it, read-only.
                setPotensiBulan(null);
                // Clear a still-untouched-since-our-own-autofill competitor
                // text before fetching the new product's — otherwise it just
                // sits there showing the OLD product's competitors. Leaves a
                // genuine manual edit (text that differs from what we last
                // wrote) alone either way.
                const isOwnAutofill = entry.produkKompetitor && entry.produkKompetitor === lastAutoFilledCompetitor.current;
                if (isOwnAutofill) onChange({ produkKompetitor: "" });
                if (v && kodeCustomer && kodePI) {
                  getSurveyRekomendasiInfo(kodeCustomer, kodePI, v).then((info) => {
                    if (latestKodeProduk.current !== v || !info) return;
                    setPotensiBulan(info.potensiBulan);
                    if (info.kompetitor.length === 0) return;
                    if (entry.produkKompetitor && !isOwnAutofill) return; // MR typed something — don't clobber it
                    const text = info.kompetitor
                      .map((h) => (h.pct > 0 ? `${h.namaProduk} (${h.pct}%)` : h.namaProduk))
                      .join("; ");
                    lastAutoFilledCompetitor.current = text;
                    onChange({ produkKompetitor: text });
                  });
                } else {
                  lastAutoFilledCompetitor.current = null;
                }
              }}
              placeholder="Cari produk…"
              options={productOptions}
              maxVisible={Infinity}
            />
          </div>
          {produkErr && <span className="text-xs mt-0.5" style={{ color: "var(--color-red)" }}>Pilih produk</span>}
          {product && (
            <div className="flex gap-3 text-xs mt-1 flex-wrap" style={{ color: "var(--color-text-faint)" }}>
              <span>HNA SJ: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(product.hna)}</strong> ({satuanLabel(product)})</span>
              <span>HNA ST: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(hna)}</strong> ({product.satuanTerkecil ?? satuanLabel(product)})
                <span style={{ opacity: 0.7 }}> = {formatRp(product.hna)} / {product.konversiPembagi ?? "1"}</span>
              </span>
              <span>{product.namaGroupBrand}</span>
              {nilaiRPersen != null && (
                <span style={{ color: "var(--color-blue)" }}>
                  Nilai R: <strong>{(nilaiRPersen * 100).toFixed(1)}%</strong>
                </span>
              )}
              {product.zatAktif && (
                <span>Zat Aktif: <strong style={{ color: "var(--color-text-muted)" }}>{product.zatAktif}</strong></span>
              )}
            </div>
          )}
        </div>
        {showRemove && (
          <button type="button" onClick={onRemove}
            className="text-xs mt-2 shrink-0" style={{ color: "var(--color-red)" }}>
            × Hapus
          </button>
        )}
      </div>

      {/* Produk Kompetitor Utama */}
      <label className="flex flex-col gap-1" {...(kompetitorErr ? { "data-field-err": "true" } : {})}>
        <span className="text-xs" style={{ color: kompetitorErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
          Produk Kompetitor Utama yang dipakai User<Req />
        </span>
        <div style={kompetitorErr ? ERR_RING : undefined}>
          <input type="text" placeholder="Nama produk kompetitor utama yang digunakan user"
            value={entry.produkKompetitor}
            onChange={(e) => onChange({ produkKompetitor: e.target.value })}
            className="input-field text-xs" />
        </div>
        {kompetitorErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
        {potensiBulan != null && (
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            Potensi (survey): <strong style={{ color: "var(--color-text-muted)" }}>{potensiBulan}</strong> / bulan
          </span>
        )}
      </label>

      {/* Per-product inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1" {...(resepErr ? { "data-field-err": "true" } : {})}>
          <span className="text-xs block min-h-8" style={{ color: resepErr ? "var(--color-red)" : "var(--color-text-muted)" }}>Pasien Baru / Hari<Req /></span>
          <div style={resepErr ? ERR_RING : undefined}>
            <UnitInput
              value={entry.jumlahResepHari}
              onChange={(v) => onChange({ jumlahResepHari: v })}
              unit="Pasien"
              placeholder="Masukan jumlah pasien" />
          </div>
          {resepErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          {/* Echoes the doctor-level "Survey Pasien Harian" value here so the
              MR can compare their own manual estimate against the survey
              result (2026-08-08 request). */}
          {dokterFields.surveyPasienHarian && (
            <div className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
              Survey Pasien Per Hari = {dokterFields.surveyPasienHarian} orang
            </div>
          )}
        </label>
        <label className="flex flex-col gap-1" {...(qtyErr ? { "data-field-err": "true" } : {})}>
          <span className="text-xs block min-h-8" style={{ color: qtyErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
            Jml Produk ST / Pasien Baru<Req />
          </span>
          <div style={qtyErr ? ERR_RING : undefined}>
            <UnitInput
              value={entry.qtyProdukResep}
              onChange={(v) => onChange({ qtyProdukResep: v })}
              unit={product?.satuanTerkecil}
              placeholder="Masukan Jumlah ST per resep" />
          </div>
          {qtyErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          {/* Always rendered (even with no product picked yet) so this space is reserved
              up front — text popping in/out as the product changes would otherwise shift
              the fields below it. */}
          <div className="text-xs mt-1 leading-tight" style={{ color: "var(--color-text-faint)" }} title={product?.dosisKekuatanSediaan ?? undefined}>
            <div className="font-medium">Referensi PM</div>
            <div>Resep per Pasien = {product?.qtyPerRxPasien != null && product?.lamaPemberianHari != null ? `${product.qtyPerRxPasien} ${product.satuanTerkecil} / ${product.lamaPemberianHari} hari` : "-"}</div>
            <div>Dosis per hari = {product?.jumlahPemberianPerHari != null ? `${product.jumlahPemberianPerHari} / hari` : "-"}</div>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs block min-h-8" style={{ color: "var(--color-text-muted)" }}>Standarisasi<Opt /></span>
          <select value={entry.statusStandarisasi}
            onChange={(e) => onChange({ statusStandarisasi: e.target.value })}
            className="input-field text-xs">
            <option value="">- Pilih -</option>
            {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        {/* Jenis PSSP — hidden for now per request (excel/notes - 19 07 2026.txt, poin 1),
            field + logic kept intact for a quick re-enable later. */}
        {false && (
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Jenis PSSP<Opt /></span>
            <select value={entry.jenisPssp}
              onChange={(e) => onChange({ jenisPssp: e.target.value })}
              className="input-field text-xs">
              <option value="">- Pilih -</option>
              {Object.entries(JENIS_PSSP_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs block min-h-8" style={{ color: "var(--color-text-muted)" }}>Hari Praktek<Opt /></span>
          <UnitInput
            value={entry.hariKerjaBulan}
            onChange={(v) => onChange({ hariKerjaBulan: v })}
            unit="Hari"
            placeholder={dokterFields.hariKerjaBulan || "default"}
            max={31} />
        </label>
      </div>

      {/* Estimasi Sales + Nilai PSSP — side by side, more compact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
      {perBulan != null && (
        <div className="rounded-lg border px-3 py-2.5 space-y-2"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border-strong)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-faint)" }}>Estimasi Sales</p>
          <div className="flex gap-6 flex-wrap">
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Sales / Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{formatRp(perBulan)}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Sales {lama} Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>{formatRp(totalEst)}</div>
            </div>
          </div>
          <div className="flex gap-6 flex-wrap">
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Qty per {satuanLabel(product)} / Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {qtyPerBulan != null ? `${qtyPerBulan.toLocaleString("id-ID")} ${satuanLabel(product)}` : "-"}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Qty per {satuanLabel(product)} {lama} Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>
                {qtyTotal != null ? `${qtyTotal.toLocaleString("id-ID")} ${satuanLabel(product)}` : "-"}
              </div>
            </div>
          </div>
          <div className="pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth Estimasi</div>
                {oldEst != null && (
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                    PSSP lama {formatRp(Math.round(oldEst.perBulan))}/bln (periode {oldEst.period})
                  </div>
                )}
              </div>
              {growthPct != null ? (
                <span className="text-sm font-semibold"
                  style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                  {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  Belum ada data PSSP
                </span>
              )}
            </div>
            {/* Warning/Apresiasi Logic Growth Estimasi (2026-07-27 request) —
                ≤0% flags a stagnant/declining plan as needing intensifikasi;
                >0% is praised but still flagged to double-check the estimate. */}
            {growthPct != null && (
              <p className="text-xs font-semibold mt-1" style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                {growthPct > 0
                  ? "✓ Estimasi sudah menunjukkan intensifikasi - pastikan nilainya sudah tepat"
                  : "⚠ Intensifikasi kurang — estimasi belum naik dibanding PSSP sebelumnya"}
              </p>
            )}
          </div>
          <div className="pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth Pelunasan (3 Bln Terakhir)</div>
                {pelunasanAktual3Bln != null && (
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                    Pelunasan aktual {formatRp(Math.round(pelunasanAktual3Bln.perBulan))}/bln (periode {pelunasanAktual3Bln.period})
                  </div>
                )}
              </div>
              {growthPct3Bln != null ? (
                <span className="text-sm font-semibold"
                  style={{ color: growthPct3Bln > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                  {growthPct3Bln >= 0 ? "+" : ""}{growthPct3Bln.toFixed(1)}%
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  Belum ada pelunasan PSSP 3 bln terakhir
                </span>
              )}
            </div>
            {/* Same intensifikasi warning as Growth Estimasi above — previously
                missing here entirely, and the color threshold was `>= 0` so an
                exact 0% growth showed as green/"good" instead of flagging it
                (2026-07-28 request). */}
            {growthPct3Bln != null && (
              <p className="text-xs font-semibold mt-1" style={{ color: growthPct3Bln > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                {growthPct3Bln > 0
                  ? "✓ Pelunasan sudah menunjukkan intensifikasi"
                  : "⚠ Intensifikasi kurang — pelunasan belum naik dibanding periode sebelumnya"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Nilai PSSP card — Pengali Nilai R itself now lives in DokterFieldsSection (customer-level) */}
      <div className="flex flex-col gap-3">
      {nilaiPSSPBulan != null && (
        <div className="rounded-lg border px-3 py-2.5 space-y-2"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-blue, #3b82f6)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-blue, #3b82f6)" }}>Nilai PSSP</p>
          <div className="flex gap-6 flex-wrap">
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                Nilai PSSP / Bln
                {nilaiRPersen != null && (
                  <span className="ml-1">
                    ({(nilaiRPersen * 100).toFixed(1)}%{pengaliNilaiR !== 1 ? ` × ${pengaliNilaiR}` : ""})
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(nilaiPSSPBulan)}</div>
            </div>
            {nilaiPSSPTotal != null && (
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Nilai PSSP {lama} Bln</div>
                <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(nilaiPSSPTotal)}</div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
      </div>

      {/* Budget % per produk */}
      <BudgetFieldsRow
        entry={entry}
        onChange={onChange}
        pengaliNilaiR={pengaliNilaiR}
        pihakPssp={dokterFields.pihakPssp}
        diskonPeriodeLabel={product ? resolveDiskonPeriodLabel(diskonList, diskonHistoryList, product.kodeProduk, dokterFields.periodeAwal) : null}
      />
    </div>
  );
}

// ─── BudgetFieldsRow ─────────────────────────────────────────────────────────

function BudgetFieldsRow({
  entry,
  onChange,
  pengaliNilaiR,
  pihakPssp,
  diskonPeriodeLabel,
}: {
  entry: ProdukEntry;
  onChange: (patch: Partial<ProdukEntry>) => void;
  pengaliNilaiR: number;
  /** Customer-level now, not per-product — only relabels the field below. */
  pihakPssp: string;
  /** DPL/DPF contract period backing "% Diskon (DPL/DPF)"'s current value, or
   * a "historis" note when no DPL contract covers this product+period — null
   * when there's nothing on file at all (2026-07-28 request). */
  diskonPeriodeLabel?: string | null;
}) {
  const totalPct =
    (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR +
    [entry.persenDiskon,
     entry.persenDp, entry.persenListingFee, entry.persenEntertain]
      .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  const hasTotal = totalPct > 0;
  const overBudget = totalPct > 42.5;

  function numInput(label: string, key: keyof ProdukEntry, placeholder = "0") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</span>
        <UnitInput
          value={entry[key] as string}
          onChange={(v) => onChange({ [key]: v } as Partial<ProdukEntry>)}
          unit="%"
          placeholder={placeholder} />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            % PSSP {pihakPssp === "KPDM" ? "KPDM" : "User"} (Nilai R)
          </span>
          <div style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <UnitInput value={entry.persenPsspDokter} onChange={() => {}} unit="%" />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>% Diskon (DPL/DPF)</span>
          <UnitInput
            value={entry.persenDiskon}
            onChange={(v) => onChange({ persenDiskon: v })}
            unit="%"
            placeholder="0" />
          {diskonPeriodeLabel && (
            <span className="text-[10px] leading-tight" style={{ color: "var(--color-text-faint)" }}>
              {diskonPeriodeLabel}
            </span>
          )}
        </label>
        {numInput("% DP", "persenDp")}
        {numInput("% Listing Fee", "persenListingFee")}
        {numInput("% ENT", "persenEntertain")}
      </div>
      {hasTotal && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
          style={{
            background: overBudget ? "var(--color-red-light)" : "var(--color-bg)",
            border: `1px solid ${overBudget ? "var(--color-red)" : "var(--color-border)"}`,
            color: overBudget ? "var(--color-red)" : "var(--color-text-muted)",
          }}>
          <span>Total % Budget: <strong>{totalPct.toFixed(2)}%</strong></span>
          <span style={{ fontWeight: 600 }}>{overBudget ? "⚠ OVER BUDGET" : "✓ SAFE"}</span>
        </div>
      )}
    </div>
  );
}

// ─── PsspHistoryPanel ─────────────────────────────────────────────────────────

/** Months elapsed from prdAwal up to (and capped at) the current month, floored at 0. */
function elapsedMonthsCount(prdAwal: string, prdAkhir: string): { elapsed: number; total: number } {
  const now = new Date();
  const currentYYYYMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sy = parseInt(prdAwal.slice(0, 4), 10), sm = parseInt(prdAwal.slice(4), 10);
  const ey = parseInt(prdAkhir.slice(0, 4), 10), em = parseInt(prdAkhir.slice(4), 10);
  const total = (ey - sy) * 12 + (em - sm) + 1;
  const cappedEnd = currentYYYYMM < prdAkhir ? currentYYYYMM : prdAkhir;
  const cy = parseInt(cappedEnd.slice(0, 4), 10), cm = parseInt(cappedEnd.slice(4), 10);
  const elapsed = Math.max(0, Math.min(total, (cy - sy) * 12 + (cm - sm) + 1));
  return { elapsed, total };
}

function PsspHospinetSnapshotCard({ snapshot }: { snapshot: PsspHospinetSnapshotSummary }) {
  const pct = Math.round((snapshot.rr ?? 0) * 100);
  const pctColor = pct >= 80 ? "var(--color-success, #16a34a)" : pct >= 40 ? "var(--color-warning, #f59e0b)" : "var(--color-red)";
  return (
    <div className="rounded-lg border px-3 py-2 space-y-2"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Data PSSP Hospinet</span>
        <span className="text-xs px-1.5 py-0.5 rounded font-medium"
          style={{
            background: snapshot.psspBerjalan ? "var(--color-blue-light)" : "var(--color-bg-subtle)",
            color: snapshot.psspBerjalan ? "var(--color-blue)" : "var(--color-text-faint)",
          }}>
          {snapshot.psspBerjalan ? "Berjalan" : "Tidak berjalan"}
        </span>
      </div>
      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Status: {snapshot.statusCustomer}
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs">
        <div>
          <div style={{ color: "var(--color-text-faint)" }}>Value PSSP</div>
          <div style={{ color: "var(--color-text-muted)" }}>{formatRp(snapshot.valuePssp)}</div>
        </div>
        <div>
          <div style={{ color: "var(--color-text-faint)" }}>Pelunasan</div>
          <div style={{ color: "var(--color-text-muted)" }}>{formatRp(snapshot.pelunasan)}</div>
        </div>
        <div>
          <div style={{ color: "var(--color-text-faint)" }}>RR</div>
          <div style={{ color: pctColor }}>{pct}%</div>
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Snapshot agregat (bukan per-kontrak/per-produk) - dari data Hospinet, belum granular seperti histori PSSP di atas.
      </p>
    </div>
  );
}

function PsspHistoryPanel({ kodeCustomer, kodePI, doctorName, onLabel, onHistory }: {
  kodeCustomer: string;
  /** Currently-selected outlet — narrows the panel to contracts at this outlet only. */
  kodePI?: string;
  /** Used to look up the Hospinet snapshot fallback (kodeCustomer-less customers). */
  doctorName?: string;
  onLabel?: (label: string) => void;
  onHistory?: (rows: PsspKontrakSummary[]) => void;
}) {
  const [allHistory, setAllHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [hospinetSnapshot, setHospinetSnapshot] = useState<PsspHospinetSnapshotSummary | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const [rows, snapshot] = await Promise.all([
        getPsspHistory(kodeCustomer),
        doctorName && kodePI ? getPsspHospinetSnapshot(doctorName, kodePI) : Promise.resolve(null),
      ]);
      setAllHistory(rows);
      setHospinetSnapshot(snapshot);
      onLabel?.(computeLabelCustomer(rows));
      onHistory?.(rows);
    });
  }, [kodeCustomer, doctorName, kodePI]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || allHistory === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat histori PSSP…
      </div>
    );
  }

  if (allHistory.length === 0) {
    if (hospinetSnapshot) return <PsspHospinetSnapshotCard snapshot={hospinetSnapshot} />;
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada histori PSSP untuk dokter ini.{" "}
        {kodeCustomer && <span className="font-mono" style={{ opacity: 0.6 }}>({kodeCustomer})</span>}
      </div>
    );
  }

  // A doctor can have BOTH a PsspKontrak history AND a separate Hospinet
  // snapshot (different divisions/sources) — the snapshot used to only ever
  // render when contract history was completely empty, silently hiding it
  // whenever any PsspKontrak row existed at all (2026-07-23 fix, requested
  // so Hospinet pelunasan shows alongside the regular history, not instead of it).

  // Narrow to the outlet currently selected in the form — but fall back to the
  // full history if that would hide everything (e.g. kdOutlet not populated on old rows).
  const filtered = kodePI ? allHistory.filter((r) => r.kdOutlet === kodePI) : allHistory;
  const history = filtered.length > 0 ? filtered : allHistory;
  const isFiltered = filtered.length > 0 && filtered.length < allHistory.length;

  // "PSSP ke-N" (2026-07-28 request) — this doctor's contracts numbered by
  // chronological order (oldest = ke-1), computed from the FULL history
  // (allHistory, not narrowed to the currently-selected outlet) so the
  // number reflects the doctor's true lifetime sequence regardless of which
  // outlet the MR happens to be planning for right now.
  const allByContract = new Map<string, PsspKontrakSummary[]>();
  for (const row of allHistory) {
    const bucket = allByContract.get(row.cUrut) ?? [];
    bucket.push(row);
    allByContract.set(row.cUrut, bucket);
  }
  const psspKeByContract = new Map(
    [...allByContract.entries()]
      .sort((a, b) => a[1][0].prdAwal.localeCompare(b[1][0].prdAwal))
      .map(([cUrut], i) => [cUrut, i + 1])
  );

  // Group by cUrut
  const byContract = new Map<string, PsspKontrakSummary[]>();
  for (const row of history) {
    const bucket = byContract.get(row.cUrut) ?? [];
    bucket.push(row);
    byContract.set(row.cUrut, bucket);
  }

  // Determine current period (YYYYMM)
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activeContracts: [string, PsspKontrakSummary[]][] = [];
  const expiredContracts: [string, PsspKontrakSummary[]][] = [];
  for (const entry of byContract.entries()) {
    const prdAkhir = entry[1][0].prdAkhir;
    (prdAkhir >= currentPeriod ? activeContracts : expiredContracts).push(entry);
  }

  function ContractCard({ cUrut, rows, isActive, psspKe }: { cUrut: string; rows: PsspKontrakSummary[]; isActive: boolean; psspKe?: number }) {
    const first = rows[0];
    const biaya    = first.biaya;
    const sumEst   = rows.reduce((s, r) => s + r.estBaris, 0);
    const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
    const pct = sumEst > 0 ? Math.round((sumLunas / sumEst) * 100) : null;
    const pctColor = pct == null ? "var(--color-text-faint)"
      : pct >= 80 ? "var(--color-success, #16a34a)"
      : pct >= 40 ? "var(--color-warning, #f59e0b)"
      : "var(--color-red)";

    // Running rate — actual pelunasan pace vs how much of the contract's own timeline
    // has elapsed so far. >=100% = on/ahead of pace, <100% = falling behind.
    const { elapsed, total } = elapsedMonthsCount(first.prdAwal, first.prdAkhir);
    const expectedPct = total > 0 ? (elapsed / total) * 100 : null;
    const runningRate = isActive && expectedPct != null && expectedPct > 0 && pct != null
      ? Math.round((pct / expectedPct) * 100)
      : null;
    const runningRateColor = runningRate == null ? "var(--color-text-faint)"
      : runningRate >= 100 ? "var(--color-success, #16a34a)"
      : runningRate >= 70 ? "var(--color-warning, #f59e0b)"
      : "var(--color-red)";

    // Retensi: contract still active but ends within the quarter currently being worked
    // (e.g. building a Q3 POA and this PSSP's prdAkhir also falls in Q3) — flags it as
    // needing renewal attention before the quarter closes.
    const isRetensi = isActive && currentQuarterMonths().includes(first.prdAkhir);

    return (
      <div className="rounded-lg border px-3 py-2 space-y-2"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {psspKe != null && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: "var(--color-blue)", background: "var(--color-blue-light, #eff6ff)" }}>
                  PSSP ke-{psspKe}
                </span>
              )}
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--color-text)" }}>{cUrut}</span>
              <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                {first.prdAwal} - {first.prdAkhir}
              </span>
              {isRetensi && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: "var(--color-warning, #f59e0b)", background: "var(--color-warning-bg, #fef3c7)", border: "1px solid var(--color-warning, #f59e0b)" }}>
                  Retensi
                </span>
              )}
            </div>
            {first.nmOutlet && (
              <div className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>{first.nmOutlet}</div>
            )}
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: pctColor }}>
            {pct != null ? `${pct}%` : "-"}
          </span>
        </div>
        {isActive && runningRate != null && (
          <div className="flex items-center justify-between text-xs px-2 py-1 rounded"
            style={{ background: "var(--color-bg-subtle)" }}>
            <span style={{ color: "var(--color-text-faint)" }}>
              Running rate ({elapsed}/{total} bln berjalan, target {Math.round(expectedPct!)}%)
            </span>
            <span className="font-semibold" style={{ color: runningRateColor }}>{runningRate}%</span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1 text-xs">
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Biaya</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(biaya)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Est.</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(sumEst)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Lunas</div>
            <div style={{ color: pctColor }}>{formatRp(sumLunas)}</div>
          </div>
        </div>
        <div className="space-y-1 pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
          {rows.map((r) => {
            const rowPct = r.estBaris > 0 ? Math.round((r.totalLunas / r.estBaris) * 100) : null;
            return (
              <div key={r.id} className="text-xs">
                <div style={{ color: "var(--color-text-muted)" }} className="truncate">{r.nmProduk ?? r.kdProduk}</div>
                <div className="flex items-center justify-between gap-2 tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                  <span>Est: {formatRp(r.estBaris)}</span>
                  <span className="text-right">
                    Lunas: {formatRp(r.totalLunas)}
                    {rowPct != null && (
                      <span className="ml-1" style={{ color: rowPct >= 80 ? "var(--color-success, #16a34a)" : rowPct >= 40 ? "var(--color-warning, #f59e0b)" : "var(--color-red)" }}>
                        ({rowPct}%)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isFiltered && (
        <p className="text-xs px-2 py-1 rounded" style={{ color: "var(--color-blue)", background: "var(--color-blue-light)" }}>
          Difilter ke outlet yang lagi dipilih ({filtered.length} dari {allHistory.length} baris)
        </p>
      )}
      {hospinetSnapshot && <PsspHospinetSnapshotCard snapshot={hospinetSnapshot} />}
      {activeContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-blue)" }}>
            Aktif ({activeContracts.length})
          </p>
          {activeContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} isActive psspKe={psspKeByContract.get(cUrut)} />)}
        </div>
      )}
      {expiredContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            Selesai ({expiredContracts.length})
          </p>
          {expiredContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} isActive={false} psspKe={psspKeByContract.get(cUrut)} />)}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {byContract.size} kontrak · snapshot {history[0]?.snapshotDate ?? "-"}
      </p>
    </div>
  );
}

// ─── ListingFeeHistoryPanel ───────────────────────────────────────────────────

function ListingFeeHistoryPanel({ kodeCustomer }: { kodeCustomer: string }) {
  const [history, setHistory] = useState<ListingFeeKontrakSummary[] | null>(null);

  useEffect(() => {
    getListingFeeHistory(kodeCustomer).then(setHistory);
  }, [kodeCustomer]);

  if (history === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat histori Listing Fee…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada histori Listing Fee untuk dokter ini.
      </div>
    );
  }

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const active = history.filter((r) => r.prdAkhir >= currentPeriod);
  const expired = history.filter((r) => r.prdAkhir < currentPeriod);

  function Row({ r }: { r: ListingFeeKontrakSummary }) {
    return (
      <div className="rounded-lg border px-3 py-2 space-y-1"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-mono font-semibold" style={{ color: "var(--color-text)" }}>{r.noreq}</span>
          <span className="text-xs shrink-0" style={{ color: "var(--color-text-faint)" }}>{r.prdAwal} - {r.prdAkhir}</span>
        </div>
        <div className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>{r.nmProduk ?? r.kdProduk}</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Value</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(r.value)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Target Sales</div>
            <div style={{ color: "var(--color-text-muted)" }}>{r.targetSales != null ? formatRp(r.targetSales) : "-"}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-blue)" }}>
            Aktif ({active.length})
          </p>
          {active.map((r) => <Row key={r.id} r={r} />)}
        </div>
      )}
      {expired.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            Selesai ({expired.length})
          </p>
          {expired.map((r) => <Row key={r.id} r={r} />)}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {history.length} kontrak · snapshot {history[0]?.snapshotDate ?? "-"}
      </p>
    </div>
  );
}

// Histori Visit Per Outlet Per Customer, akumulasi 3 bulan terakhir
// (2026-08-04, stakeholder item #7) — sumber dari API eksternal Exodus
// Activity (src/lib/exodusApi.ts via getVisitHistoryByCustomerOutlet).
// Dipasang sebagai info kecil di bawah field "Rencana Visit / Bulan"
// (DokterFieldsSection) — bukan panel sidebar terpisah, sesuai arahan user
// "masukkin ke input form-nya". `summary === null` (API belum kekonfigurasi/
// gak bisa diakses) sengaja gak dibedain dari "belum ada histori" di sini —
// ini cuma info sekunder/kecil, bukan alur utama, jadi kalau gak ada apa-apa
// buat ditampilin, hint-nya cukup gak dirender sama sekali (beda dari sidebar
// Histori PSSP yang emang pusat perhatian sendiri dan butuh state eksplisit).
function VisitHistoryHint({ kodeCustomer, kodePI }: { kodeCustomer?: string; kodePI?: string }) {
  const [summary, setSummary] = useState<VisitHistorySummary | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      setSummary(kodeCustomer && kodePI ? await getVisitHistoryByCustomerOutlet(kodeCustomer, kodePI) : null);
    });
  }, [kodeCustomer, kodePI]);

  if (!kodeCustomer || !kodePI || loading || summary === null) return null;

  return (
    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
      Histori Visit ({summary.periodeAwal}-{summary.periodeAkhir}): <strong style={{ color: "var(--color-text-muted)" }}>{summary.totalVisits}× kunjungan</strong>
    </p>
  );
}

// ─── KriteriaProdukPanel ──────────────────────────────────────────────────────
// Every product matching one of the 4 product-criteria buckets that used to
// only show up inline in the picker dropdown (2026-07-24) — Produk Kontes PM,
// Pernah PSSP, Listing Corporate - Ada Sales, Listing Corporate - Tidak Ada
// Sales (the general "Low Hanging Fruit" bucket, same kriteriaBaru prefix,
// see formatKriteriaLabel) — always in that order. Sections aren't mutually
// exclusive: a product matching more than one criterion appears in each.

function KriteriaSectionList({ items }: {
  items: {
    key: string; label: string; added?: boolean; isKontes?: boolean;
    badge?: string; badgeColor?: keyof typeof TAG_COLORS;
    /** Second badge — used by "Produk Kontes PM" to show kriteria AND Pernah
     * PSSP status together (merged from the old separate "Belum Diajukan"
     * panel, 2026-07-31), while every other section still only ever sets one. */
    badge2?: string; badge2Color?: keyof typeof TAG_COLORS;
  }[]
}) {
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-2 flex-wrap text-xs px-2 py-1.5 rounded"
          style={{ background: "var(--color-bg-subtle)" }}>
          <span className="flex items-center gap-1.5 min-w-0">
            {it.added && (
              <span title="Sudah ditambahkan ke POA ini" style={{ color: "var(--color-success, #16a34a)", fontWeight: 700, flexShrink: 0 }}>
                ✓
              </span>
            )}
            {it.isKontes && (
              <span title="Produk Kontes PM" style={{ color: "var(--color-blue)", flexShrink: 0, fontSize: 15, fontWeight: 700 }}>
                ★
              </span>
            )}
            <span className="truncate" style={{ color: "var(--color-text)" }}>{it.label}</span>
          </span>
          {(it.badge || it.badge2) && (
            <span className="flex items-center gap-1 shrink-0">
              {it.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: TAG_COLORS[it.badgeColor ?? "blue"].bg, color: TAG_COLORS[it.badgeColor ?? "blue"].fg }}>
                  {it.badge}
                </span>
              )}
              {it.badge2 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: TAG_COLORS[it.badge2Color ?? "blue"].bg, color: TAG_COLORS[it.badge2Color ?? "blue"].fg }}>
                  {it.badge2}
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// Shared by SurveyDataPanel and the "Produk Survey" section of
// KriteriaProdukPanel — both render the same getSurveyRekomendasiByOutlet
// rows, so the sort must stay consistent between them. Order requested
// 2026-07-27: Produk Kontes PM first (same getAllPakets() check used
// everywhere else for a product-level, non-doctor-specific "Kontes" flag —
// see Matriks Summary Per Produk), then within each bucket by Potensi
// Terbesar (potensiBulan descending, null sinks to the bottom).
function sortSurveyRows(rows: SurveyRekomendasiRow[]): SurveyRekomendasiRow[] {
  return [...rows].sort((a, b) => {
    const aKontes = getAllPakets(a.namaProdukRekomendasi).length > 0;
    const bKontes = getAllPakets(b.namaProdukRekomendasi).length > 0;
    if (aKontes !== bKontes) return aKontes ? -1 : 1;
    return (b.potensiBulan ?? -1) - (a.potensiBulan ?? -1);
  });
}

function KriteriaProdukPanel({
  kodeCustomer,
  kodePI,
  spesialisasi,
  produkList,
  products,
  kriteriaList,
  psspHistory,
}: {
  kodeCustomer?: string;
  kodePI?: string;
  spesialisasi?: string;
  /** Which products are already in this doctor's POA — shown as a ✓ (2026-07-24). */
  produkList?: ProdukEntry[];
  products?: Product[];
  kriteriaList?: KriteriaByOutlet[];
  psspHistory?: PsspKontrakSummary[];
}) {
  // Same survey data as the standalone "Data Survey" tab (SurveyDataPanel) —
  // duplicated here on purpose (2026-07-27 request) as the "Produk Survey"
  // section of this renamed "Produk Rekomendasi" panel; the standalone tab
  // stays too, so this data now appears in both places.
  const [surveyRows, setSurveyRows] = useState<SurveyRekomendasiRow[] | null>(null);
  const [, startLoadSurvey] = useTransition();
  useEffect(() => {
    startLoadSurvey(async () => {
      if (!kodeCustomer || !kodePI) { setSurveyRows([]); return; }
      setSurveyRows(await getSurveyRekomendasiByOutlet(kodeCustomer, kodePI));
    });
  }, [kodeCustomer, kodePI]);

  if (!products || products.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Belum ada data produk.
      </div>
    );
  }

  const addedKodeProduk = new Set((produkList ?? []).map((e) => e.kodeProduk).filter(Boolean));
  const matchedPakets = spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [];
  const kriteriaMap = new Map<string, string>();
  for (const k of kriteriaList ?? []) kriteriaMap.set(k.kodeProduk, k.kriteriaBaru);

  // Two distinct kodeProduk SKUs (e.g. different pack sizes) can share the
  // same namaProduk — Product.namaProduk has no unique constraint. Left
  // undeduped, that made every name-keyed section below (starting with
  // "Produk Kontes PM") show what looked like the same product listed twice
  // (2026-07-28 bug report). Dedupe by normalized name, keeping the first
  // occurrence — `products` is already tier/name-sorted by the caller.
  const seenNames = new Set<string>();
  function dedupeByNamaProduk(list: Product[]): Product[] {
    return list.filter((p) => {
      const norm = p.namaProduk.toLowerCase().trim();
      if (seenNames.has(norm)) return false;
      seenNames.add(norm);
      return true;
    });
  }

  const kontesPMRaw: Product[] = [];
  const pernahPsspRaw: { p: Product; pct: number }[] = [];
  const listingSalesRaw: Product[] = [];
  const listingNoSalesRaw: Product[] = [];

  for (const p of products) {
    if (matchedPakets.length > 0 && getProductTier(p.namaProduk, matchedPakets) === 0) kontesPMRaw.push(p);

    const pct = psspHistory ? computePelunasanAllPeriode(psspHistory, p.namaProduk) : null;
    if (pct != null) pernahPsspRaw.push({ p, pct });

    const kriteria = kriteriaMap.get(p.kodeProduk);
    if (kriteria?.startsWith("Produk Sudah Terstandarisasi") && (!spesialisasi || isRelevantToSpesialisasi(p.spesialisasiRekomendasi, spesialisasi))) {
      (kriteria.includes("Tidak Ada Sales") ? listingNoSalesRaw : listingSalesRaw).push(p);
    }
  }

  // Dedupe in the same priority order sections render (Pernah PSSP first, so
  // a name that qualifies for both "Pernah PSSP" and "Produk Kontes PM" keeps
  // its higher-priority slot and doesn't also duplicate into the next section).
  const pernahPsspSeen = new Set<string>();
  const pernahPssp = pernahPsspRaw
    .sort((a, b) => b.pct - a.pct)
    .filter(({ p }) => {
      const norm = p.namaProduk.toLowerCase().trim();
      if (pernahPsspSeen.has(norm)) return false;
      pernahPsspSeen.add(norm);
      seenNames.add(norm);
      return true;
    });
  const kontesPM = dedupeByNamaProduk(kontesPMRaw);
  const listingSales = dedupeByNamaProduk(listingSalesRaw);
  const listingNoSales = dedupeByNamaProduk(listingNoSalesRaw);

  // Order requested 2026-07-27: Pernah PSSP (sort pelunasan terbaik) -> Produk
  // Kontes PM -> Produk Survey, then the two Listing Corporate sections kept
  // after (not part of the requested 3, but not removed either).
  type Section = { title: string; color: keyof typeof TAG_COLORS; items: { key: string; label: string; added?: boolean; isKontes?: boolean; badge?: string; badgeColor?: keyof typeof TAG_COLORS; badge2?: string; badge2Color?: keyof typeof TAG_COLORS }[] };
  const allSections: Section[] = [
    {
      title: "Pernah PSSP", color: "green",
      items: pernahPssp.map(({ p, pct }) => ({
        key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk),
        badge: `${pct}%`, badgeColor: pct >= 80 ? "green" : pct >= 40 ? "yellow" : "red",
      })),
    },
    {
      // Merged with the old separate "Produk Kontes PM Belum Diajukan" panel
      // (2026-07-31 — they used to render as two same-titled sections, one
      // ✓-only, one enriched-but-missing-only) — every matched kontes product
      // now gets both: the ✓ if already added, AND the kriteria + Pernah PSSP
      // badges the "Belum Diajukan" version used to show (same source as the
      // product picker dropdown's own badges).
      title: "Produk Kontes PM", color: "blue",
      items: kontesPM.map((p) => {
        const kriteria = kriteriaMap.get(p.kodeProduk);
        const isStandarisasi = kriteria?.startsWith("Produk Sudah Terstandarisasi") ?? false;
        const kriteriaColor: keyof typeof TAG_COLORS | undefined = isStandarisasi
          ? (kriteria?.includes("Tidak Ada Sales") ? "yellow" : "orange")
          : kriteria?.startsWith("Produk Kompetisi Rendah") ? "blue"
          : kriteria?.startsWith("Produk Kompetisi Tinggi") ? "red"
          : undefined;
        const pelunasanAllPeriode = psspHistory ? computePelunasanAllPeriode(psspHistory, p.namaProduk) : null;
        return {
          key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk),
          badge: kriteria ? formatKriteriaLabel(kriteria) : undefined, badgeColor: kriteriaColor ?? "blue",
          badge2: pelunasanAllPeriode != null ? `Pernah PSSP · ${pelunasanAllPeriode}%` : undefined,
          badge2Color: pelunasanAllPeriode == null ? undefined : pelunasanAllPeriode >= 80 ? "green" : pelunasanAllPeriode >= 40 ? "yellow" : "red",
        };
      }),
    },
    {
      title: "Produk Survey", color: "orange",
      items: sortSurveyRows(surveyRows ?? []).map((r) => ({
        key: r.kodeProduk, label: r.namaProdukRekomendasi, added: addedKodeProduk.has(r.kodeProduk),
        isKontes: getAllPakets(r.namaProdukRekomendasi).length > 0,
        badge: r.potensiBulan != null ? `${r.potensiBulan}/bln` : undefined, badgeColor: "orange" as const,
      })),
    },
    { title: "Listing Corporate - Ada Sales", color: "orange", items: listingSales.map((p) => ({ key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk) })) },
    { title: "Listing Corporate - Tidak Ada Sales", color: "yellow", items: listingNoSales.map((p) => ({ key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk) })) },
  ];
  const sections = allSections.filter((s) => s.items.length > 0);

  if (sections.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada produk yang cocok kriteria untuk outlet/spesialisasi ini.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <div key={s.title}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TAG_COLORS[s.color].fg, marginBottom: 6 }}>
            {s.title} <span style={{ color: "var(--color-text-faint)", fontWeight: 600 }}>({s.items.length})</span>
          </p>
          <KriteriaSectionList items={s.items} />
        </div>
      ))}
    </div>
  );
}

// ─── SurveyDataPanel ──────────────────────────────────────────────────────────
// Every SurveyRekomendasi row for the currently-selected doctor+outlet — unlike
// the per-product "Potensi (survey)" hint in ProdukEntryRow, this shows the
// full set of recommended products (2026-07-24), each with its own competitor
// history and potential.

function SurveyDataPanel({ kodeCustomer, kodePI }: { kodeCustomer: string; kodePI?: string }) {
  const [rows, setRows] = useState<SurveyRekomendasiRow[] | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      if (!kodeCustomer || !kodePI) { setRows([]); return; }
      setRows(sortSurveyRows(await getSurveyRekomendasiByOutlet(kodeCustomer, kodePI)));
    });
  }, [kodeCustomer, kodePI]);

  if (loading || rows === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat data survey…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-xs px-3 py-2.5 rounded-lg space-y-1.5"
        style={{ color: "var(--color-red)", background: "var(--color-red-light)" }}>
        <p className="font-medium">⚠ Data survey tidak ada untuk dokter ini.</p>
        <Link href="/survey/upload" className="inline-block font-semibold underline">
          Upload data survey →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {rows.length} produk direkomendasikan survey untuk dokter ini.
      </p>
      {rows.map((r) => (
        <div key={r.kodeProduk} className="rounded-lg border px-3 py-2 space-y-1.5"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{r.namaProdukRekomendasi}</div>
          {r.potensiBulan != null && (
            <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Potensi: <strong style={{ color: "var(--color-text-muted)" }}>{r.potensiBulan}</strong> / bulan
            </div>
          )}
          {r.kompetitor.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {r.kompetitor.map((k, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                  {k.namaProduk}{k.pct > 0 ? ` (${k.pct}%)` : ""}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tidak ada kompetitor tercatat.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── PsspSidebar ─────────────────────────────────────────────────────────────
// Three independent fixed right-side panels — "Data Survey" (orange), "Produk
// Rekomendasi" (green, 2026-07-24, renamed from "Kriteria Produk" 2026-07-27 —
// Pernah PSSP / Produk Kontes PM / Produk Survey sections, plus the 2 Listing
// Corporate buckets kept after), and "Histori PSSP" (blue). Only one
// is open at a time: collapsed, all three show as a stacked set of thin vertical
// tabs; opening any fills the same 300px slot on the right and freezes on
// scroll (position:fixed). While open, a small pill switcher for ALL THREE tabs
// stays visible in the header (2026-07-24 UX fix — Data Survey defaulted to
// hidden behind Histori PSSP, opening first, with no clue it existed; the
// switcher makes every tab discoverable regardless of which is active).

const SIDEBAR_ORANGE = "var(--color-orange, #ea580c)";
const SIDEBAR_BLUE = "var(--color-blue)";
const SIDEBAR_GREEN = "var(--color-success, #16a34a)";

function sidebarEdgeTabStyle(color: string): React.CSSProperties {
  return {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "18px 10px", gap: 2,
    background: color,
    border: `1px solid ${color}`, borderRight: "none",
    borderRadius: "8px 0 0 8px",
    color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
    writingMode: "vertical-rl", letterSpacing: "0.05em",
  };
}

type SidebarTab = "survey" | "kriteria" | "pssp";

function SidebarTabSwitcher({ activeTab, onChange }: { activeTab: SidebarTab; onChange: (tab: SidebarTab) => void }) {
  function pillStyle(color: string, active: boolean): React.CSSProperties {
    return {
      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
      cursor: "pointer", letterSpacing: "0.01em", border: `1px solid ${color}`,
      background: active ? color : "transparent",
      color: active ? "#fff" : color,
    };
  }
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      <button type="button" onClick={() => onChange("survey")} style={pillStyle(SIDEBAR_ORANGE, activeTab === "survey")}>
        Data Survey
      </button>
      <button type="button" onClick={() => onChange("kriteria")} style={pillStyle(SIDEBAR_GREEN, activeTab === "kriteria")}>
        Produk Rekomendasi
      </button>
      <button type="button" onClick={() => onChange("pssp")} style={pillStyle(SIDEBAR_BLUE, activeTab === "pssp")}>
        Histori PSSP
      </button>
    </div>
  );
}

function PsspSidebar({
  kodeCustomer,
  kodePI,
  doctorName,
  onLabel,
  onHistory,
  spesialisasi,
  produkList,
  products,
  kriteriaList,
  psspHistory,
}: {
  kodeCustomer: string;
  /** Currently-selected outlet — narrows the Histori PSSP panel to contracts at this outlet. */
  kodePI?: string;
  doctorName?: string;
  onLabel?: (label: string) => void;
  onHistory?: (rows: PsspKontrakSummary[]) => void;
  spesialisasi?: string;
  produkList?: ProdukEntry[];
  products?: Product[];
  /** Forwarded into ProdukKontesPanel — same kriteria + PSSP badges as the product picker. */
  kriteriaList?: KriteriaByOutlet[];
  psspHistory?: PsspKontrakSummary[];
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>("pssp");
  const [label, setLabel] = useState("");

  function handleLabel(l: string) {
    setLabel(l);
    onLabel?.(l);
  }

  if (activeTab === null) {
    return (
      <div style={{ position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 40, display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" onClick={() => setActiveTab("survey")} style={sidebarEdgeTabStyle(SIDEBAR_ORANGE)}>
          Data Survey
        </button>
        <button type="button" onClick={() => setActiveTab("kriteria")} style={sidebarEdgeTabStyle(SIDEBAR_GREEN)}>
          Produk Rekomendasi
        </button>
        <button type="button" onClick={() => setActiveTab("pssp")} style={sidebarEdgeTabStyle(SIDEBAR_BLUE)}>
          Histori PSSP
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, zIndex: 40,
      width: 300,
      background: "var(--color-bg)",
      borderLeft: "1px solid var(--color-border)",
      display: "flex", flexDirection: "column",
      boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SidebarTabSwitcher activeTab={activeTab} onChange={setActiveTab} />
          {doctorName && (
            <p className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginTop: 1 }}>
              {doctorName}
            </p>
          )}
          {activeTab === "pssp" && label && <div style={{ marginTop: 4 }}><LabelCustomerBadge label={label} /></div>}
        </div>
        <button
          type="button"
          onClick={() => setActiveTab(null)}
          style={{ color: "var(--color-text-faint)", fontSize: 18, lineHeight: 1, padding: "0 2px", cursor: "pointer", flexShrink: 0 }}>
          ›
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-4">
        {activeTab === "survey" ? (
          <SurveyDataPanel kodeCustomer={kodeCustomer} kodePI={kodePI} />
        ) : activeTab === "kriteria" ? (
          // "Produk Kontes PM Belum Diajukan" merged into KriteriaProdukPanel's
          // own "Produk Kontes PM" section (2026-07-31 — the two used to render
          // as separate blocks with the same title, reading as a duplicate).
          // That section now covers every matched kontes product (not just the
          // missing ones) with a ✓ for already-added ones AND the kriteria +
          // Pernah PSSP badges the old "Belum Diajukan" panel used to show.
          <KriteriaProdukPanel kodeCustomer={kodeCustomer} kodePI={kodePI} spesialisasi={spesialisasi} produkList={produkList} products={products} kriteriaList={kriteriaList} psspHistory={psspHistory} />
        ) : (
          <>
            <PsspHistoryPanel kodeCustomer={kodeCustomer} kodePI={kodePI} doctorName={doctorName} onLabel={handleLabel} onHistory={onHistory} />
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
                Histori Listing Fee
              </p>
              <ListingFeeHistoryPanel kodeCustomer={kodeCustomer} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── AddPanel (new dokter + multi-produk) ─────────────────────────────────────

function AddPanel({
  poaId, poaPeriod, outlets, products, existingItems, onCancel, onSuccess, onToast,
}: {
  poaId: string; poaPeriod: string; outlets: OutletOption[]; products: Product[];
  /** Line items already in this POA draft — feeds the "dokter/produk lain di
   * outlet ini" info panel below (2026-08-10, item #7 dari daftar 13 task
   * baru: "informasi mengenai user-user dan produk-produk yang si MR sudah
   * buat dari outlet yang sama"). Optional so other callers of AddPanel
   * (formOnly mode from /poa/[id]/edit, which doesn't have the full item
   * list handy) don't have to thread it through just to keep compiling. */
  existingItems?: PoaLineItem[];
  onCancel?: () => void;
  onSuccess?: () => void;
  onToast?: (msg: string, type?: "success" | "error") => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerList, setCustomerList] = useState<CustomerOption[]>([]);
  const [psspStatusList, setPsspStatusList] = useState<PsspStatusByCustomer[]>([]);
  const [loadingSpec, startLoadSpec] = useTransition();
  const [loadingCust, startLoadCust] = useTransition();

  const [dokterFields, setDokterFields] = useState<DokterFields>(emptyDokterFields(""));
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);
  const [labelCustomer, setLabelCustomer] = useState("");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [psspEverProductNames, setPsspEverProductNames] = useState<Set<string>>(new Set());
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  // Draft autosave (2026-07-27 request: "kalau refresh, data yang sudah
  // diisi masih ada") — keyed per POA so switching between POAs never mixes
  // up drafts. Restored once on mount below, then kept in sync on every
  // change; cleared once the products are actually saved or the panel is
  // cancelled, so a stale draft doesn't reappear next time.
  const draftKey = `poa-draft-add-${poaId}`;
  const [draftLoaded, setDraftLoaded] = useState(false);
  // Guards against the debounced autosave effect below re-writing the draft
  // AFTER a successful save clears it — a pending 400ms debounce timer from
  // the user's last keystroke could still fire during the post-save 1200ms
  // toast/redirect delay, resurrecting the just-saved (and now redundant)
  // draft, which then showed a confusing "draft restored" toast on the next
  // load even though the save had already succeeded (2026-07-28 bug report).
  const savedRef = useRef(false);

  const outletOptions = useMemo(() => [...new Map(outlets.map((o) => [o.kodePI, o])).values()]
    .sort((a, b) => (isChainGroup(a.groupRS) ? 0 : 1) - (isChainGroup(b.groupRS) ? 0 : 1))
    .map((o) => ({
      value: o.kodePI,
      label: `${o.kodePI} - ${o.namaOutlet}`,
      sublabel: o.groupRS ?? "NON CHAIN",
    })), [outlets]);
  // Static list (independent of outlet, so it never comes up empty even
  // before any user is registered there), but
  // tagged with how many of this outlet's ALREADY-registered doctors fall
  // in each spesialisasi, so the MR can tell at a glance which one their
  // doctor is likely under (2026-07-24 request).
  const specOptions = useMemo(() => {
    const counts = new Map<string, number>(); // PM label -> count
    for (const c of customerList) {
      const label = spesLabel(c.spesialisasi);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return ALL_SPESIALISASI_OPTIONS.map((o) => {
      const n = counts.get(o.label) ?? 0;
      return { ...o, sublabel: n > 0 ? `${n} dokter terdaftar` : undefined, _count: n };
    }).sort((a, b) => b._count - a._count);
  }, [customerList]);
  // customerList holds every user at the outlet, any spesialisasi — narrowed
  // to the picked spesialisasi here only as a convenience filter, never a
  // hard requirement, so an MR who doesn't know the spesialisasi can just
  // search the user by name directly (2026-07-23; see handleCustomerChange,
  // which auto-fills spesialisasi from whichever user actually gets picked).
  const psspStatusByCust = useMemo(
    () => new Map(psspStatusList.map((s) => [s.kdCust, s])),
    [psspStatusList]
  );
  // Tags each option with PSSP status BEFORE the MR even picks anyone
  // (2026-07-24 request) — same pelunasan color thresholds as the product
  // picker's "Pernah PSSP" badge (buildProductOptions above), but sourced
  // from this doctor's own MOST RECENT contract rather than a 3-month window.
  const customerOptions = useMemo(() => {
    const quarterEndIndex = yyyymmIndex(currentQuarterMonths()[2]);
    return customerList
    .filter((c) => !spesialisasi || c.spesialisasi === spesialisasi)
    .map((c) => {
      const psspStatus = c.kodeCustomer ? psspStatusByCust.get(c.kodeCustomer) : undefined;
      const pct = psspStatus?.latestPelunasanPct ?? null;
      // Same Retensi rule as the "Retensi" badge on ContractCard above: contract
      // still active but ends within the quarter currently being worked on
      // (2026-07-27 request: flag this in the doctor dropdown too, not just the
      // Histori PSSP panel after picking someone).
      const isRetensi = !!psspStatus?.isActive && currentQuarterMonths().includes(psspStatus.latestPrdAkhir);
      // Retensi now its own solid/high-contrast badge (tag3) instead of a suffix
      // baked into tag2's text — it used to blend into the pelunasan pill and
      // was easy to miss (2026-07-27 request: separate it out, more contrast).
      const tag2 = psspStatus
        ? (pct != null ? `Pernah PSSP · Pelunasan Terakhir ${Math.round(pct)}%` : "Pernah PSSP")
        : undefined;
      const tag2Color: "green" | "yellow" | "red" | undefined = pct == null ? undefined
        : pct >= 80 ? "green"
        : pct >= 40 ? "yellow"
        : "red";
      const tag3 = isRetensi ? "Retensi" : undefined;
      const tag3Color = "orange" as const;
      // Distance (in months) from this doctor's most recent PSSP end-period to the
      // end of the quarter currently being worked on — smaller means more urgent to
      // act on (about to lapse this quarter, or just lapsed near it).
      const prdAkhirDist = psspStatus ? Math.abs(yyyymmIndex(psspStatus.latestPrdAkhir) - quarterEndIndex) : null;
      // Periode PSSP terakhir shown regardless of Berjalan/Selesai (2026-07-27
      // request) — same raw YYYYMM range convention as ContractCard above.
      // "ke-N" prefix (2026-07-28 request) mirrors the sidebar's per-contract
      // "PSSP ke-N" badge, so this doctor's contract sequence is visible
      // before even opening the sidebar.
      const psspPeriodLabel = psspStatus
        ? `PSSP ke-${psspStatus.psspKe} ${psspStatus.latestPrdAwal}-${psspStatus.latestPrdAkhir} (${psspStatus.isActive ? "Berjalan" : "Selesai"})`
        : null;
      return {
        value: c.id, label: c.namaCustomer,
        sublabel: [
          spesLabel(c.spesialisasi),
          c.isFokus ? "⭐ Rekomendasi PM" : null,
          psspPeriodLabel,
        ].filter(Boolean).join(" · "),
        tag2, tag2Color, tag3, tag3Color, _pct: pct, _prdAkhirDist: prdAkhirDist,
      };
      // Sorted by proximity of PSSP end-period to the current quarter's end first
      // (2026-07-27 request) — doctors whose contract is closest to lapsing this
      // quarter surface first so retention gets prioritized; best-pelunasan-first
      // (2026-07-24) is kept as the tiebreaker. Doctors who never had a PSSP (both
      // null) have nothing to rank, so they sink to the bottom.
    }).sort((a, b) => {
      if (a._prdAkhirDist == null && b._prdAkhirDist == null) return (b._pct ?? -1) - (a._pct ?? -1);
      if (a._prdAkhirDist == null) return 1;
      if (b._prdAkhirDist == null) return -1;
      if (a._prdAkhirDist !== b._prdAkhirDist) return a._prdAkhirDist - b._prdAkhirDist;
      return (b._pct ?? -1) - (a._pct ?? -1);
    });
  }, [customerList, spesialisasi, psspStatusByCust]);

  const selectedCustomer = useMemo(() => customerList.find((c) => c.id === customerId) ?? null, [customerList, customerId]);

  // Dokter & produk lain yang sudah ada di POA draft ini untuk outlet yang
  // sama (2026-08-10, item #7) — bukan SUM angka, murni daftar referensi
  // supaya MR bisa lihat sekilas apa yang sudah direncanakan di outlet ini
  // sebelum menambah dokter/produk baru. Dokter yang sedang dipilih sekarang
  // (selectedCustomer) sengaja dikeluarkan — tidak berguna melihat diri
  // sendiri di daftar "dokter lain".
  const otherDoctorsAtOutlet = useMemo(() => {
    if (!kodePI || !existingItems) return [];
    const byDoctor = new Map<string, { namaCust: string; produk: Set<string> }>();
    for (const item of existingItems) {
      if (item.kodePI !== kodePI) continue;
      if (selectedCustomer && item.namaCust === selectedCustomer.namaCustomer) continue;
      const entry = byDoctor.get(item.namaCust) ?? { namaCust: item.namaCust, produk: new Set<string>() };
      entry.produk.add(item.namaProduk);
      byDoctor.set(item.namaCust, entry);
    }
    return [...byDoctor.values()].sort((a, b) => a.namaCust.localeCompare(b.namaCust));
  }, [kodePI, existingItems, selectedCustomer]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  // Same "Estimasi & Nilai PSSP per Bulan" table as Ringkasan POA
  // (DraftChecklist.tsx) — built from the in-progress form state (not yet
  // saved PoaLineItem rows) since this panel is for adding a new doctor's
  // rencana, spread across periodeAwal..periodeAwal+lamaPeriode-1 the same
  // way computeMonthlyBreakdown works off saved rows. persenPsspDokter is
  // entered as 0-100 in this form but computeMonthlyBreakdown expects the
  // 0-1 fraction actually stored in the DB (see addLineItemAction's
  // parsePct) — divided by 100 here to match.
  const pengaliNilaiRResolved = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
  const monthlyBreakdown = useMemo(() => computeMonthlyBreakdown(
    produkList.filter((e) => !!e.kodeProduk).map((e) => {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      return {
        rencanaTotalBiaya: computeEstimasi(e, dokterFields, p),
        persenPsspDokter: (parseFloat(e.persenPsspDokter) || 0) / 100,
        pengaliNilaiR: pengaliNilaiRResolved,
        periodeAwal: dokterFields.periodeAwal,
        lamaPeriode: dokterFields.lamaPeriode,
      };
    })
  ), [produkList, dokterFields, products, pengaliNilaiRResolved]);
  const monthlyBreakdownSorted = [...monthlyBreakdown.keys()].sort();
  const monthlyBreakdownTotal = [...monthlyBreakdown.values()].reduce(
    (acc, v) => ({ estimasi: acc.estimasi + v.estimasi, nilaiPssp: acc.nilaiPssp + v.nilaiPssp }),
    { estimasi: 0, nilaiPssp: 0 }
  );

  const matchedPaketsForKontes = useMemo(
    () => spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [],
    [spesialisasi]
  );

  // Same total, filtered to products that are tier-0 (kontes) for this doctor's spesialisasi.
  const totalEstimasiKontes = useMemo(() => {
    if (matchedPaketsForKontes.length === 0) return { total: 0, count: 0 };
    let total = 0, count = 0;
    for (const e of produkList) {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      if (!p || getProductTier(p.namaProduk, matchedPaketsForKontes) !== 0) continue;
      total += computeEstimasi(e, dokterFields, p);
      count++;
    }
    return { total, count };
  }, [produkList, dokterFields, products, matchedPaketsForKontes]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
      const pct = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR
        + [entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
          .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
      budgetWeighted += base * pct;
      estTotal += base;
    }
    return estTotal > 0 ? budgetWeighted / estTotal : null;
  }, [produkList, dokterFields, products]);

  // Just the data-fetching side of picking an outlet — split out from
  // handleOutletChange so restoring a saved draft (below) can re-trigger these
  // fetches for the restored kodePI WITHOUT also wiping the restored
  // spesialisasi/customerId the way an interactive outlet change should.
  function fetchOutletData(val: string) {
    if (!val) return;
    startLoadSpec(async () => {
      const [kriteria, psspProductNames, diskonData, diskonHistoryData] = await Promise.all([
        getKriteriaByOutlet(val),
        getPsspProductNamesByOutlet(val),
        getDiskonByOutlet(val),
        getDiskonHistoryByOutlet(val),
      ]);
      setKriteriaList(kriteria);
      setPsspEverProductNames(new Set(psspProductNames.map((n) => n.toLowerCase().trim())));
      setDiskonList(diskonData);
      setDiskonHistoryList(diskonHistoryData);
    });
    startLoadCust(async () => setCustomerList(await getCustomersByOutlet(val)));
    getPsspStatusByOutlet(val).then(setPsspStatusList);
  }

  function handleOutletChange(val: string) {
    setKodePI(val); setSpesialisasi(""); setCustomerId("");
    setCustomerList([]); setKriteriaList([]); setPsspEverProductNames(new Set()); setDiskonList([]); setDiskonHistoryList([]); setPsspStatusList([]);
    fetchOutletData(val);
  }

  // Picking a user directly (search-by-name) is now the primary path — this
  // auto-fills spesialisasi from that user's own record instead of requiring
  // it to be picked first just to unlock the customer search.
  //
  // A "nexus:"-prefixed id is a live Nexus-API result with no local Customer
  // row yet (see getCustomersByOutlet) — needs materializing into a real row
  // via createCustomerAction before addLineItemAction can use it. Cached
  // here (not just read off customerList) because customerList's own entry
  // gets its id swapped in place once resolved, so a second lookup by the
  // original nexus id would otherwise come up empty.
  const nexusPickCache = useRef(new Map<string, { namaCustomer: string; spesialisasi: string; kodeCustomer: string | null }>());

  // Resolves a "nexus:" placeholder to a real Customer.id — reused both
  // right after picking (so it's usually already resolved by the time the
  // MR finishes filling the rest of the form) and again at submit time as a
  // fallback (2026-07-29 request: "biar langsung bisa simpan saja tanpa
  // harus ada menunggu" — Simpan itself now absorbs this wait via its own
  // "Menyimpan…" pending state instead of a separate blocking step). Never
  // throws — any failure just returns null, callers decide how to react.
  async function resolveNexusCustomer(nexusId: string): Promise<string | null> {
    const found = nexusPickCache.current.get(nexusId);
    if (!found) return null;
    try {
      const fd = new FormData();
      fd.set("namaCustomer", found.namaCustomer);
      fd.set("spesialisasi", found.spesialisasi);
      fd.set("kodePI", kodePI);
      fd.set("kodeCustomer", found.kodeCustomer ?? "");
      const result = await createCustomerAction(fd);
      if (result.ok && result.customerId) {
        const realId = result.customerId;
        setCustomerList((prev) => prev.map((c) => (c.id === nexusId ? { ...c, id: realId } : c)));
        return realId;
      }
      // Most likely: it was materialized locally a moment ago (race) or
      // already existed under a name/spesialisasi combo our dedup missed —
      // either way, re-fetch and match by name+spesialisasi to recover the
      // real id instead of leaving a synthetic, unusable one selected.
      const refreshed = await getCustomersByOutlet(kodePI);
      const real = refreshed.find((c) => !c.id.startsWith("nexus:")
        && c.namaCustomer === found.namaCustomer && c.spesialisasi === found.spesialisasi);
      setCustomerList(refreshed);
      return real?.id ?? null;
    } catch {
      return null;
    }
  }

  async function handleCustomerChange(val: string) {
    const found = customerList.find((c) => c.id === val);
    if (!found) { setCustomerId(val); return; }

    if (val.startsWith("nexus:")) {
      nexusPickCache.current.set(val, { namaCustomer: found.namaCustomer, spesialisasi: found.spesialisasi, kodeCustomer: found.kodeCustomer });
      setCustomerId(val);
      setSpesialisasi(found.spesialisasi);
      // Best-effort background resolve — NOT awaited by Submit; if it's
      // still mid-flight (or was never triggered, e.g. a restored draft)
      // when the MR clicks Simpan, handleSubmit resolves it again itself.
      const realId = await resolveNexusCustomer(val);
      // Only apply if the selection hasn't moved on to something else while
      // this was resolving (e.g. the MR picked a different doctor meanwhile).
      setCustomerId((cur) => (cur === val ? (realId ?? cur) : cur));
      return;
    }

    setCustomerId(val);
    setSpesialisasi(found.spesialisasi);
  }

  // Now just a narrowing filter on the already-loaded outlet customer list
  // (see handleOutletChange) — no longer a prerequisite the customer search
  // is gated behind. Only clears the current pick if it no longer matches.
  function handleSpecChange(val: string) {
    setSpesialisasi(val);
    setCustomerId((prev) => {
      const stillMatches = customerList.find((c) => c.id === prev)?.spesialisasi === val;
      return stillMatches ? prev : "";
    });
  }

  function updateProduk(idx: number, patch: Partial<ProdukEntry>) {
    setProdukList((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  function clearDraft() {
    // Once cleared, never let the debounced autosave effect below write it
    // back — see savedRef doc comment above.
    savedRef.current = true;
    try { localStorage.removeItem(draftKey); } catch { /* storage unavailable - nothing to clear anyway */ }
  }

  // Restore once on mount — re-triggers the same outlet-data fetch
  // handleOutletChange would (kriteria/diskon/customerList/psspStatusList),
  // but WITHOUT its reset-downstream-fields behavior, since here
  // spesialisasi/customerId need to come back too, not get wiped.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          kodePI?: string; spesialisasi?: string; customerId?: string;
          dokterFields?: DokterFields; produkList?: ProdukEntry[];
        };
        if (draft.kodePI) { setKodePI(draft.kodePI); fetchOutletData(draft.kodePI); }
        if (draft.spesialisasi) setSpesialisasi(draft.spesialisasi);
        // A "nexus:"-prefixed customerId is a live Nexus-API result never
        // materialized into a real Customer row (see handleCustomerChange) —
        // restoring it as-is submits an id the server can't find, silently
        // failing every product in the batch with "Customer tidak
        // ditemukan." (2026-07-29 bug report). Drop it instead — safer to
        // make the MR re-pick the customer than resubmit a dead reference.
        if (draft.customerId && !draft.customerId.startsWith("nexus:")) setCustomerId(draft.customerId);
        if (draft.dokterFields) setDokterFields(draft.dokterFields);
        if (draft.produkList && draft.produkList.length > 0) setProdukList(draft.produkList);
        if (draft.kodePI || draft.produkList?.some((p) => p.kodeProduk)) {
          onToast?.("Draft rencana POA yang belum disimpan berhasil dipulihkan.", "success");
        }
      }
    } catch {
      // Corrupt/unreadable draft — ignore and start fresh rather than crash the panel.
    }
    setDraftLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in sync with every change, debounced — skipped until the
  // restore above has run once, so it can't race and overwrite a not-yet-
  // loaded draft with the panel's still-blank initial state.
  useEffect(() => {
    if (!draftLoaded) return;
    const hasContent = !!kodePI || !!customerId
      || produkList.some((p) => p.kodeProduk || p.jumlahResepHari || p.qtyProdukResep);
    const t = setTimeout(() => {
      if (savedRef.current) return;
      try {
        if (!hasContent) { localStorage.removeItem(draftKey); return; }
        // Never persist a "nexus:"-prefixed customerId — it's a transient
        // live-search result mid-materialization (handleCustomerChange),
        // not a stable id that's still valid on restore. See restore-effect
        // comment above for the failure this caused.
        const safeCustomerId = customerId.startsWith("nexus:") ? "" : customerId;
        localStorage.setItem(draftKey, JSON.stringify({ kodePI, spesialisasi, customerId: safeCustomerId, dokterFields, produkList }));
      } catch {
        // Storage full/unavailable — draft-saving is a convenience, not critical, so just skip.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draftLoaded, draftKey, kodePI, spesialisasi, customerId, dokterFields, produkList]);

  function buildFormData(entry: ProdukEntry, customerIdOverride?: string): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    fd.set("customerId", customerIdOverride ?? customerId);
    fd.set("kodePI", kodePI);
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", entry.hariKerjaBulan || dokterFields.hariKerjaBulan);

    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("surveyPasienHarian", dokterFields.surveyPasienHarian);
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", dokterFields.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("bentukPssp", dokterFields.bentukPssp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", dokterFields.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst.perBulan > 0 ? perBulan / oldEst.perBulan : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasErrors = !kodePI || !spesialisasi || !customerId || !dokterFields.periodeAwal
      || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12
      || !dokterFields.surveyPasienHarian
      || !dokterFields.jenisPsSp || !dokterFields.bentukPssp
      || produkList.some((p) => !p.kodeProduk || !p.jumlahResepHari || !p.qtyProdukResep || !p.produkKompetitor);
    if (hasErrors) {
      setAttempted(true);
      setTimeout(() => {
        const el = document.querySelector("[data-field-err]");
        (el as HTMLElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    setError(null);
    setProgress({ done: 0, total: validEntries.length });
    startTransition(async () => {
      // Local counter (not React state — needs to be readable synchronously
      // in the catch block below, unlike setProgress's async state update).
      let savedCount = 0;
      try {
        // A "nexus:"-prefixed customerId means the background materialize
        // from handleCustomerChange hasn't finished (or was never
        // triggered, e.g. a restored draft) — resolve it here as part of
        // Simpan's own "Menyimpan…" pending state instead of a separate
        // blocking step before the MR is even allowed to click Simpan
        // (2026-07-29 request: "biar langsung bisa simpan saja tanpa harus
        // ada menunggu"). Passed explicitly into buildFormData below since
        // setCustomerId here wouldn't be visible yet inside this same
        // closure (state updates aren't synchronous).
        let resolvedCustomerId = customerId;
        if (resolvedCustomerId.startsWith("nexus:")) {
          const realId = await resolveNexusCustomer(resolvedCustomerId);
          if (!realId) {
            setError("Gagal memproses data user ini. Coba pilih ulang usernya lalu Simpan lagi.");
            setProgress(null);
            return;
          }
          resolvedCustomerId = realId;
          setCustomerId(realId);
        }
        for (let i = 0; i < validEntries.length; i++) {
          await addLineItemAction(poaId, buildFormData(validEntries[i], resolvedCustomerId));
          savedCount++;
          setProgress({ done: savedCount, total: validEntries.length });
        }
        setProgress(null);
        clearDraft();
        onToast?.(`${validEntries.length} produk berhasil disimpan.`, "success");
        setTimeout(() => {
          if (onSuccess) onSuccess(); else window.location.reload();
        }, 1200);
      } catch (err) {
        // A product partway through the loop can fail (e.g. hits "produk
        // sudah ada untuk dokter ini") AFTER earlier ones in the same
        // submission already saved successfully. Since clearDraft() above
        // only runs once the WHOLE loop finishes, the stale draft — still
        // listing every product, including the ones already in the DB —
        // was left behind and then wrongly "restored" on the next load,
        // reading as a successful save that silently reverted (2026-07-28
        // bug report, e.g. kode customer F1028209). Clear it here too
        // whenever at least one product got through, so a partial failure
        // doesn't leave a misleading full-list draft around.
        if (savedCount > 0) clearDraft();
        // redirect() inside the server action (validation failures, auth checks) works by
        // throwing — must re-throw so Next.js's own router handles it, not shown as an error.
        if (isRedirectError(err)) throw err;
        setError(
          (savedCount > 0 ? `${savedCount} dari ${validEntries.length} produk berhasil disimpan sebelum error. ` : "") +
          (err instanceof Error ? err.message : "Gagal menyimpan.")
        );
        setProgress(null);
      }
    });
  }

  const filledCount = produkList.filter((e) => !!e.kodeProduk).length;

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 1.5 }}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Rencana POA</p>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Outlet & Dokter cascade */}
        <div>
          <SectionLabel>Outlet &amp; User</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1"
              {...(attempted && !kodePI ? { "data-field-err": "true" } : {})}>
              <span className="text-xs" style={{ color: attempted && !kodePI ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Outlet<Req />
              </span>
              <div style={attempted && !kodePI ? ERR_RING : undefined}>
                <Combobox name="_outlet" value={kodePI} onChange={handleOutletChange}
                  placeholder="Cari outlet…" options={outletOptions} />
              </div>
              {attempted && !kodePI && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            </div>
            <div className="flex flex-col gap-1"
              {...(attempted && !spesialisasi ? { "data-field-err": "true" } : {})}>
              <span className="text-xs" style={{ color: attempted && !spesialisasi ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Spesialisasi<Req />
              </span>
              <div style={attempted && !spesialisasi ? ERR_RING : undefined}>
                <Combobox name="_spesialisasi" value={spesialisasi} onChange={handleSpecChange}
                  placeholder={kodePI ? "Pilih spesialisasi" : "Pilih outlet dulu"}
                  disabled={!kodePI} options={specOptions} />
              </div>
              {attempted && !spesialisasi && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            </div>
            <div className="flex flex-col gap-1"
              {...(attempted && !customerId ? { "data-field-err": "true" } : {})}>
              <span className="text-xs" style={{ color: attempted && !customerId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                User<Req /> {loadingCust && <span style={{ color: "var(--color-text-faint)" }}>…</span>}
              </span>
              <div style={attempted && !customerId ? ERR_RING : undefined}>
                <Combobox name="_dokter" value={customerId} onChange={handleCustomerChange}
                  placeholder={kodePI ? (loadingCust ? "Memuat…" : "Cari nama user…") : "Pilih outlet dulu"}
                  disabled={!kodePI || loadingCust} options={customerOptions} />
              </div>
              {attempted && !customerId && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
              {!spesialisasi && kodePI && !loadingCust && (
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  Belum tau spesialisasinya? Langsung cari nama user aja - spesialisasi keisi otomatis.
                </span>
              )}
            </div>
          </div>
          {selectedCustomer && (
            <>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 items-center rounded-lg px-3 py-2 text-xs"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                {selectedCustomer.kodeCustomer && (
                  <span><span style={{ color: "var(--color-text-faint)" }}>Kode Customer:</span> {selectedCustomer.kodeCustomer}</span>
                )}
                <span><span style={{ color: "var(--color-text-faint)" }}>Spesialisasi:</span> {spesLabel(selectedCustomer.spesialisasi)}</span>
                {(() => {
                  const psspStatus = selectedCustomer.kodeCustomer ? psspStatusByCust.get(selectedCustomer.kodeCustomer) : undefined;
                  if (!psspStatus) return null;
                  return (
                    <span>
                      <span style={{ color: "var(--color-text-faint)" }}>PSSP:</span>{" "}
                      PSSP ke-{psspStatus.psspKe} · {psspStatus.latestPrdAwal}-{psspStatus.latestPrdAkhir} ({psspStatus.isActive ? "Berjalan" : "Selesai"})
                    </span>
                  );
                })()}
                {selectedCustomer.isFokus && <span style={{ color: "var(--color-blue)" }}>⭐ Rekomendasi PM</span>}
                {labelCustomer && <LabelCustomerBadge label={labelCustomer} />}
              </div>
            </>
          )}
        </div>

        {/* Dokter & produk lain di outlet yang sama (2026-08-10, item #7) —
            info kecil, bukan wajib diisi, murni referensi supaya MR tidak
            duplikat/kelupaan produk untuk outlet yang sama. */}
        {kodePI && otherDoctorsAtOutlet.length > 0 && (
          <div className="rounded-lg px-3 py-2.5 text-xs space-y-1.5"
            style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
            <p className="font-medium" style={{ color: "var(--color-text-muted)" }}>
              {otherDoctorsAtOutlet.length} user lain di outlet ini sudah ada di draft POA ini:
            </p>
            <ul className="space-y-1">
              {otherDoctorsAtOutlet.map((d) => (
                <li key={d.namaCust} style={{ color: "var(--color-text-faint)" }}>
                  <span style={{ color: "var(--color-text)" }}>{d.namaCust}</span>
                  {" — "}{[...d.produk].join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Rencana per dokter */}
        <DokterFieldsSection
          fields={dokterFields}
          onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          poaPeriod={poaPeriod}
          periodeAwalError={attempted && !dokterFields.periodeAwal}
          hariKerjaBulanError={attempted && !dokterFields.hariKerjaBulan}
          surveyPasienHarianError={attempted && !dokterFields.surveyPasienHarian}
          lamaPeriodeRequiredError={attempted && !dokterFields.lamaPeriode}
          jenisPsSpError={attempted && !dokterFields.jenisPsSp}
          bentukPsspError={attempted && !dokterFields.bentukPssp}
          kodeCustomer={selectedCustomer?.kodeCustomer ?? undefined}
          kodePI={kodePI || undefined}
        />

        {/* Products */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★</span> = Produk Kontes
            </span>
          </div>
          <div className="space-y-2">
            {produkList.map((entry, i) => (
              <ProdukEntryRow
                key={entry.uid}
                index={i}
                entry={entry}
                products={products}
                dokterFields={dokterFields}
                spesialisasi={spesialisasi || undefined}
                psspHistory={psspHistory ?? undefined}
                kriteriaList={kriteriaList}
                psspEverProductNames={psspEverProductNames}
                diskonList={diskonList}
                diskonHistoryList={diskonHistoryList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
                kodeCustomer={selectedCustomer?.kodeCustomer}
                kodePI={kodePI}
                onChange={(patch) => updateProduk(i, patch)}
                onRemove={() => setProdukList((prev) => prev.filter((_, idx) => idx !== i))}
                showRemove={produkList.length > 1}
                showError={attempted}
              />
            ))}
            <button type="button"
              onClick={() => setProdukList((prev) => [...prev, emptyProdukEntry()])}
              className="text-sm font-medium px-3 py-2 rounded-lg w-full border-2 border-dashed transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)]">
              + Tambah Produk Lagi
            </button>
          </div>
        </div>

        {/* Total summary + pengali */}
        {filledCount > 0 && totalEstimasi > 0 && (() => {
          const lama = dokterFields.lamaPeriode || 1;
          const newPerMonth = totalEstimasi / lama;
          // Aggregate Growth Estimasi across all filled products (2026-07-27: kept
          // as a headline total alongside the per-product breakdown table below —
          // "growth estimasi total semua produk nya tetap ada").
          let totalOldEstPerMonth = 0; let hasOldEst = false;
          for (const entry of produkList) {
            if (!entry.kodeProduk || !psspHistory || psspHistory.length === 0) continue;
            const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
            if (!p) continue;
            const old = computeLatestEstPerMonth(psspHistory, p.namaProduk);
            if (old == null) continue;
            totalOldEstPerMonth += old.perBulan; hasOldEst = true;
          }
          const growthEstimasiTotalPct = hasOldEst && totalOldEstPerMonth > 0
            ? (newPerMonth / totalOldEstPerMonth - 1) * 100 : null;
          return (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Total Semua Produk
              </p>
              {/* Pengali Nilai R (2026-07-28 request: moved down here, out of the
                  fields at the top of the form) — customer-level, shared across
                  every product for this doctor. */}
              <label className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R</span>
                <div style={{ width: 110 }}>
                  <UnitInput
                    value={dokterFields.pengaliNilaiR}
                    onChange={(v) => setDokterFields((prev) => ({ ...prev, pengaliNilaiR: v }))}
                    unit="x"
                    placeholder="1"
                    step={0.1} />
                </div>
              </label>
            </div>
            <div className="flex gap-6 flex-wrap items-start">
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Estimasi Sales</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{formatRp(totalEstimasi)}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{formatRp(Math.round(newPerMonth))}/bln</div>
              </div>
              {totalEstimasiKontes.count > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Produk Kontes</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalEstimasiKontes.total)}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{totalEstimasiKontes.count} produk kontes</div>
                </div>
              )}
              {totalNilaiPSSP > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Nilai PSSP</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalNilaiPSSP)}</div>
                </div>
              )}
              {totalPctBudget != null && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total % Budget</div>
                  <div className="text-xl font-bold"
                    style={{ color: totalPctBudget > 42.5 ? "var(--color-red)" : "var(--color-text)" }}>
                    {totalPctBudget.toFixed(2)}%
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: totalPctBudget > 42.5 ? "var(--color-red)" : "var(--color-success, #16a34a)" }}>
                    {totalPctBudget > 42.5 ? "⚠ OVER BUDGET" : "✓ SAFE"}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Growth Estimasi</div>
                {growthEstimasiTotalPct != null ? (
                  <>
                    <div className="text-xl font-bold"
                      style={{ color: growthEstimasiTotalPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      {growthEstimasiTotalPct >= 0 ? "+" : ""}{growthEstimasiTotalPct.toFixed(1)}%
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      PSSP lama {formatRp(Math.round(totalOldEstPerMonth))}/bln
                    </div>
                    <p className="text-xs font-semibold mt-1 max-w-[14rem]"
                      style={{ color: growthEstimasiTotalPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                      {growthEstimasiTotalPct > 0
                        ? "✓ Estimasi sudah menunjukkan intensifikasi - pastikan nilainya sudah tepat"
                        : "⚠ Estimasi belum menunjukkan intensifikasi dibanding PSSP sebelumnya"}
                    </p>
                  </>
                ) : (
                  <div className="text-sm mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                    {psspHistory === null ? "Memuat…" : psspHistory.length === 0 ? "Tidak ada histori PSSP" : "Belum ada data PSSP"}
                  </div>
                )}
              </div>
            </div>
            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-faint)" }}>
                Estimasi Qty & Growth vs PSSP per Produk {matchedPaketsForKontes.length > 0 && "(★ = Produk Kontes)"}
              </p>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--color-text-faint)" }}>
                    <th className="text-left font-medium pb-1">Produk</th>
                    <th className="text-right font-medium pb-1">Qty</th>
                    <th className="text-right font-medium pb-1">Estimasi</th>
                    <th className="text-right font-medium pb-1">Nilai PSSP</th>
                    <th className="text-right font-medium pb-1">% Budget</th>
                    <th className="text-right font-medium pb-1">Growth Estimasi</th>
                    <th className="text-right font-medium pb-1">Growth Pelunasan</th>
                    <th className="text-right font-medium pb-1">Standarisasi</th>
                  </tr>
                </thead>
                <tbody>
                  {produkList.filter((e) => !!e.kodeProduk).map((entry) => {
                    const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
                    if (!p) return null;
                    const qtyTotalUB = Math.round(qtyToUB(computeQtyTotal(entry, dokterFields), p));
                    const isKontes = getProductTier(p.namaProduk, matchedPaketsForKontes) === 0;
                    const estimasiTotal = computeEstimasi(entry, dokterFields, p);
                    const nilaiRPersen = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
                    const pengaliNilaiRProduk = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
                    const nilaiPSSP = nilaiRPersen != null
                      ? Math.round(estimasiTotal * nilaiRPersen * pengaliNilaiRProduk)
                      : null;
                    // % Budget per produk (2026-07-28 request) — same formula as
                    // totalPctBudget's per-entry weight above, just shown per row
                    // instead of only as one blended total.
                    const pctBudgetProduk = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiRProduk
                      + [entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
                        .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
                    // Per-product Growth Estimasi/Pelunasan — same formulas as the
                    // per-product calculator card above (ProdukEntryRow), just
                    // re-derived here since this table works off the whole
                    // produkList rather than one row's own local state.
                    const perBulanProduk = lama > 0 ? estimasiTotal / lama : 0;
                    const oldEstProduk = (psspHistory && psspHistory.length > 0)
                      ? computeLatestEstPerMonth(psspHistory, p.namaProduk) : null;
                    const growthEstimasiPct = (perBulanProduk > 0 && oldEstProduk != null && oldEstProduk.perBulan > 0)
                      ? (perBulanProduk / oldEstProduk.perBulan - 1) * 100 : null;
                    const pelunasanProduk = (psspHistory && psspHistory.length > 0)
                      ? computePelunasanAktualPerMonth(psspHistory, p.namaProduk) : null;
                    const growthPelunasanPct = (perBulanProduk > 0 && pelunasanProduk != null && pelunasanProduk.perBulan > 0)
                      ? (perBulanProduk / pelunasanProduk.perBulan - 1) * 100 : null;
                    return (
                      <tr key={entry.uid} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="py-1 pr-2 truncate" style={{ color: "var(--color-text-muted)" }}>
                          {isKontes && <span style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★ </span>}
                          {p.namaProduk}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {qtyTotalUB > 0 ? `${qtyTotalUB.toLocaleString("id-ID")} ${satuanLabel(p)}` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {estimasiTotal > 0 ? formatRp(estimasiTotal) : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {nilaiPSSP != null && nilaiPSSP > 0 ? formatRp(nilaiPSSP) : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: pctBudgetProduk > 42.5 ? "var(--color-red)" : "var(--color-text-faint)" }}>
                          {pctBudgetProduk > 0 ? `${pctBudgetProduk.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          title={growthEstimasiPct == null ? undefined : oldEstProduk
                            ? `vs PSSP periode ${oldEstProduk.period}${growthEstimasiPct > 0
                              ? " — sudah menunjukkan intensifikasi, pastikan nilainya sudah tepat"
                              : " — intensifikasi kurang, belum naik dibanding periode ini"}`
                            : undefined}
                          style={{ color: growthEstimasiPct == null ? "var(--color-text-faint)" : growthEstimasiPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthEstimasiPct != null ? `${growthEstimasiPct >= 0 ? "+" : ""}${growthEstimasiPct.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          title={growthPelunasanPct == null ? undefined : pelunasanProduk
                            ? `vs PSSP periode ${pelunasanProduk.period}${growthPelunasanPct > 0
                              ? " — sudah menunjukkan intensifikasi"
                              : " — intensifikasi kurang, belum naik dibanding periode ini"}`
                            : undefined}
                          style={{ color: growthPelunasanPct == null ? "var(--color-text-faint)" : growthPelunasanPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthPelunasanPct != null ? `${growthPelunasanPct >= 0 ? "+" : ""}${growthPelunasanPct.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right">
                          <StandarisasiIndicator entries={[entry]} compact />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
        })()}

        {/* Estimasi & Nilai PSSP per Bulan — same table as "Ringkasan POA"
            (DraftChecklist.tsx), shown here too so the monthly spread is
            visible before Simpan instead of only after the POA is saved
            (2026-08-08 request). Wrapped in its own outlined card (2026-08-08
            follow-up: "kurang rapih, kasih outline juga") to match the visual
            weight of "Total Semua Produk" above it, instead of a bare table
            floating in the form. */}
        {monthlyBreakdownSorted.length > 0 && (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Estimasi & Nilai PSSP per Bulan
            </p>
            <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
                    <th className="text-left font-medium px-3 py-1.5">Bulan</th>
                    <th className="text-right font-medium px-3 py-1.5">Estimasi</th>
                    <th className="text-right font-medium px-3 py-1.5">Nilai PSSP</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyBreakdownSorted.map((m) => {
                    const v = monthlyBreakdown.get(m)!;
                    return (
                      <tr key={m} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="px-3 py-1.5" style={{ color: "var(--color-text-muted)" }}>{formatPeriode(m)}</td>
                        <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{v.estimasi > 0 ? formatRp(v.estimasi) : "-"}</td>
                        <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{v.nilaiPssp > 0 ? formatRp(v.nilaiPssp) : "-"}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 600 }}>
                    <td className="px-3 py-1.5" style={{ color: "var(--color-text)" }}>Total</td>
                    <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{formatRp(monthlyBreakdownTotal.estimasi)}</td>
                    <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{formatRp(monthlyBreakdownTotal.nilaiPssp)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1" style={{ marginTop: "2rem" }}>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { clearDraft(); onCancel(); }}>Batal</Button>
          )}
        </div>
      </form>
      {selectedCustomer && (
        <PsspSidebar
          kodeCustomer={selectedCustomer.kodeCustomer ?? ""}
          kodePI={kodePI}
          doctorName={selectedCustomer.namaCustomer}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
          kriteriaList={kriteriaList}
          psspHistory={psspHistory ?? undefined}
        />
      )}
    </div>
  );
}

// ─── AddProductPanel (tambah produk ke dokter existing) ───────────────────────

function AddProductPanel({
  poaId, poaPeriod, products, kodePI, namaOutlet, kodeCust, namaCust, spesialisasi, defaultPeriode, existingPengaliNilaiR, existingPihakPssp, existingSurveyPasienHarian, onCancel,
}: {
  poaId: string; poaPeriod: string; products: Product[];
  kodePI: string; namaOutlet: string;
  kodeCust: string | null; namaCust: string; spesialisasi: string;
  defaultPeriode: string;
  /** This doctor's existing (shared) Pengali Nilai R — the new product must
   * join it, not diverge on its own. */
  existingPengaliNilaiR: string;
  /** Same idea as existingPengaliNilaiR — this doctor's existing Pihak PSSP. */
  existingPihakPssp: string;
  /** Same idea again — this doctor's existing Survey Pasien Harian, silently
   * carried over rather than re-collected (see DokterFieldsSection). */
  existingSurveyPasienHarian: string;
  onCancel: () => void;
}) {
  const [dokterFields, setDokterFields] = useState<DokterFields>({
    ...emptyDokterFields(defaultPeriode),
    pengaliNilaiR: existingPengaliNilaiR,
    pihakPssp: existingPihakPssp,
    surveyPasienHarian: existingSurveyPasienHarian,
  });
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);
  const [labelCustomer, setLabelCustomer] = useState("");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [psspEverProductNames, setPsspEverProductNames] = useState<Set<string>>(new Set());
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
    getPsspProductNamesByOutlet(kodePI).then((names) => setPsspEverProductNames(new Set(names.map((n) => n.toLowerCase().trim()))));
    getDiskonByOutlet(kodePI).then(setDiskonList);
    getDiskonHistoryByOutlet(kodePI).then(setDiskonHistoryList);
  }, [kodePI]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  function updateProduk(idx: number, patch: Partial<ProdukEntry>) {
    setProdukList((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  function buildFormData(entry: ProdukEntry): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    fd.set("directNamaCust", namaCust);
    fd.set("directSpesialisasi", spesialisasi);
    fd.set("directKodeCust", kodeCust ?? "");
    fd.set("kodePI", kodePI);
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", entry.hariKerjaBulan || dokterFields.hariKerjaBulan);

    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("surveyPasienHarian", dokterFields.surveyPasienHarian);
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", dokterFields.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("bentukPssp", dokterFields.bentukPssp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", dokterFields.pengaliNilaiR);
    const totalBiayaAP = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiayaAP));
    const perBulanAP = dokterFields.lamaPeriode > 0 ? totalBiayaAP / dokterFields.lamaPeriode : 0;
    const oldEstAP = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasioAP = perBulanAP > 0 && oldEstAP && oldEstAP.perBulan > 0 ? perBulanAP / oldEstAP.perBulan : null;
    fd.set("rasioEstimasiGrowth", rasioAP != null ? rasioAP.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || !dokterFields.jenisPsSp || !dokterFields.bentukPssp
      || validEntries.some((e) => !e.jumlahResepHari || !e.qtyProdukResep || !e.produkKompetitor);
    if (hasErrors) {
      setAttempted(true);
      setTimeout(() => {
        const el = document.querySelector("[data-field-err]");
        (el as HTMLElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }
    setError(null);
    setProgress({ done: 0, total: validEntries.length });
    startTransition(async () => {
      try {
        for (let i = 0; i < validEntries.length; i++) {
          await addLineItemAction(poaId, buildFormData(validEntries[i]));
          setProgress({ done: i + 1, total: validEntries.length });
        }
        window.location.reload();
      } catch (err) {
        // redirect() inside the server action (validation failures, auth checks) works by
        // throwing — must re-throw so Next.js's own router handles it, not shown as an error.
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
        setProgress(null);
      }
    });
  }

  const filledCount = produkList.filter((e) => !!e.kodeProduk).length;

  return (
    <div className="mx-4 mb-4 mt-1 rounded-xl border p-4 space-y-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 1.5 }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Produk</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {namaCust} · {spesLabel(spesialisasi)} · {namaOutlet}
            </span>
            {psspHistory && psspHistory.length > 0 && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                style={{ color: "var(--color-blue)", background: "var(--color-blue-light, #eff6ff)" }}>
                PSSP ke-{computePsspKe(psspHistory)}
              </span>
            )}
            {labelCustomer && <LabelCustomerBadge label={labelCustomer} />}
          </div>
        </div>
        <button type="button" onClick={onCancel} className="text-xs" style={{ color: "var(--color-text-faint)" }}>✕</button>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <DokterFieldsSection
          fields={dokterFields}
          onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          poaPeriod={poaPeriod}
          periodeAwalError={attempted && !dokterFields.periodeAwal}
          hariKerjaBulanError={attempted && !dokterFields.hariKerjaBulan}
          lamaPeriodeRequiredError={attempted && !dokterFields.lamaPeriode}
          jenisPsSpError={attempted && !dokterFields.jenisPsSp}
          bentukPsspError={attempted && !dokterFields.bentukPssp}
          showCustomerLevelFields={false}
          kodeCustomer={kodeCust ?? undefined}
          kodePI={kodePI}
        />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★</span> = Produk Kontes
            </span>
          </div>
          <div className="space-y-2">
            {produkList.map((entry, i) => (
              <ProdukEntryRow
                key={entry.uid}
                index={i}
                entry={entry}
                products={products}
                dokterFields={dokterFields}
                spesialisasi={spesialisasi || undefined}
                psspHistory={psspHistory ?? undefined}
                kriteriaList={kriteriaList}
                psspEverProductNames={psspEverProductNames}
                diskonList={diskonList}
                diskonHistoryList={diskonHistoryList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
                kodeCustomer={kodeCust}
                kodePI={kodePI}
                onChange={(patch) => updateProduk(i, patch)}
                onRemove={() => setProdukList((prev) => prev.filter((_, idx) => idx !== i))}
                showRemove={produkList.length > 1}
                showError={attempted}
              />
            ))}
            <button type="button"
              onClick={() => setProdukList((prev) => [...prev, emptyProdukEntry()])}
              className="text-sm font-medium px-3 py-2 rounded-lg w-full border-2 border-dashed transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)]">
              + Tambah Produk Lagi
            </button>
          </div>
          {filledCount > 0 && totalEstimasi > 0 && (
            <p className="mt-2 text-xs text-right" style={{ color: "var(--color-text-muted)" }}>
              Total estimasi: <strong style={{ color: "var(--color-blue)" }}>{formatRp(totalEstimasi)}</strong>
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
      {namaCust && (
        <PsspSidebar
          kodeCustomer={kodeCust ?? ""}
          kodePI={kodePI}
          doctorName={namaCust}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
          kriteriaList={kriteriaList}
          psspHistory={psspHistory ?? undefined}
        />
      )}
    </div>
  );
}

// ─── EditDoctorPanel ────────────────────────────────────────────────────────
// Edit ALL products for one doctor at once — same UI/widgets as creating a new
// baris, pre-filled with existing data. Products can be changed, added, or
// removed; diffed against the original items on submit (update/add/delete).

interface EditableProdukEntry extends ProdukEntry {
  existingId?: string;
}

function produkEntryFromItem(
  item: PoaLineItem, doctorDefaultHariKerja: string
): EditableProdukEntry {
  const itemHari = item.hariKerjaBulan?.toString() ?? "";
  return {
    uid: item.id,
    existingId: item.id,
    kodeProduk: item.kodeProduk,
    jumlahResepHari: item.jumlahResepHari?.toString() ?? "",
    qtyProdukResep: item.qtyProdukResep?.toString() ?? "",
    produkKompetitor: item.produkKompetitor ?? "",
    statusStandarisasi: item.statusStandarisasi ?? "",
    jenisPssp: item.jenisPssp ?? "",
    // Must read the SAVED value first, never the live Product.nilaiRPersen —
    // persenPsspDokter is frozen at whatever it was when this line item was
    // created (see the read-only "% PSSP User" field at product-add time),
    // same snapshot convention as every other saved field here. Preferring
    // the live master value made "Total Nilai PSSP" in this edit panel's
    // "Total Semua Produk" card silently diverge from the real saved total
    // shown on the draft detail page whenever Product.nilaiRPersen changed
    // after this line item was created (2026-08-05 bug report: "total nilai
    // PSSP nya ga match sama yang ditampilkan di total semua produk").
    persenPsspDokter: item.persenPsspDokter ? (parseFloat(item.persenPsspDokter.toString()) * 100).toFixed(2) : "",
    persenPsspKpdm: item.persenPsspKpdm ? (parseFloat(item.persenPsspKpdm.toString()) * 100).toFixed(2) : "",
    persenDiskon: item.persenDiskon ? (parseFloat(item.persenDiskon.toString()) * 100).toFixed(2) : "",
    persenDp: item.persenDp ? (parseFloat(item.persenDp.toString()) * 100).toFixed(2) : "",
    persenListingFee: item.persenListingFee ? (parseFloat(item.persenListingFee.toString()) * 100).toFixed(2) : "",
    persenEntertain: item.persenEntertain ? (parseFloat(item.persenEntertain.toString()) * 100).toFixed(2) : "",
    // Only surface Hari Praktek as an explicit override when it differs from the doctor's default.
    hariKerjaBulan: itemHari && itemHari !== doctorDefaultHariKerja ? itemHari : "",
  };
}

export function EditDoctorPanel({ items, poaId, poaPeriod, products, redirectTo, readOnly = false }: {
  items: PoaLineItem[]; poaId: string; poaPeriod: string; products: Product[]; redirectTo: string;
  /** True for a viewer who can see this POA but not edit it (VIEWER/GM/SFE
   * etc., or an editor whose access is currently locked) — renders every
   * field via a <fieldset disabled>, same full detail an editor sees, just
   * nothing is clickable and there's no Simpan button (2026-07-31). */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const first = items[0];
  const kodePI = first.kodePI ?? "";
  const namaOutlet = first.namaOutlet;
  const kodeCust = first.kodeCust;
  const namaCust = first.namaCust;
  const spesialisasi = first.spesialisasi;

  const [dokterFields, setDokterFields] = useState<DokterFields>({
    periodeAwal: first.periodeAwal,
    lamaPeriode: first.lamaPeriode,
    hariKerjaBulan: first.hariKerjaBulan?.toString() ?? "",
    rencanaVisitMinggu: first.rencanaVisitMinggu.toString(),
    surveyPasienHarian: first.surveyPasienHarian.toString(),
    jenisPsSp: first.jenisPsSp ?? "",
    bentukPssp: first.bentukPssp ?? "",
    pengaliNilaiR: first.pengaliNilaiR?.toString() ?? "",
    pihakPssp: first.pihakPssp ?? "USER",
  });
  const [produkList, setProdukList] = useState<EditableProdukEntry[]>(
    () => items.map((it) => produkEntryFromItem(it, first.hariKerjaBulan?.toString() ?? ""))
  );
  const [labelCustomer, setLabelCustomer] = useState(first.labelCustomer ?? "");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [psspEverProductNames, setPsspEverProductNames] = useState<Set<string>>(new Set());
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
    getPsspProductNamesByOutlet(kodePI).then((names) => setPsspEverProductNames(new Set(names.map((n) => n.toLowerCase().trim()))));
    getDiskonByOutlet(kodePI).then(setDiskonList);
    getDiskonHistoryByOutlet(kodePI).then(setDiskonHistoryList);
  }, [kodePI]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  // Same "Estimasi & Nilai PSSP per Bulan" table as AddPanel/Ringkasan POA
  // (2026-08-08: was missing here, only shown when adding a new doctor, not
  // when editing an existing one's rencana) — same computation, built from
  // this panel's own in-progress produkList/dokterFields.
  const pengaliNilaiRResolved = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
  const monthlyBreakdown = useMemo(() => computeMonthlyBreakdown(
    produkList.filter((e) => !!e.kodeProduk).map((e) => {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      return {
        rencanaTotalBiaya: computeEstimasi(e, dokterFields, p),
        persenPsspDokter: (parseFloat(e.persenPsspDokter) || 0) / 100,
        pengaliNilaiR: pengaliNilaiRResolved,
        periodeAwal: dokterFields.periodeAwal,
        lamaPeriode: dokterFields.lamaPeriode,
      };
    })
  ), [produkList, dokterFields, products, pengaliNilaiRResolved]);
  const monthlyBreakdownSorted = [...monthlyBreakdown.keys()].sort();
  const monthlyBreakdownTotal = [...monthlyBreakdown.values()].reduce(
    (acc, v) => ({ estimasi: acc.estimasi + v.estimasi, nilaiPssp: acc.nilaiPssp + v.nilaiPssp }),
    { estimasi: 0, nilaiPssp: 0 }
  );

  const matchedPaketsForKontes = useMemo(
    () => spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [],
    [spesialisasi]
  );

  // Same total, filtered to products that are tier-0 (kontes) for this doctor's spesialisasi.
  const totalEstimasiKontes = useMemo(() => {
    if (matchedPaketsForKontes.length === 0) return { total: 0, count: 0 };
    let total = 0, count = 0;
    for (const e of produkList) {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      if (!p || getProductTier(p.namaProduk, matchedPaketsForKontes) !== 0) continue;
      total += computeEstimasi(e, dokterFields, p);
      count++;
    }
    return { total, count };
  }, [produkList, dokterFields, products, matchedPaketsForKontes]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
      const pct = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR
        + [entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
          .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
      budgetWeighted += base * pct;
      estTotal += base;
    }
    return estTotal > 0 ? budgetWeighted / estTotal : null;
  }, [produkList, dokterFields, products]);

  function updateProduk(idx: number, patch: Partial<ProdukEntry>) {
    setProdukList((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  function buildFormData(entry: EditableProdukEntry): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    if (!entry.existingId) {
      fd.set("directNamaCust", namaCust);
      fd.set("directSpesialisasi", spesialisasi);
      fd.set("directKodeCust", kodeCust ?? "");
      fd.set("kodePI", kodePI);
    }
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", entry.hariKerjaBulan || dokterFields.hariKerjaBulan);
    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("surveyPasienHarian", dokterFields.surveyPasienHarian);
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", dokterFields.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("bentukPssp", dokterFields.bentukPssp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", dokterFields.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst.perBulan > 0 ? perBulan / oldEst.perBulan : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || !dokterFields.surveyPasienHarian
      || !dokterFields.jenisPsSp || !dokterFields.bentukPssp
      || validEntries.some((e) => !e.jumlahResepHari || !e.qtyProdukResep || !e.produkKompetitor);
    if (hasErrors) {
      setAttempted(true);
      setTimeout(() => {
        const el = document.querySelector("[data-field-err]");
        (el as HTMLElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }
    setError(null);
    const removedIds = items
      .map((it) => it.id)
      .filter((id) => !validEntries.some((e) => e.existingId === id));
    const total = validEntries.length + removedIds.length;
    setProgress({ done: 0, total });
    startTransition(async () => {
      try {
        let done = 0;
        for (const entry of validEntries) {
          if (entry.existingId) await updateLineItemAction(poaId, entry.existingId, buildFormData(entry));
          else await addLineItemAction(poaId, buildFormData(entry));
          done++; setProgress({ done, total });
        }
        for (const id of removedIds) {
          await deleteLineItemAction(poaId, id);
          done++; setProgress({ done, total });
        }
        router.push(redirectTo);
      } catch (err) {
        // redirect() inside the server action (validation failures, auth checks) works by
        // throwing — must re-throw so Next.js's own router handles it, not shown as an error.
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
        setProgress(null);
      }
    });
  }

  const filledCount = produkList.filter((e) => !!e.kodeProduk).length;

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 1.5 }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {readOnly ? "Detail Rencana POA" : "Edit Rencana POA"}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {namaCust} · {spesLabel(spesialisasi)} · {namaOutlet}
          </span>
          {psspHistory && psspHistory.length > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ color: "var(--color-blue)", background: "var(--color-blue-light, #eff6ff)" }}>
              PSSP ke-{computePsspKe(psspHistory)}
            </span>
          )}
          {labelCustomer && <LabelCustomerBadge label={labelCustomer} />}
        </div>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* display:contents so the fieldset adds no box/border of its own —
            disabling it natively disables every input/select/button nested
            inside, without threading a readOnly prop through each one. */}
        <fieldset disabled={readOnly} className="contents">
        <DokterFieldsSection
          fields={dokterFields}
          onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          poaPeriod={poaPeriod}
          periodeAwalError={attempted && !dokterFields.periodeAwal}
          hariKerjaBulanError={attempted && !dokterFields.hariKerjaBulan}
          surveyPasienHarianError={attempted && !dokterFields.surveyPasienHarian}
          lamaPeriodeRequiredError={attempted && !dokterFields.lamaPeriode}
          jenisPsSpError={attempted && !dokterFields.jenisPsSp}
          bentukPsspError={attempted && !dokterFields.bentukPssp}
        />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★</span> = Produk Kontes
            </span>
          </div>
          <div className="space-y-2">
            {produkList.map((entry, i) => (
              <ProdukEntryRow
                key={entry.uid}
                index={i}
                entry={entry}
                products={products}
                dokterFields={dokterFields}
                spesialisasi={spesialisasi || undefined}
                psspHistory={psspHistory ?? undefined}
                kriteriaList={kriteriaList}
                psspEverProductNames={psspEverProductNames}
                diskonList={diskonList}
                diskonHistoryList={diskonHistoryList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
                kodeCustomer={kodeCust}
                kodePI={kodePI}
                onChange={(patch) => updateProduk(i, patch)}
                onRemove={() => setProdukList((prev) => prev.filter((_, idx) => idx !== i))}
                showRemove={produkList.length > 1}
                showError={attempted}
              />
            ))}
            <button type="button"
              onClick={() => setProdukList((prev) => [...prev, emptyProdukEntry()])}
              className="text-sm font-medium px-3 py-2 rounded-lg w-full border-2 border-dashed transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)]">
              + Tambah Produk Lagi
            </button>
          </div>
        </div>

        {/* Total summary + pengali */}
        {filledCount > 0 && totalEstimasi > 0 && (() => {
          const lama = dokterFields.lamaPeriode || 1;
          const newPerMonth = totalEstimasi / lama;
          // Aggregate Growth Estimasi across all filled products (2026-07-27: kept
          // as a headline total alongside the per-product breakdown table below —
          // "growth estimasi total semua produk nya tetap ada").
          let totalOldEstPerMonth = 0; let hasOldEst = false;
          for (const entry of produkList) {
            if (!entry.kodeProduk || !psspHistory || psspHistory.length === 0) continue;
            const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
            if (!p) continue;
            const old = computeLatestEstPerMonth(psspHistory, p.namaProduk);
            if (old == null) continue;
            totalOldEstPerMonth += old.perBulan; hasOldEst = true;
          }
          const growthEstimasiTotalPct = hasOldEst && totalOldEstPerMonth > 0
            ? (newPerMonth / totalOldEstPerMonth - 1) * 100 : null;
          return (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Total Semua Produk
              </p>
              {/* Pengali Nilai R (2026-07-28 request: moved down here, out of the
                  fields at the top of the form) — customer-level, shared across
                  every product for this doctor. */}
              <label className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R</span>
                <div style={{ width: 110 }}>
                  <UnitInput
                    value={dokterFields.pengaliNilaiR}
                    onChange={(v) => setDokterFields((prev) => ({ ...prev, pengaliNilaiR: v }))}
                    unit="x"
                    placeholder="1"
                    step={0.1} />
                </div>
              </label>
            </div>
            <div className="flex gap-6 flex-wrap items-start">
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Estimasi Sales</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{formatRp(totalEstimasi)}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{formatRp(Math.round(newPerMonth))}/bln</div>
              </div>
              {totalEstimasiKontes.count > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Produk Kontes</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalEstimasiKontes.total)}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{totalEstimasiKontes.count} produk kontes</div>
                </div>
              )}
              {totalNilaiPSSP > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Nilai PSSP</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalNilaiPSSP)}</div>
                </div>
              )}
              {totalPctBudget != null && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total % Budget</div>
                  <div className="text-xl font-bold"
                    style={{ color: totalPctBudget > 42.5 ? "var(--color-red)" : "var(--color-text)" }}>
                    {totalPctBudget.toFixed(2)}%
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: totalPctBudget > 42.5 ? "var(--color-red)" : "var(--color-success, #16a34a)" }}>
                    {totalPctBudget > 42.5 ? "⚠ OVER BUDGET" : "✓ SAFE"}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Growth Estimasi</div>
                {growthEstimasiTotalPct != null ? (
                  <>
                    <div className="text-xl font-bold"
                      style={{ color: growthEstimasiTotalPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      {growthEstimasiTotalPct >= 0 ? "+" : ""}{growthEstimasiTotalPct.toFixed(1)}%
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      PSSP lama {formatRp(Math.round(totalOldEstPerMonth))}/bln
                    </div>
                    <p className="text-xs font-semibold mt-1 max-w-[14rem]"
                      style={{ color: growthEstimasiTotalPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                      {growthEstimasiTotalPct > 0
                        ? "✓ Estimasi sudah menunjukkan intensifikasi - pastikan nilainya sudah tepat"
                        : "⚠ Estimasi belum menunjukkan intensifikasi dibanding PSSP sebelumnya"}
                    </p>
                  </>
                ) : (
                  <div className="text-sm mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                    {psspHistory === null ? "Memuat…" : psspHistory.length === 0 ? "Tidak ada histori PSSP" : "Belum ada data PSSP"}
                  </div>
                )}
              </div>
            </div>
            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-faint)" }}>
                Estimasi Qty & Growth vs PSSP per Produk {matchedPaketsForKontes.length > 0 && "(★ = Produk Kontes)"}
              </p>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--color-text-faint)" }}>
                    <th className="text-left font-medium pb-1">Produk</th>
                    <th className="text-right font-medium pb-1">Qty</th>
                    <th className="text-right font-medium pb-1">Estimasi</th>
                    <th className="text-right font-medium pb-1">Nilai PSSP</th>
                    <th className="text-right font-medium pb-1">% Budget</th>
                    <th className="text-right font-medium pb-1">Growth Estimasi</th>
                    <th className="text-right font-medium pb-1">Growth Pelunasan</th>
                    <th className="text-right font-medium pb-1">Standarisasi</th>
                  </tr>
                </thead>
                <tbody>
                  {produkList.filter((e) => !!e.kodeProduk).map((entry) => {
                    const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
                    if (!p) return null;
                    const qtyTotalUB = Math.round(qtyToUB(computeQtyTotal(entry, dokterFields), p));
                    const isKontes = getProductTier(p.namaProduk, matchedPaketsForKontes) === 0;
                    const estimasiTotal = computeEstimasi(entry, dokterFields, p);
                    const nilaiRPersen = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
                    const pengaliNilaiRProduk = resolvePengaliNilaiR(dokterFields.pengaliNilaiR);
                    const nilaiPSSP = nilaiRPersen != null
                      ? Math.round(estimasiTotal * nilaiRPersen * pengaliNilaiRProduk)
                      : null;
                    // % Budget per produk (2026-07-28 request) — same formula as
                    // totalPctBudget's per-entry weight above, just shown per row
                    // instead of only as one blended total.
                    const pctBudgetProduk = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiRProduk
                      + [entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
                        .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
                    // Per-product Growth Estimasi/Pelunasan — same formulas as the
                    // per-product calculator card above (ProdukEntryRow), just
                    // re-derived here since this table works off the whole
                    // produkList rather than one row's own local state.
                    const perBulanProduk = lama > 0 ? estimasiTotal / lama : 0;
                    const oldEstProduk = (psspHistory && psspHistory.length > 0)
                      ? computeLatestEstPerMonth(psspHistory, p.namaProduk) : null;
                    const growthEstimasiPct = (perBulanProduk > 0 && oldEstProduk != null && oldEstProduk.perBulan > 0)
                      ? (perBulanProduk / oldEstProduk.perBulan - 1) * 100 : null;
                    const pelunasanProduk = (psspHistory && psspHistory.length > 0)
                      ? computePelunasanAktualPerMonth(psspHistory, p.namaProduk) : null;
                    const growthPelunasanPct = (perBulanProduk > 0 && pelunasanProduk != null && pelunasanProduk.perBulan > 0)
                      ? (perBulanProduk / pelunasanProduk.perBulan - 1) * 100 : null;
                    return (
                      <tr key={entry.uid} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="py-1 pr-2 truncate" style={{ color: "var(--color-text-muted)" }}>
                          {isKontes && <span style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★ </span>}
                          {p.namaProduk}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {qtyTotalUB > 0 ? `${qtyTotalUB.toLocaleString("id-ID")} ${satuanLabel(p)}` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {estimasiTotal > 0 ? formatRp(estimasiTotal) : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {nilaiPSSP != null && nilaiPSSP > 0 ? formatRp(nilaiPSSP) : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: pctBudgetProduk > 42.5 ? "var(--color-red)" : "var(--color-text-faint)" }}>
                          {pctBudgetProduk > 0 ? `${pctBudgetProduk.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          title={growthEstimasiPct == null ? undefined : oldEstProduk
                            ? `vs PSSP periode ${oldEstProduk.period}${growthEstimasiPct > 0
                              ? " — sudah menunjukkan intensifikasi, pastikan nilainya sudah tepat"
                              : " — intensifikasi kurang, belum naik dibanding periode ini"}`
                            : undefined}
                          style={{ color: growthEstimasiPct == null ? "var(--color-text-faint)" : growthEstimasiPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthEstimasiPct != null ? `${growthEstimasiPct >= 0 ? "+" : ""}${growthEstimasiPct.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          title={growthPelunasanPct == null ? undefined : pelunasanProduk
                            ? `vs PSSP periode ${pelunasanProduk.period}${growthPelunasanPct > 0
                              ? " — sudah menunjukkan intensifikasi"
                              : " — intensifikasi kurang, belum naik dibanding periode ini"}`
                            : undefined}
                          style={{ color: growthPelunasanPct == null ? "var(--color-text-faint)" : growthPelunasanPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthPelunasanPct != null ? `${growthPelunasanPct >= 0 ? "+" : ""}${growthPelunasanPct.toFixed(1)}%` : "-"}
                        </td>
                        <td className="py-1 text-right">
                          <StandarisasiIndicator entries={[entry]} compact />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
        })()}

        {/* Estimasi & Nilai PSSP per Bulan — same table as "Ringkasan POA"
            (DraftChecklist.tsx) and AddPanel, shown here too so editing an
            existing doctor's rencana also shows the monthly spread
            (2026-08-08 request). Wrapped in its own outlined card (2026-08-08
            follow-up: "kurang rapih, kasih outline juga") to match the visual
            weight of "Total Semua Produk" above it. */}
        {monthlyBreakdownSorted.length > 0 && (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Estimasi & Nilai PSSP per Bulan
            </p>
            <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
                    <th className="text-left font-medium px-3 py-1.5">Bulan</th>
                    <th className="text-right font-medium px-3 py-1.5">Estimasi</th>
                    <th className="text-right font-medium px-3 py-1.5">Nilai PSSP</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyBreakdownSorted.map((m) => {
                    const v = monthlyBreakdown.get(m)!;
                    return (
                      <tr key={m} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="px-3 py-1.5" style={{ color: "var(--color-text-muted)" }}>{formatPeriode(m)}</td>
                        <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{v.estimasi > 0 ? formatRp(v.estimasi) : "-"}</td>
                        <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{v.nilaiPssp > 0 ? formatRp(v.nilaiPssp) : "-"}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 600 }}>
                    <td className="px-3 py-1.5" style={{ color: "var(--color-text)" }}>Total</td>
                    <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{formatRp(monthlyBreakdownTotal.estimasi)}</td>
                    <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>{formatRp(monthlyBreakdownTotal.nilaiPssp)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        </fieldset>

        <div className="flex items-center gap-3 pt-1" style={{ marginTop: "2rem" }}>
          {readOnly ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => router.push(redirectTo)}>← Kembali</Button>
          ) : (
            <>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending
                  ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
                  : `Simpan (${filledCount} produk)`}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => router.push(redirectTo)}>Batal</Button>
            </>
          )}
        </div>
      </form>
      {namaCust && (
        <PsspSidebar
          kodeCustomer={kodeCust ?? ""}
          kodePI={kodePI}
          doctorName={namaCust}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
          kriteriaList={kriteriaList}
          psspHistory={psspHistory ?? undefined}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LineItemEditor({ poaId, poaPeriod, initialItems, outlets, products, formOnly, redirectTo }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PoaLineItem[]>(initialItems);
  const [mode, setMode] = useState<"none" | "add">(formOnly ? "add" : "none");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "info" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, type: "success" | "info" | "error" = "success") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // Show notice/error from URL (e.g. after a redirect from createPoaAction or
  // addLineItemAction's own validation redirects — "Field wajib belum
  // lengkap.", "{produk} sudah ada untuk dokter ini.", etc.). The `error`
  // case was previously never read at all: addLineItemAction's server-side
  // validation failures redirected here with `?error=...` but nothing
  // displayed it, so a genuinely failed save looked like nothing happened
  // except the AddPanel remounting and restoring its (correctly still-
  // unsaved) draft — read as "click Simpan, get a confusing 'draft
  // restored' message instead of any explanation" (2026-07-29 bug report).
  useEffect(() => {
    const notice = searchParams.get("notice");
    if (notice) showToast(notice, "info");
    const error = searchParams.get("error");
    if (error) showToast(error, "error");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSuccess = useCallback(() => {
    if (redirectTo) router.push(redirectTo);
    else window.location.reload();
  }, [redirectTo, router]);
  const [addingProductFor, setAddingProductFor] = useState<{
    kodePI: string; namaOutlet: string; kodeCust: string | null;
    namaCust: string; spesialisasi: string; defaultPeriode: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(itemId: string) {
    if (!confirm("Hapus baris ini?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteLineItemAction(poaId, itemId);
        setItems((prev) => prev.filter((li) => li.id !== itemId));
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Gagal menghapus.");
      }
    });
  }

  // Group: outlet → dokter → products
  const grouped = useMemo(() => {
    const byOutlet = new Map<string, Map<string, PoaLineItem[]>>();
    for (const item of items) {
      const outletKey = item.kodePI ?? item.namaOutlet;
      if (!byOutlet.has(outletKey)) byOutlet.set(outletKey, new Map());
      const byDokter = byOutlet.get(outletKey)!;
      const custKey = item.namaCust ?? "-";
      if (!byDokter.has(custKey)) byDokter.set(custKey, []);
      byDokter.get(custKey)!.push(item);
    }
    return byOutlet;
  }, [items]);

  return (
    <div className="space-y-3">
      {/* Fixed toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          padding: "12px 18px", borderRadius: 10, maxWidth: 360,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          background: toast.type === "success" ? "#dcfce7"
            : toast.type === "error" ? "#fee2e2" : "#eff6ff",
          color: toast.type === "success" ? "#15803d"
            : toast.type === "error" ? "#dc2626" : "#1d4ed8",
          border: `1px solid ${toast.type === "success" ? "#86efac"
            : toast.type === "error" ? "#fca5a5" : "#93c5fd"}`,
          fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 10,
          transition: "opacity 0.2s",
        }}>
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}</span>
          <span style={{ flex: 1 }}>{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)}
            style={{ color: "inherit", opacity: 0.6, fontSize: 16, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>
      )}

      {error && (
        <div className="rounded-md px-4 py-2 text-sm"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</div>
      )}

      {!formOnly && (grouped.size === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-10 text-center"
          style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada baris POA.</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>Klik tombol di bawah untuk mulai.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(grouped.entries()).map(([outletKey, byDokter]) => {
            const firstItem = byDokter.values().next().value![0];
            return (
              <div key={outletKey} className="rounded-xl border overflow-hidden"
                style={{ borderColor: "var(--color-border)" }}>
                {/* Outlet header */}
                <div className="px-4 py-2 flex items-center gap-2"
                  style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: "var(--color-border)", color: "var(--color-text-muted)" }}>
                    {firstItem.kodePI ?? outletKey}
                  </span>
                  <span className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                    {firstItem.namaOutlet}
                  </span>
                </div>

                {Array.from(byDokter.entries()).map(([custKey, custItems]) => {
                  const cItem = custItems[0];
                  const isDokterBaru = !cItem.kodeCust;
                  const isAddingHere = addingProductFor?.namaCust === cItem.namaCust
                    && addingProductFor?.kodePI === (cItem.kodePI ?? outletKey);

                  const totalEst = custItems.reduce((s, it) => s + parseFloat(it.rencanaTotalBiaya.toString()), 0);

                  return (
                    <div key={custKey} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      {/* Compact doctor header: Outlet — Dokter in one line */}
                      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap"
                        style={{ background: "var(--color-bg)" }}>
                        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                          {cItem.namaCust}
                        </span>
                        {isDokterBaru && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-warning-light, #fff7ed)", color: "var(--color-warning, #92400e)", border: "1px solid var(--color-warning-border, #fcd34d)" }}>
                            Baru
                          </span>
                        )}
                        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{spesLabel(cItem.spesialisasi)}</span>
                        {cItem.kodeCust && (
                          <span className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>· {cItem.kodeCust}</span>
                        )}
                        <span className="text-xs ml-auto" style={{ color: "var(--color-text-faint)" }}>
                          {custItems.length} produk · {formatRp(totalEst)}
                        </span>
                        {!isAddingHere && (
                          <button type="button"
                            className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
                            style={{ color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}
                            onClick={() => {
                              setMode("none");
                              setAddingProductFor({
                                kodePI: cItem.kodePI ?? outletKey,
                                namaOutlet: cItem.namaOutlet,
                                kodeCust: cItem.kodeCust,
                                namaCust: cItem.namaCust,
                                spesialisasi: cItem.spesialisasi,
                                defaultPeriode: cItem.periodeAwal,
                              });
                            }}>
                            + Produk
                          </button>
                        )}
                      </div>

                      {/* Product rows — compact */}
                      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                        {custItems.map((item) => {
                          const est = parseFloat(item.rencanaTotalBiaya.toString());
                          return (
                            <div key={item.id}>
                              <div className="px-4 pl-8 py-2.5 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                                      {item.namaProduk}
                                    </span>
                                    {item.statusStandarisasi && (
                                      <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
                                        style={{
                                          background: item.statusStandarisasi === "SUDAH_STANDARISASI"
                                            ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                                          color: item.statusStandarisasi === "SUDAH_STANDARISASI"
                                            ? "var(--color-success, #16a34a)" : "var(--color-text-faint)",
                                        }}>
                                        {STATUS_STANDARISASI_LABELS[item.statusStandarisasi]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0 mt-0.5 text-xs"
                                    style={{ color: "var(--color-text-faint)" }}>
                                    <span>{formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}</span>
                                    {est > 0 && <span>{formatRp(est)}</span>}
                                    <span>{item.rencanaVisitMinggu}×/mgg</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <Link href={`/poa/${poaId}/items/${item.id}/edit`}
                                    className="text-xs font-medium"
                                    style={{ color: "var(--color-blue)" }}>
                                    Edit
                                  </Link>
                                  <button type="button" className="text-xs font-medium"
                                    style={{ color: "var(--color-red)" }}
                                    onClick={() => handleDelete(item.id)} disabled={isPending}>
                                    Hapus
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {isAddingHere && addingProductFor && (
                        <AddProductPanel
                          poaId={poaId} poaPeriod={poaPeriod} products={products}
                          kodePI={addingProductFor.kodePI}
                          namaOutlet={addingProductFor.namaOutlet}
                          kodeCust={addingProductFor.kodeCust}
                          namaCust={addingProductFor.namaCust}
                          spesialisasi={addingProductFor.spesialisasi}
                          defaultPeriode={addingProductFor.defaultPeriode}
                          existingPengaliNilaiR={custItems[0]?.pengaliNilaiR?.toString() ?? ""}
                          existingPihakPssp={custItems[0]?.pihakPssp ?? "USER"}
                          existingSurveyPasienHarian={custItems[0]?.surveyPasienHarian?.toString() ?? ""}
                          onCancel={() => setAddingProductFor(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}

      {/* Add panels */}
      {mode === "add" && (
        <AddPanel
          poaId={poaId} poaPeriod={poaPeriod} outlets={outlets} products={products}
          existingItems={items}
          onCancel={formOnly ? undefined : () => setMode("none")}
          onSuccess={formOnly ? handleSuccess : () => { setMode("none"); window.location.reload(); }}
          onToast={showToast}
        />
      )}

      {/* "+ Tambah" button — hidden in formOnly mode */}
      {!formOnly && mode === "none" && (
        <Button type="button" variant="secondary" size="sm"
          onClick={() => router.push(`/poa/${poaId}/edit`)}>
          + Tambah Rencana POA
        </Button>
      )}
    </div>
  );
}
