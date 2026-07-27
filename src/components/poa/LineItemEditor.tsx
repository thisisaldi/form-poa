"use client";

import { useState, useTransition, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { PoaLineItem } from "@prisma/client";
import type { Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { getCustomersByOutlet, createCustomerAction, getPsspHistory, getPsspHospinetSnapshot, getListingFeeHistory, getKriteriaByOutlet, getDiskonByOutlet, getDiskonHistoryByOutlet, getSurveyRekomendasiInfo, getSurveyRekomendasiByOutlet, getPsspStatusByOutlet, type CustomerOption, type PsspKontrakSummary, type PsspHospinetSnapshotSummary, type ListingFeeKontrakSummary, type KriteriaByOutlet, type DiskonByProduct, type DiskonHistoryByProduct, type PsspStatusByCustomer, type SurveyRekomendasiRow } from "@/app/actions/customer";
import { computePeriodeAkhir, formatPeriode, formatPeriodeRange } from "@/lib/poaUtils";
import { quarterToMonths } from "@/lib/quarterUtils";
import { spesLabel, ALL_SPESIALISASI_OPTIONS } from "@/lib/spesialisasi";
import { getAllPakets, sortProductsBySpesialisasi, getPaketsBySpesialisasi, getProductTier } from "@/lib/paketProduk";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption, TAG_COLORS } from "@/components/ui/Combobox";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
  TIDAK_TAHU: "Tidak Tahu",
};

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
  jenisPsSp: string;  // "PS" | "SP" | "" (unselected — optional)
}

function emptyDokterFields(periodeAwal = ""): DokterFields {
  return {
    periodeAwal, lamaPeriode: 3,
    hariKerjaBulan: "",
    rencanaVisitMinggu: "4",
    jenisPsSp: "",
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
  pengaliNilaiR: string;   // per-product override of the doctor-level default; "" = inherit
  pihakPssp: string;       // "USER" | "KPDM" — relabels "% PSSP User" below, doesn't change the formula
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
    pengaliNilaiR: "",
    pihakPssp: "USER",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(val: string | number | { toString(): string } | null | undefined) {
  if (val == null) return "—";
  const n = parseFloat(val.toString());
  if (isNaN(n)) return "—";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

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
 * Real "% Diskon (DPL/DPF)" default for a product, from the DiskonKontrak(s)
 * at this outlet covering periodeAwal. If more than one contract matches (a
 * duplicate for the same outlet+product+period), the one with the largest
 * newOnPi wins. Returns null when there's no contracted discount on file —
 * callers should default to 0 in that case.
 */
function resolveDiskonPct(diskonList: DiskonByProduct[] | undefined, kodeProduk: string, periodeAwal: string): number | null {
  if (!diskonList || !kodeProduk || !periodeAwal) return null;
  const candidates = diskonList.filter((d) =>
    d.kodeProduk === kodeProduk && d.prdAwal <= periodeAwal && d.prdAkhir >= periodeAwal
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates.map((d) => d.newOnPi));
}

/**
 * Same as resolveDiskonPct, but falls back to DiskonHistory (weighted-average
 * historical % Total Diskon, not period-scoped — see importDiskonHistory.ts)
 * when no DPL contract covers this outlet+product+period. DPL always wins
 * when present; history is only ever used as a last resort.
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
  return fromHistory?.avgDiskonPct ?? null;
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

// Qty is entered/computed in ST (satuan terkecil); UB ("Unit Bungkus") is the qty
// expressed in SJ (satuan jual) instead — divide by konversiPembagi (ST per SJ).
function qtyToUB(qtyST: number, product: Product): number {
  const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
  return qtyST / konversi;
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
function computeLatestEstPerMonth(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const norm = namaProduk.toLowerCase().trim();
  const rows = history
    .filter((r) => r.nmProduk?.toLowerCase().trim() === norm && (r.estBaris ?? 0) > 0)
    .sort((a, b) => b.prdAkhir.localeCompare(a.prdAkhir));
  if (rows.length === 0) return null;
  const latest = rows[0];
  const sy = parseInt(latest.prdAwal.slice(0, 4)), sm = parseInt(latest.prdAwal.slice(4));
  const ey = parseInt(latest.prdAkhir.slice(0, 4)), em = parseInt(latest.prdAkhir.slice(4));
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return months > 0 && latest.estBaris > 0 ? latest.estBaris / months : null;
}

// Rows for a product (matched by name — Procode ≠ Item Kode across systems) that were
// active at any point in the last 3 months, i.e. prdAkhir falls within that window.
// Shared by computePelunasan3Bln (% realized, used for the "Pernah PSSP" tag) and
// computePelunasanAktual3BlnPerMonth (Rp/month, used as Growth Pelunasan's baseline).
function rowsActiveLast3Months(history: PsspKontrakSummary[], namaProduk: string): PsspKontrakSummary[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1; // 1-12
  const threeMonthsAgoY = m > 3 ? y : y - 1;
  const threeMonthsAgoM = m > 3 ? m - 3 : m - 3 + 12;
  const threeMonthsAgoPeriod = `${threeMonthsAgoY}${String(threeMonthsAgoM).padStart(2, "0")}`;
  const norm = namaProduk.toLowerCase().trim();
  return history.filter((r) => r.nmProduk?.toLowerCase().trim() === norm && r.prdAkhir >= threeMonthsAgoPeriod);
}

// "Pernah di PSSP" product tag: pelunasan % across PSSP rows for this product (already
// scoped to the selected doctor+outlet via kdCust) that were active at any point in the
// last 3 months.
function computePelunasan3Bln(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const rows = rowsActiveLast3Months(history, namaProduk);
  if (rows.length === 0) return null;
  const sumEst = rows.reduce((s, r) => s + r.estBaris, 0);
  const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
  return sumEst > 0 ? Math.round((sumLunas / sumEst) * 100) : null;
}

// Growth Pelunasan's baseline: actual PSSP settlement (totalLunas) realized over the
// last 3 months for this product, averaged to a Rp/month figure comparable to
// `perBulan` (2026-07-27 fix: this used to compare against actual SALES qty via
// getSales3BlnByOutlet instead of actual PSSP pelunasan — wrong data source for a
// metric labeled "Growth Pelunasan").
function computePelunasanAktual3BlnPerMonth(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const rows = rowsActiveLast3Months(history, namaProduk);
  if (rows.length === 0) return null;
  const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
  return sumLunas > 0 ? sumLunas / 3 : null;
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
    return pct >= 80 ? "Akan Selesai, Pelunasan Bagus" : "Akan Selesai";
  }
  const pct = allEst > 0 ? allLunas / allEst * 100 : 0;
  return pct >= 80 ? "Pernah PSSP, Pelunasan Bagus" : "Pernah PSSP";
}

function LabelCustomerBadge({ label }: { label: string }) {
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

function UnitInput({ value, onChange, unit, placeholder = "0", step, min = 0 }: {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
  /** When set, renders up/down stepper buttons that bump the value by this amount. */
  step?: number;
  min?: number;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
  }

  function bump(delta: number) {
    if (step == null) return;
    // Empty field displays `placeholder` (e.g. "1") as its implied value — bump from
    // that, not from 0, so the first click steps relative to what's actually shown.
    const current = parseFloat(value) || parseFloat(placeholder) || 0;
    const next = Math.max(min, current + delta);
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

// Parses a PoaForm.period string ("2026-Q3") into its year and 1-indexed quarter months.
function parsePoaQuarterMonths(poaPeriod: string): { year: number; months: number[] } | null {
  const m = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const q = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3 + 1;
  return { year, months: [startMonth, startMonth + 1, startMonth + 2] };
}

// Returns an error message if periodeAwal (YYYYMM) is malformed or falls outside the POA's quarter.
// Returns null while the field is still incomplete.
function periodeAwalFormatError(periodeAwal: string, poaPeriod: string): string | null {
  if (periodeAwal.length !== 6) return null;
  const year = parseInt(periodeAwal.slice(0, 4), 10);
  const month = parseInt(periodeAwal.slice(4, 6), 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return "Format tidak valid (YYYYMM)";
  const quarter = parsePoaQuarterMonths(poaPeriod);
  if (quarter && (year !== quarter.year || !quarter.months.includes(month))) {
    const [m1, , m3] = quarter.months;
    return `Harus di periode POA ${poaPeriod} (${MONTH_LABELS[m1 - 1]}–${MONTH_LABELS[m3 - 1]} ${quarter.year})`;
  }
  return null;
}

function DokterFieldsSection({ fields, onChange, poaPeriod, periodeAwalError, hariKerjaBulanError, lamaPeriodeRequiredError, jenisPsSpError }: {
  fields: DokterFields;
  onChange: (patch: Partial<DokterFields>) => void;
  poaPeriod: string;
  periodeAwalError?: boolean;
  hariKerjaBulanError?: boolean;
  lamaPeriodeRequiredError?: boolean;
  jenisPsSpError?: boolean;
}) {
  const lamaPeriodeTooLong = fields.lamaPeriode > 12;
  const lamaPeriodeError = lamaPeriodeTooLong || !!lamaPeriodeRequiredError;
  const periodeOk = fields.periodeAwal.length === 6;
  const periodeFormatErr = periodeAwalFormatError(fields.periodeAwal, poaPeriod);
  const periodeHasErr = periodeAwalError || !!periodeFormatErr;

  // One dropdown, options are the 3 YYYYMM values inside the POA's own quarter
  // (e.g. POA period "2026-Q3" → 202607, 202608, 202609).
  const periodeOptions = useMemo(() => {
    const quarter = parsePoaQuarterMonths(poaPeriod);
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
  }, [fields.periodeAwal, poaPeriod]);

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
                placeholder="Jumlah hari praktek / bulan" />
            </div>
            {hariKerjaBulanError && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Bulan<Req /></span>
            <UnitInput
              value={fields.rencanaVisitMinggu}
              onChange={(v) => onChange({ rencanaVisitMinggu: v })}
              unit="Kali" />
          </label>
        </div>
      </div>

      {/* Rencana PSSP */}
      <div>
        <SectionLabel>Rencana PSSP</SectionLabel>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1 shrink-0" style={{ width: 200 }} {...(periodeHasErr ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: periodeHasErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
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
            <span className="text-xs" style={{ color: lamaPeriodeError ? "var(--color-red)" : "var(--color-text-muted)" }}>Lama Periode<Req /></span>
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
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>s/d</span>
              <div className="input-field flex items-center whitespace-nowrap"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)", cursor: "default" }}>
                {formatPeriode(computePeriodeAkhir(fields.periodeAwal, fields.lamaPeriode))}
              </div>
            </div>
          )}
          <label className="flex flex-col gap-1 shrink-0" style={{ width: 130 }} {...(jenisPsSpError ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: jenisPsSpError ? "var(--color-red)" : "var(--color-text-muted)" }}>PS / SP<Req /></span>
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
        </div>
      </div>
    </div>
  );
}

// ─── buildProductOptions ────────────────────────────────────────────────────
// Shared product-picker options builder — tiers by spesialisasi match, tags paket fokus.

function buildProductOptions(products: Product[], spesialisasi: string | undefined, kriteriaMap?: Map<string, { kriteriaBaru: string; kategori: string }>, psspHistory?: PsspKontrakSummary[]): ComboboxOption[] {
  const tierSorted = spesialisasi
    ? sortProductsBySpesialisasi(products, spesialisasi)
    : products;
  const matchedPakets = spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [];
  const TIER_LABEL = ["Produk Fokus Sesuai Spesialisasi", "Produk Fokus Lainnya", "Produk Lainnya"];

  // New top sort priority: products with PSSP history first, then the existing
  // tier order within each of those two buckets.
  const pelunasanByProduk = new Map<string, number>();
  if (psspHistory) {
    for (const p of tierSorted) {
      const pct = computePelunasan3Bln(psspHistory, p.namaProduk);
      if (pct != null) pelunasanByProduk.set(p.kodeProduk, pct);
    }
  }
  const sorted = [...tierSorted].sort((a, b) => {
    const aHasPssp = pelunasanByProduk.has(a.kodeProduk) ? 0 : 1;
    const bHasPssp = pelunasanByProduk.has(b.kodeProduk) ? 0 : 1;
    if (aHasPssp !== bHasPssp) return aHasPssp - bHasPssp;
    return 0; // keep tier order (tierSorted is already stable-sorted by tier)
  });

  return sorted.map((p) => {
    const allPakets = getAllPakets(p.namaProduk);
    const relevantPaket = allPakets.find((pk) => matchedPakets.includes(pk)) ?? allPakets[0] ?? null;
    const tier = getProductTier(p.namaProduk, matchedPakets);
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
    // "Produk Pernah di PSSP" — pelunasan % (last 3 months) for this doctor+outlet
    // (psspHistory is already scoped to the selected kdCust, which ties doctor+outlet together).
    const pelunasan3Bln = pelunasanByProduk.get(p.kodeProduk) ?? null;
    const tag2 = pelunasan3Bln != null ? `Pernah PSSP · Pelunasan 3 Bln ${pelunasan3Bln}%` : undefined;
    const tag2Color: "green" | "yellow" | "red" | undefined = pelunasan3Bln == null ? undefined
      : pelunasan3Bln >= 80 ? "green"
      : pelunasan3Bln >= 40 ? "yellow"
      : "red";
    return {
      value: p.kodeProduk,
      label: p.namaProduk,
      sublabel: [`${p.kodeProduk} · ${paketLabel}`, p.zatAktif].filter(Boolean).join(" · "),
      group: pelunasan3Bln != null ? "Pernah di PSSP" : (spesialisasi ? TIER_LABEL[tier] : allPakets.length > 0 ? "Produk Fokus" : "Produk Lainnya"),
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
  entry, index, products, dokterFields, spesialisasi, psspHistory, kriteriaList, diskonList, diskonHistoryList, usedKodeProduk, kodeCustomer, kodePI, onChange, onRemove, showRemove, showError,
}: {
  entry: ProdukEntry;
  index: number;
  products: Product[];
  dokterFields: DokterFields;
  spesialisasi?: string;
  psspHistory?: PsspKontrakSummary[];
  kriteriaList?: KriteriaByOutlet[];
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

  const productOptions = useMemo(() => {
    const opts = buildProductOptions(products, spesialisasi, kriteriaMap, psspHistory);
    if (!usedKodeProduk || usedKodeProduk.size === 0) return opts;
    return opts.filter((o) => o.value === entry.kodeProduk || !usedKodeProduk.has(o.value));
  }, [products, spesialisasi, kriteriaMap, usedKodeProduk, entry.kodeProduk, psspHistory]);

  const product = useMemo(() => products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null, [products, entry.kodeProduk]);

  const resep  = parseFloat(entry.jumlahResepHari) || 0;
  const qty    = parseFloat(entry.qtyProdukResep) || 0;
  const hari   = parseFloat(entry.hariKerjaBulan) || parseFloat(dokterFields.hariKerjaBulan) || 0;
  const hna    = product ? hargaST(product) : 0;  // price per ST
  const lama   = dokterFields.lamaPeriode || 1;
  const nilaiRPersen = product?.nilaiRPersen ? parseFloat(product.nilaiRPersen) : null;
  const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR);
  const canCalc = resep > 0 && qty > 0 && hari > 0 && hna > 0;
  const perBulan = canCalc ? Math.round(resep * qty * hari * hna) : null;
  const totalEst = perBulan != null ? perBulan * lama : null;
  const qtyPerBulanST = canCalc ? resep * qty * hari : null;
  const qtyTotalST = qtyPerBulanST != null ? qtyPerBulanST * lama : null;
  const qtyPerBulan = qtyPerBulanST != null ? Math.round(qtyToUB(qtyPerBulanST, product!)) : null;
  const qtyTotal = qtyTotalST != null ? Math.round(qtyToUB(qtyTotalST, product!)) : null;
  const nilaiPSSPBulan = perBulan != null && nilaiRPersen != null ? Math.round(perBulan * nilaiRPersen * pengaliNilaiR) : null;
  const nilaiPSSPTotal = nilaiPSSPBulan != null ? nilaiPSSPBulan * lama : null;

  const oldEstPerMonth = (psspHistory && psspHistory.length > 0 && product)
    ? computeLatestEstPerMonth(psspHistory, product.namaProduk)
    : null;
  const growthRatio = (perBulan != null && oldEstPerMonth != null && oldEstPerMonth > 0)
    ? perBulan / oldEstPerMonth
    : null;
  const growthPct = growthRatio != null ? (growthRatio - 1) * 100 : null;

  // Growth Pelunasan: perBulan vs actual PSSP settlement (pelunasan) realized over the
  // last 3 months for this product — a real-money check separate from (not a
  // replacement for) the PSSP-contract-ESTIMATE-based growth above.
  const pelunasanAktual3BlnPerMonth = (psspHistory && psspHistory.length > 0 && product)
    ? computePelunasanAktual3BlnPerMonth(psspHistory, product.namaProduk)
    : null;
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
                const autoStandarisasi = kriteria
                  ? (kriteria.startsWith("Produk Sudah Terstandarisasi") ? "SUDAH_STANDARISASI" : "BELUM_STANDARISASI")
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
              <span>HNA SJ: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(product.hna)}</strong> ({product.satuan})</span>
              <span>HNA ST: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(hna)}</strong> ({product.satuanTerkecil ?? product.satuan})
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
          <span className="text-xs" style={{ color: resepErr ? "var(--color-red)" : "var(--color-text-muted)" }}>Pasien Baru / Hari<Req /></span>
          <div style={resepErr ? ERR_RING : undefined}>
            <UnitInput
              value={entry.jumlahResepHari}
              onChange={(v) => onChange({ jumlahResepHari: v })}
              unit="Pasien"
              placeholder="Masukan jumlah pasien" />
          </div>
          {resepErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
        </label>
        <label className="flex flex-col gap-1" {...(qtyErr ? { "data-field-err": "true" } : {})}>
          <span className="text-xs" style={{ color: qtyErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
            Jml Produk ST / Resep<Req />
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
            <div>Resep per Pasien = {product?.qtyPerRxPasien != null && product?.lamaPemberianHari != null ? `${product.qtyPerRxPasien} ${product.satuanTerkecil} / ${product.lamaPemberianHari} hari` : "—"}</div>
            <div>Dosis per hari = {product?.jumlahPemberianPerHari != null ? `${product.jumlahPemberianPerHari} / hari` : "—"}</div>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Standarisasi<Opt /></span>
          <select value={entry.statusStandarisasi}
            onChange={(e) => onChange({ statusStandarisasi: e.target.value })}
            className="input-field text-xs">
            <option value="">— Pilih —</option>
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
              <option value="">— Pilih —</option>
              {Object.entries(JENIS_PSSP_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Praktek<Opt /></span>
          <UnitInput
            value={entry.hariKerjaBulan}
            onChange={(v) => onChange({ hariKerjaBulan: v })}
            unit="Hari"
            placeholder={dokterFields.hariKerjaBulan || "default"} />
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
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Qty per UB / Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {qtyPerBulan != null ? `${qtyPerBulan.toLocaleString("id-ID")} UB` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Qty per UB {lama} Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>
                {qtyTotal != null ? `${qtyTotal.toLocaleString("id-ID")} UB` : "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t"
            style={{ borderColor: "var(--color-border)" }}>
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth Estimasi</div>
              {oldEstPerMonth != null && (
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  PSSP lama {formatRp(Math.round(oldEstPerMonth))}/bln
                </div>
              )}
            </div>
            {growthPct != null ? (
              <span className="text-sm font-semibold"
                style={{ color: growthPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
              </span>
            ) : (
              <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                Belum ada data PSSP
              </span>
            )}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t"
            style={{ borderColor: "var(--color-border)" }}>
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth Pelunasan (3 Bln Terakhir)</div>
              {pelunasanAktual3BlnPerMonth != null && (
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  Pelunasan aktual {formatRp(Math.round(pelunasanAktual3BlnPerMonth))}/bln
                </div>
              )}
            </div>
            {growthPct3Bln != null ? (
              <span className="text-sm font-semibold"
                style={{ color: growthPct3Bln >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                {growthPct3Bln >= 0 ? "+" : ""}{growthPct3Bln.toFixed(1)}%
              </span>
            ) : (
              <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                Belum ada pelunasan PSSP 3 bln terakhir
              </span>
            )}
          </div>
        </div>
      )}

      {/* Nilai PSSP card + Pengali Nilai R — grouped in the same column so the multiplier sits directly under the calculator */}
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

      <label className="flex flex-col gap-1" style={{ maxWidth: 160 }}>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R</span>
        <UnitInput
          value={entry.pengaliNilaiR}
          onChange={(v) => onChange({ pengaliNilaiR: v })}
          unit="x"
          placeholder="1"
          step={0.1} />
      </label>
      </div>
      </div>

      {/* Budget % per produk */}
      <BudgetFieldsRow entry={entry} onChange={onChange} pengaliNilaiR={pengaliNilaiR} />
    </div>
  );
}

// ─── BudgetFieldsRow ─────────────────────────────────────────────────────────

function BudgetFieldsRow({
  entry,
  onChange,
  pengaliNilaiR,
}: {
  entry: ProdukEntry;
  onChange: (patch: Partial<ProdukEntry>) => void;
  pengaliNilaiR: number;
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
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pihak PSSP</span>
          <select
            value={entry.pihakPssp}
            onChange={(e) => onChange({ pihakPssp: e.target.value })}
            className="input-field text-xs">
            <option value="USER">User</option>
            <option value="KPDM">KPDM</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            % PSSP {entry.pihakPssp === "KPDM" ? "KPDM" : "User"} (Nilai R)
          </span>
          <div style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <UnitInput value={entry.persenPsspDokter} onChange={() => {}} unit="%" />
          </div>
        </label>
        {numInput("% Diskon (DPL/DPF)", "persenDiskon")}
        {numInput("% DP", "persenDp")}
        {numInput("% Listing Fee", "persenListingFee")}
        {numInput("% Entertain", "persenEntertain")}
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
        Snapshot agregat (bukan per-kontrak/per-produk) — dari data Hospinet, belum granular seperti histori PSSP di atas.
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

  function ContractCard({ cUrut, rows, isActive }: { cUrut: string; rows: PsspKontrakSummary[]; isActive: boolean }) {
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
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--color-text)" }}>{cUrut}</span>
              <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                {first.prdAwal} – {first.prdAkhir}
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
            {pct != null ? `${pct}%` : "—"}
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
          {activeContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} isActive />)}
        </div>
      )}
      {expiredContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            Selesai ({expiredContracts.length})
          </p>
          {expiredContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} isActive={false} />)}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {byContract.size} kontrak · snapshot {history[0]?.snapshotDate ?? "—"}
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
          <span className="text-xs shrink-0" style={{ color: "var(--color-text-faint)" }}>{r.prdAwal} – {r.prdAkhir}</span>
        </div>
        <div className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>{r.nmProduk ?? r.kdProduk}</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Value</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(r.value)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Target Sales</div>
            <div style={{ color: "var(--color-text-muted)" }}>{r.targetSales != null ? formatRp(r.targetSales) : "—"}</div>
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
        {history.length} kontrak · snapshot {history[0]?.snapshotDate ?? "—"}
      </p>
    </div>
  );
}

// ─── ProdukFokusPanel ─────────────────────────────────────────────────────────
// Focus/PM-recommended products (tier 0 for the doctor's spesialisasi) that
// aren't in produkList yet — a nudge to add them before submitting, not a
// requirement. Renders nothing if the spesialisasi has no mapped paket fokus.

function ProdukFokusPanel({
  spesialisasi,
  produkList,
  products,
  kriteriaList,
  psspHistory,
}: {
  spesialisasi: string;
  produkList: ProdukEntry[];
  products: Product[];
  /** Same source as the product picker's kriteria badge (low hanging fruit / kompetisi rendah-tinggi). */
  kriteriaList?: KriteriaByOutlet[];
  /** Same source as the product picker's "Pernah PSSP" badge. */
  psspHistory?: PsspKontrakSummary[];
}) {
  const matchedPakets = getPaketsBySpesialisasi(spesialisasi);
  if (matchedPakets.length === 0) return null;

  const kriteriaMap = new Map<string, { kriteriaBaru: string; kategori: string }>();
  for (const k of kriteriaList ?? []) kriteriaMap.set(k.kodeProduk, { kriteriaBaru: k.kriteriaBaru, kategori: k.kategori });

  const addedKodeProduk = new Set(produkList.map((e) => e.kodeProduk).filter(Boolean));
  const missing = products
    .filter((p) => getProductTier(p.namaProduk, matchedPakets) === 0)
    .filter((p) => !addedKodeProduk.has(p.kodeProduk))
    .sort((a, b) => a.namaProduk.localeCompare(b.namaProduk, "id"));

  if (missing.length === 0) return null;

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: 8 }}>
        Produk Fokus PM Belum Diajukan
      </p>
      <ul className="space-y-1.5">
        {missing.map((p) => {
          // Same kriteria + PSSP source as the product picker dropdown
          // (2026-07-23), but shown as full text for every kriteria here —
          // unlike the dropdown, which deliberately dot-only's Kompetisi
          // Rendah/Tinggi (2026-07-21 business decision scoped to that
          // compact picker specifically), this list has room to spell it
          // out, and hiding it behind a tooltip-only dot made it read as
          // "missing" (2026-07-23 follow-up).
          const kriteriaRow = kriteriaMap.get(p.kodeProduk);
          const kriteria = kriteriaRow?.kriteriaBaru;
          const isStandarisasi = kriteria?.startsWith("Produk Sudah Terstandarisasi") ?? false;
          const tagColor: "orange" | "yellow" | "blue" | "red" | undefined = isStandarisasi
            ? (kriteria?.includes("Tidak Ada Sales") ? "yellow" : "orange")
            : kriteria?.startsWith("Produk Kompetisi Rendah") ? "blue"
            : kriteria?.startsWith("Produk Kompetisi Tinggi") ? "red"
            : undefined;

          const pelunasan3Bln = psspHistory ? computePelunasan3Bln(psspHistory, p.namaProduk) : null;
          const psspLabel = pelunasan3Bln != null ? `Pernah PSSP · Pelunasan 3 Bln ${pelunasan3Bln}%` : "Belum Pernah PSSP";
          const psspColor: "green" | "yellow" | "red" | null = pelunasan3Bln == null ? null
            : pelunasan3Bln >= 80 ? "green"
            : pelunasan3Bln >= 40 ? "yellow"
            : "red";

          return (
            <li key={p.kodeProduk} className="text-xs px-2 py-1.5 rounded space-y-1"
              style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
              <div>{p.namaProduk}</div>
              <div className="flex items-center flex-wrap gap-1.5">
                {kriteria && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: TAG_COLORS[tagColor ?? "blue"].bg, color: TAG_COLORS[tagColor ?? "blue"].fg }}>
                    {formatKriteriaLabel(kriteria)}
                  </span>
                )}
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={psspColor
                    ? { background: TAG_COLORS[psspColor].bg, color: TAG_COLORS[psspColor].fg }
                    : { background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
                  {psspLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── KriteriaProdukPanel ──────────────────────────────────────────────────────
// Every product matching one of the 4 product-criteria buckets that used to
// only show up inline in the picker dropdown (2026-07-24) — Produk Fokus PM,
// Pernah PSSP, Listing Corporate - Ada Sales, Listing Corporate - Tidak Ada
// Sales (the general "Low Hanging Fruit" bucket, same kriteriaBaru prefix,
// see formatKriteriaLabel) — always in that order. Sections aren't mutually
// exclusive: a product matching more than one criterion appears in each.

function KriteriaSectionList({ items }: {
  items: { key: string; label: string; added?: boolean; isFokus?: boolean; badge?: string; badgeColor?: keyof typeof TAG_COLORS }[]
}) {
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded"
          style={{ background: "var(--color-bg-subtle)" }}>
          <span className="flex items-center gap-1.5 min-w-0">
            {it.added && (
              <span title="Sudah ditambahkan ke POA ini" style={{ color: "var(--color-success, #16a34a)", fontWeight: 700, flexShrink: 0 }}>
                ✓
              </span>
            )}
            {it.isFokus && (
              <span title="Produk Fokus PM" style={{ color: "var(--color-blue)", flexShrink: 0 }}>
                ★
              </span>
            )}
            <span className="truncate" style={{ color: "var(--color-text)" }}>{it.label}</span>
          </span>
          {it.badge && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: TAG_COLORS[it.badgeColor ?? "blue"].bg, color: TAG_COLORS[it.badgeColor ?? "blue"].fg }}>
              {it.badge}
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
// 2026-07-27: Produk Fokus PM first (same getAllPakets() check used
// everywhere else for a product-level, non-doctor-specific "Fokus" flag —
// see Matriks Summary Per Produk), then within each bucket by Potensi
// Terbesar (potensiBulan descending, null sinks to the bottom).
function sortSurveyRows(rows: SurveyRekomendasiRow[]): SurveyRekomendasiRow[] {
  return [...rows].sort((a, b) => {
    const aFokus = getAllPakets(a.namaProdukRekomendasi).length > 0;
    const bFokus = getAllPakets(b.namaProdukRekomendasi).length > 0;
    if (aFokus !== bFokus) return aFokus ? -1 : 1;
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

  const fokusPM: Product[] = [];
  const pernahPssp: { p: Product; pct: number }[] = [];
  const listingSales: Product[] = [];
  const listingNoSales: Product[] = [];

  for (const p of products) {
    if (matchedPakets.length > 0 && getProductTier(p.namaProduk, matchedPakets) === 0) fokusPM.push(p);

    const pct = psspHistory ? computePelunasan3Bln(psspHistory, p.namaProduk) : null;
    if (pct != null) pernahPssp.push({ p, pct });

    const kriteria = kriteriaMap.get(p.kodeProduk);
    if (kriteria?.startsWith("Produk Sudah Terstandarisasi")) {
      (kriteria.includes("Tidak Ada Sales") ? listingNoSales : listingSales).push(p);
    }
  }

  // Order requested 2026-07-27: Pernah PSSP (sort pelunasan terbaik) -> Produk
  // Fokus PM -> Produk Survey, then the two Listing Corporate sections kept
  // after (not part of the requested 3, but not removed either).
  type Section = { title: string; color: keyof typeof TAG_COLORS; items: { key: string; label: string; added?: boolean; isFokus?: boolean; badge?: string; badgeColor?: keyof typeof TAG_COLORS }[] };
  const allSections: Section[] = [
    {
      title: "Pernah PSSP", color: "green",
      items: [...pernahPssp].sort((a, b) => b.pct - a.pct).map(({ p, pct }) => ({
        key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk),
        badge: `${pct}%`, badgeColor: pct >= 80 ? "green" : pct >= 40 ? "yellow" : "red",
      })),
    },
    { title: "Produk Fokus PM", color: "blue", items: fokusPM.map((p) => ({ key: p.kodeProduk, label: p.namaProduk, added: addedKodeProduk.has(p.kodeProduk) })) },
    {
      title: "Produk Survey", color: "orange",
      items: sortSurveyRows(surveyRows ?? []).map((r) => ({
        key: r.kodeProduk, label: r.namaProdukRekomendasi, added: addedKodeProduk.has(r.kodeProduk),
        isFokus: getAllPakets(r.namaProdukRekomendasi).length > 0,
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
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada data survey untuk dokter ini.
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
// Pernah PSSP / Produk Fokus PM / Produk Survey sections, plus the 2 Listing
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
  /** Forwarded into ProdukFokusPanel — same kriteria + PSSP badges as the product picker. */
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
          <>
            {/* Moved here from "Histori PSSP" 2026-07-27 — this "Belum Diajukan"
                nudge list belongs with the other Produk Fokus PM content in this
                tab, not the PSSP history tab. */}
            {spesialisasi && produkList && products && (
              <ProdukFokusPanel spesialisasi={spesialisasi} produkList={produkList} products={products} kriteriaList={kriteriaList} psspHistory={psspHistory} />
            )}
            <KriteriaProdukPanel kodeCustomer={kodeCustomer} kodePI={kodePI} spesialisasi={spesialisasi} produkList={produkList} products={products} kriteriaList={kriteriaList} psspHistory={psspHistory} />
          </>
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
  poaId, poaPeriod, outlets, products, onCancel, onSuccess, onToast, onAddNewCustomer,
}: {
  poaId: string; poaPeriod: string; outlets: OutletOption[]; products: Product[];
  onCancel?: () => void;
  onSuccess?: () => void;
  onToast?: (msg: string, type?: "success" | "error") => void;
  onAddNewCustomer?: () => void;
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
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  const outletOptions = useMemo(() => [...outlets]
    .sort((a, b) => (isChainGroup(a.groupRS) ? 0 : 1) - (isChainGroup(b.groupRS) ? 0 : 1))
    .map((o) => ({
      value: o.kodePI,
      label: `${o.kodePI} - ${o.namaOutlet}`,
      sublabel: o.groupRS ?? "NON CHAIN",
    })), [outlets]);
  // Static list (independent of outlet, so it never comes up empty even
  // before any user is registered there — see onAddNewCustomer below), but
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
      const psspPeriodLabel = psspStatus
        ? `PSSP ${psspStatus.latestPrdAwal}–${psspStatus.latestPrdAkhir} (${psspStatus.isActive ? "Berjalan" : "Selesai"})`
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

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  const matchedPaketsForFokus = useMemo(
    () => spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [],
    [spesialisasi]
  );

  // Same total, filtered to products that are tier-0 (focus) for this doctor's spesialisasi.
  const totalEstimasiFokus = useMemo(() => {
    if (matchedPaketsForFokus.length === 0) return { total: 0, count: 0 };
    let total = 0, count = 0;
    for (const e of produkList) {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      if (!p || getProductTier(p.namaProduk, matchedPaketsForFokus) !== 0) continue;
      total += computeEstimasi(e, dokterFields, p);
      count++;
    }
    return { total, count };
  }, [produkList, dokterFields, products, matchedPaketsForFokus]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(e.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR);
      const pct = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR
        + [entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
          .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
      budgetWeighted += base * pct;
      estTotal += base;
    }
    return estTotal > 0 ? budgetWeighted / estTotal : null;
  }, [produkList, dokterFields, products]);

  function handleOutletChange(val: string) {
    setKodePI(val); setSpesialisasi(""); setCustomerId("");
    setCustomerList([]); setKriteriaList([]); setDiskonList([]); setDiskonHistoryList([]); setPsspStatusList([]);
    if (!val) return;
    startLoadSpec(async () => {
      const [kriteria, diskonData, diskonHistoryData] = await Promise.all([
        getKriteriaByOutlet(val),
        getDiskonByOutlet(val),
        getDiskonHistoryByOutlet(val),
      ]);
      setKriteriaList(kriteria);
      setDiskonList(diskonData);
      setDiskonHistoryList(diskonHistoryData);
    });
    startLoadCust(async () => setCustomerList(await getCustomersByOutlet(val)));
    getPsspStatusByOutlet(val).then(setPsspStatusList);
  }

  // Picking a user directly (search-by-name) is now the primary path — this
  // auto-fills spesialisasi from that user's own record instead of requiring
  // it to be picked first just to unlock the customer search.
  //
  // A "nexus:"-prefixed id is a live Nexus-API result with no local Customer
  // row yet (see getCustomersByOutlet) — materialize it into a real row via
  // createCustomerAction first, since addLineItemAction needs a real
  // Customer.id, then swap the synthetic id for the real one everywhere
  // (customerList so it doesn't re-materialize if picked again, and the
  // selection itself).
  async function handleCustomerChange(val: string) {
    const found = customerList.find((c) => c.id === val);
    if (!found) { setCustomerId(val); return; }

    if (val.startsWith("nexus:")) {
      setCustomerId(val);
      setSpesialisasi(found.spesialisasi);
      const fd = new FormData();
      fd.set("namaCustomer", found.namaCustomer);
      fd.set("spesialisasi", found.spesialisasi);
      fd.set("kodePI", kodePI);
      fd.set("kodeCustomer", found.kodeCustomer ?? "");
      const result = await createCustomerAction(fd);
      if (result.ok && result.customerId) {
        const realId = result.customerId;
        setCustomerList((prev) => prev.map((c) => (c.id === val ? { ...c, id: realId } : c)));
        setCustomerId(realId);
      } else {
        // Most likely: it was materialized locally a moment ago (race) or
        // already existed under a name/spesialisasi combo our dedup missed —
        // either way, re-fetch and match by name+spesialisasi to recover the
        // real id instead of leaving a synthetic, unusable one selected.
        const refreshed = await getCustomersByOutlet(kodePI);
        const real = refreshed.find((c) => !c.id.startsWith("nexus:")
          && c.namaCustomer === found.namaCustomer && c.spesialisasi === found.spesialisasi);
        setCustomerList(refreshed);
        if (real) {
          setCustomerId(real.id);
        } else {
          setCustomerId("");
          setError(result.error ?? "Gagal menyimpan data user dari Nexus.");
        }
      }
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

  function buildFormData(entry: ProdukEntry): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    fd.set("customerId", customerId);
    fd.set("kodePI", kodePI);
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", entry.hariKerjaBulan || dokterFields.hariKerjaBulan);

    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", entry.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", entry.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst > 0 ? perBulan / oldEst : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasErrors = !kodePI || !spesialisasi || !customerId || !dokterFields.periodeAwal
      || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12
      || !dokterFields.jenisPsSp
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
      try {
        for (let i = 0; i < validEntries.length; i++) {
          await addLineItemAction(poaId, buildFormData(validEntries[i]));
          setProgress({ done: i + 1, total: validEntries.length });
        }
        setProgress(null);
        onToast?.(`${validEntries.length} produk berhasil disimpan.`, "success");
        setTimeout(() => {
          if (onSuccess) onSuccess(); else window.location.reload();
        }, 1200);
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
                  Belum tau spesialisasinya? Langsung cari nama user aja — spesialisasi keisi otomatis.
                </span>
              )}
              {kodePI && !loadingCust && onAddNewCustomer && (
                <button type="button" onClick={onAddNewCustomer}
                  className="text-xs text-left font-medium"
                  style={{ color: "var(--color-blue)" }}>
                  {customerOptions.length === 0
                    ? "Belum ada user terdaftar di outlet ini — + Daftar User Baru"
                    : "Gak ketemu usernya? + Daftar User Baru"}
                </button>
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
                <span><span style={{ color: "var(--color-text-faint)" }}>Kategori:</span> {selectedCustomer.spesialisasi.toLowerCase().includes("spesialis") ? "Dokter Spesialis" : "Dokter Umum"}</span>
                {selectedCustomer.isFokus && <span style={{ color: "var(--color-blue)" }}>⭐ Rekomendasi PM</span>}
                {labelCustomer && <LabelCustomerBadge label={labelCustomer} />}
              </div>
            </>
          )}
        </div>

        {/* Rencana per dokter */}
        <DokterFieldsSection
          fields={dokterFields}
          onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          poaPeriod={poaPeriod}
          periodeAwalError={attempted && !dokterFields.periodeAwal}
          hariKerjaBulanError={attempted && !dokterFields.hariKerjaBulan}
          lamaPeriodeRequiredError={attempted && !dokterFields.lamaPeriode}
          jenisPsSpError={attempted && !dokterFields.jenisPsSp}
        />

        {/* Products */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)" }}>★</span> = Produk Fokus
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
          return (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Total Semua Produk
            </p>
            <div className="flex gap-6 flex-wrap items-start">
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Estimasi Sales</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{formatRp(totalEstimasi)}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{formatRp(Math.round(newPerMonth))}/bln</div>
              </div>
              {totalEstimasiFokus.count > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Produk Fokus</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalEstimasiFokus.total)}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{totalEstimasiFokus.count} produk fokus</div>
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
            </div>
            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-faint)" }}>
                Estimasi Qty & Growth vs PSSP per Produk {matchedPaketsForFokus.length > 0 && "(★ = Produk Fokus)"}
              </p>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "17.5%" }} />
                  <col style={{ width: "17.5%" }} />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--color-text-faint)" }}>
                    <th className="text-left font-medium pb-1">Produk</th>
                    <th className="text-right font-medium pb-1">Qty</th>
                    <th className="text-right font-medium pb-1">Estimasi</th>
                    <th className="text-right font-medium pb-1">Nilai PSSP</th>
                    <th className="text-right font-medium pb-1">Growth Estimasi</th>
                    <th className="text-right font-medium pb-1">Growth Pelunasan</th>
                  </tr>
                </thead>
                <tbody>
                  {produkList.filter((e) => !!e.kodeProduk).map((entry) => {
                    const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
                    if (!p) return null;
                    const qtyTotalUB = Math.round(qtyToUB(computeQtyTotal(entry, dokterFields), p));
                    const isFokus = getProductTier(p.namaProduk, matchedPaketsForFokus) === 0;
                    const estimasiTotal = computeEstimasi(entry, dokterFields, p);
                    const nilaiRPersen = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
                    const nilaiPSSP = nilaiRPersen != null
                      ? Math.round(estimasiTotal * nilaiRPersen * resolvePengaliNilaiR(entry.pengaliNilaiR))
                      : null;
                    // Per-product Growth Estimasi/Pelunasan — same formulas as the
                    // per-product calculator card above (ProdukEntryRow), just
                    // re-derived here since this table works off the whole
                    // produkList rather than one row's own local state.
                    const perBulanProduk = lama > 0 ? estimasiTotal / lama : 0;
                    const oldEstProduk = (psspHistory && psspHistory.length > 0)
                      ? computeLatestEstPerMonth(psspHistory, p.namaProduk) : null;
                    const growthEstimasiPct = (perBulanProduk > 0 && oldEstProduk != null && oldEstProduk > 0)
                      ? (perBulanProduk / oldEstProduk - 1) * 100 : null;
                    const pelunasanProduk = (psspHistory && psspHistory.length > 0)
                      ? computePelunasanAktual3BlnPerMonth(psspHistory, p.namaProduk) : null;
                    const growthPelunasanPct = (perBulanProduk > 0 && pelunasanProduk != null && pelunasanProduk > 0)
                      ? (perBulanProduk / pelunasanProduk - 1) * 100 : null;
                    return (
                      <tr key={entry.uid} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="py-1 pr-2 truncate" style={{ color: "var(--color-text-muted)" }}>
                          {isFokus && <span style={{ color: "var(--color-blue)" }}>★ </span>}
                          {p.namaProduk}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {qtyTotalUB > 0 ? `${qtyTotalUB.toLocaleString("id-ID")} UB` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {estimasiTotal > 0 ? formatRp(estimasiTotal) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {nilaiPSSP != null && nilaiPSSP > 0 ? formatRp(nilaiPSSP) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: growthEstimasiPct == null ? "var(--color-text-faint)" : growthEstimasiPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthEstimasiPct != null ? `${growthEstimasiPct >= 0 ? "+" : ""}${growthEstimasiPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: growthPelunasanPct == null ? "var(--color-text-faint)" : growthPelunasanPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthPelunasanPct != null ? `${growthPelunasanPct >= 0 ? "+" : ""}${growthPelunasanPct.toFixed(1)}%` : "—"}
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

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
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

// ─── AddDokterBaruPanel (daftarkan dokter baru ke database customer) ──────────
// Setelah terdaftar, dokter muncul di dropdown "Tambah Rencana POA".

function AddDokterBaruPanel({
  outlets, onCancel,
}: {
  outlets: OutletOption[]; onCancel: () => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [namaDokter, setNamaDokter] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [customerList, setCustomerList] = useState<CustomerOption[]>([]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!kodePI) return;
    getCustomersByOutlet(kodePI).then(setCustomerList);
  }, [kodePI]);

  const outletOptions = useMemo(() => [...outlets]
    .sort((a, b) => (isChainGroup(a.groupRS) ? 0 : 1) - (isChainGroup(b.groupRS) ? 0 : 1))
    .map((o) => ({
      value: o.kodePI,
      label: `${o.kodePI} - ${o.namaOutlet}`,
      sublabel: o.groupRS ?? "NON CHAIN",
    })), [outlets]);

  // Tagged with how many of this outlet's already-registered doctors fall in
  // each spesialisasi — helps catch an accidental duplicate registration
  // (2026-07-24 request, same as the main "Tambah Rencana POA" picker).
  const spesOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customerList) {
      const label = spesLabel(c.spesialisasi);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return ALL_SPESIALISASI_OPTIONS.map((o) => {
      const n = counts.get(o.label) ?? 0;
      return { ...o, sublabel: n > 0 ? `${n} dokter terdaftar` : undefined, _count: n };
    }).sort((a, b) => b._count - a._count);
  }, [customerList]);
  const selectedOutlet = outlets.find((o) => o.kodePI === kodePI);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasErrors = !kodePI || !namaDokter.trim() || !spesialisasi;
    if (hasErrors) {
      setAttempted(true);
      setTimeout(() => {
        const el = document.querySelector("[data-field-err]");
        (el as HTMLElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("namaCustomer", namaDokter.trim());
    fd.set("spesialisasi", spesialisasi);
    fd.set("kodePI", kodePI);
    startTransition(async () => {
      const result = await createCustomerAction(fd);
      if (result.ok) {
        setSuccess(true);
      } else {
        setError(result.error ?? "Gagal mendaftarkan dokter.");
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-xl border p-4 space-y-3"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-success, #16a34a)", borderWidth: 1.5 }}>
        <p className="text-sm font-semibold" style={{ color: "var(--color-success, #16a34a)" }}>
          ✓ User berhasil didaftarkan
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          <strong>{namaDokter}</strong> ({spesLabel(spesialisasi)}) sudah terdaftar di {selectedOutlet?.namaOutlet}.
          Sekarang bisa ditambahkan ke POA via &ldquo;Tambah Rencana POA&rdquo;.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary"
            onClick={() => { setSuccess(false); setNamaDokter(""); setSpesialisasi(""); setKodePI(""); }}>
            Daftar User Lain
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Selesai</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-warning, #f59e0b)", borderWidth: 1.5 }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Daftar User Baru</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          Daftarkan user ke database terlebih dahulu. Setelah terdaftar, pilih via &ldquo;Tambah Rencana POA&rdquo;.
        </p>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1"
            {...(attempted && !kodePI ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: attempted && !kodePI ? "var(--color-red)" : "var(--color-text-muted)" }}>
              Outlet<Req />
            </span>
            <div style={attempted && !kodePI ? ERR_RING : undefined}>
              <Combobox name="_outlet_reg" value={kodePI} onChange={setKodePI}
                placeholder="Cari outlet…" options={outletOptions} />
            </div>
            {attempted && !kodePI && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </div>
          <label className="flex flex-col gap-1"
            {...(attempted && !namaDokter.trim() ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: attempted && !namaDokter.trim() ? "var(--color-red)" : "var(--color-text-muted)" }}>
              Nama User<Req />
            </span>
            <input type="text" value={namaDokter}
              onChange={(e) => setNamaDokter(e.target.value)}
              placeholder="dr. Nama Lengkap"
              className="input-field"
              style={attempted && !namaDokter.trim() ? ERR_RING : undefined} />
            {attempted && !namaDokter.trim() && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          <label className="flex flex-col gap-1"
            {...(attempted && !spesialisasi ? { "data-field-err": "true" } : {})}>
            <span className="text-xs" style={{ color: attempted && !spesialisasi ? "var(--color-red)" : "var(--color-text-muted)" }}>
              Spesialisasi<Req />
            </span>
            <select value={spesialisasi}
              onChange={(e) => setSpesialisasi(e.target.value)}
              className="input-field"
              style={attempted && !spesialisasi ? ERR_RING : undefined}>
              <option value="">— Pilih —</option>
              {spesOptions.map(({ value, label, sublabel }) => (
                <option key={value} value={value}>{sublabel ? `${label} (${sublabel})` : label}</option>
              ))}
            </select>
            {attempted && !spesialisasi && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Mendaftarkan…" : "Daftarkan User"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── AddProductPanel (tambah produk ke dokter existing) ───────────────────────

function AddProductPanel({
  poaId, poaPeriod, products, kodePI, namaOutlet, kodeCust, namaCust, spesialisasi, defaultPeriode, onCancel,
}: {
  poaId: string; poaPeriod: string; products: Product[];
  kodePI: string; namaOutlet: string;
  kodeCust: string | null; namaCust: string; spesialisasi: string;
  defaultPeriode: string; onCancel: () => void;
}) {
  const [dokterFields, setDokterFields] = useState<DokterFields>(emptyDokterFields(defaultPeriode));
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);
  const [labelCustomer, setLabelCustomer] = useState("");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
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
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", entry.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    const totalBiayaAP = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiayaAP));
    const perBulanAP = dokterFields.lamaPeriode > 0 ? totalBiayaAP / dokterFields.lamaPeriode : 0;
    const oldEstAP = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasioAP = perBulanAP > 0 && oldEstAP && oldEstAP > 0 ? perBulanAP / oldEstAP : null;
    fd.set("rasioEstimasiGrowth", rasioAP != null ? rasioAP.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || !dokterFields.jenisPsSp
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
        />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)" }}>★</span> = Produk Fokus
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
  item: PoaLineItem, products: Product[], doctorDefaultHariKerja: string
): EditableProdukEntry {
  const p = products.find((pr) => pr.kodeProduk === item.kodeProduk);
  const itemHari = item.hariKerjaBulan?.toString() ?? "";
  const itemPengali = item.pengaliNilaiR?.toString() ?? "";
  return {
    uid: item.id,
    existingId: item.id,
    kodeProduk: item.kodeProduk,
    jumlahResepHari: item.jumlahResepHari?.toString() ?? "",
    qtyProdukResep: item.qtyProdukResep?.toString() ?? "",
    produkKompetitor: item.produkKompetitor ?? "",
    statusStandarisasi: item.statusStandarisasi ?? "",
    jenisPssp: item.jenisPssp ?? "",
    persenPsspDokter: p?.nilaiRPersen
      ? (parseFloat(p.nilaiRPersen) * 100).toFixed(2)
      : item.persenPsspDokter ? (parseFloat(item.persenPsspDokter.toString()) * 100).toFixed(2) : "",
    persenPsspKpdm: item.persenPsspKpdm ? (parseFloat(item.persenPsspKpdm.toString()) * 100).toFixed(2) : "",
    persenDiskon: item.persenDiskon ? (parseFloat(item.persenDiskon.toString()) * 100).toFixed(2) : "",
    persenDp: item.persenDp ? (parseFloat(item.persenDp.toString()) * 100).toFixed(2) : "",
    persenListingFee: item.persenListingFee ? (parseFloat(item.persenListingFee.toString()) * 100).toFixed(2) : "",
    persenEntertain: item.persenEntertain ? (parseFloat(item.persenEntertain.toString()) * 100).toFixed(2) : "",
    // Only surface Hari Praktek as an explicit override when it differs from the doctor's
    // default — Pengali Nilai R has no doctor-level default anymore, so it's always its own value.
    hariKerjaBulan: itemHari && itemHari !== doctorDefaultHariKerja ? itemHari : "",
    pengaliNilaiR: itemPengali,
    pihakPssp: item.pihakPssp ?? "USER",
  };
}

export function EditDoctorPanel({ items, poaId, poaPeriod, products, redirectTo }: {
  items: PoaLineItem[]; poaId: string; poaPeriod: string; products: Product[]; redirectTo: string;
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
    jenisPsSp: first.jenisPsSp ?? "",
  });
  const [produkList, setProdukList] = useState<EditableProdukEntry[]>(
    () => items.map((it) => produkEntryFromItem(it, products, first.hariKerjaBulan?.toString() ?? ""))
  );
  const [labelCustomer, setLabelCustomer] = useState(first.labelCustomer ?? "");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [diskonList, setDiskonList] = useState<DiskonByProduct[]>([]);
  const [diskonHistoryList, setDiskonHistoryList] = useState<DiskonHistoryByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
    getDiskonByOutlet(kodePI).then(setDiskonList);
    getDiskonHistoryByOutlet(kodePI).then(setDiskonHistoryList);
  }, [kodePI]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  const matchedPaketsForFokus = useMemo(
    () => spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [],
    [spesialisasi]
  );

  // Same total, filtered to products that are tier-0 (focus) for this doctor's spesialisasi.
  const totalEstimasiFokus = useMemo(() => {
    if (matchedPaketsForFokus.length === 0) return { total: 0, count: 0 };
    let total = 0, count = 0;
    for (const e of produkList) {
      const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
      if (!p || getProductTier(p.namaProduk, matchedPaketsForFokus) !== 0) continue;
      total += computeEstimasi(e, dokterFields, p);
      count++;
    }
    return { total, count };
  }, [produkList, dokterFields, products, matchedPaketsForFokus]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(e.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR);
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
    fd.set("produkKompetitor", entry.produkKompetitor);
    fd.set("labelCustomer", labelCustomer);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("jenisPssp", entry.jenisPssp);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("pihakPssp", entry.pihakPssp);
    fd.set("jenisPsSp", dokterFields.jenisPsSp);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", entry.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeLatestEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst > 0 ? perBulan / oldEst : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || !dokterFields.jenisPsSp
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
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Edit Rencana POA</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {namaCust} · {spesLabel(spesialisasi)} · {namaOutlet}
          </span>
          {labelCustomer && <LabelCustomerBadge label={labelCustomer} />}
        </div>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <DokterFieldsSection
          fields={dokterFields}
          onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          poaPeriod={poaPeriod}
          periodeAwalError={attempted && !dokterFields.periodeAwal}
          hariKerjaBulanError={attempted && !dokterFields.hariKerjaBulan}
          lamaPeriodeRequiredError={attempted && !dokterFields.lamaPeriode}
          jenisPsSpError={attempted && !dokterFields.jenisPsSp}
        />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span style={{ color: "var(--color-blue)" }}>★</span> = Produk Fokus
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
          return (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Total Semua Produk
            </p>
            <div className="flex gap-6 flex-wrap items-start">
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Estimasi Sales</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>{formatRp(totalEstimasi)}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{formatRp(Math.round(newPerMonth))}/bln</div>
              </div>
              {totalEstimasiFokus.count > 0 && (
                <div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Estimasi Produk Fokus</div>
                  <div className="text-xl font-bold" style={{ color: "var(--color-blue, #3b82f6)" }}>{formatRp(totalEstimasiFokus.total)}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{totalEstimasiFokus.count} produk fokus</div>
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
            </div>
            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-faint)" }}>
                Estimasi Qty & Growth vs PSSP per Produk {matchedPaketsForFokus.length > 0 && "(★ = Produk Fokus)"}
              </p>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "17.5%" }} />
                  <col style={{ width: "17.5%" }} />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--color-text-faint)" }}>
                    <th className="text-left font-medium pb-1">Produk</th>
                    <th className="text-right font-medium pb-1">Qty</th>
                    <th className="text-right font-medium pb-1">Estimasi</th>
                    <th className="text-right font-medium pb-1">Nilai PSSP</th>
                    <th className="text-right font-medium pb-1">Growth Estimasi</th>
                    <th className="text-right font-medium pb-1">Growth Pelunasan</th>
                  </tr>
                </thead>
                <tbody>
                  {produkList.filter((e) => !!e.kodeProduk).map((entry) => {
                    const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
                    if (!p) return null;
                    const qtyTotalUB = Math.round(qtyToUB(computeQtyTotal(entry, dokterFields), p));
                    const isFokus = getProductTier(p.namaProduk, matchedPaketsForFokus) === 0;
                    const estimasiTotal = computeEstimasi(entry, dokterFields, p);
                    const nilaiRPersen = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
                    const nilaiPSSP = nilaiRPersen != null
                      ? Math.round(estimasiTotal * nilaiRPersen * resolvePengaliNilaiR(entry.pengaliNilaiR))
                      : null;
                    // Per-product Growth Estimasi/Pelunasan — same formulas as the
                    // per-product calculator card above (ProdukEntryRow), just
                    // re-derived here since this table works off the whole
                    // produkList rather than one row's own local state.
                    const perBulanProduk = lama > 0 ? estimasiTotal / lama : 0;
                    const oldEstProduk = (psspHistory && psspHistory.length > 0)
                      ? computeLatestEstPerMonth(psspHistory, p.namaProduk) : null;
                    const growthEstimasiPct = (perBulanProduk > 0 && oldEstProduk != null && oldEstProduk > 0)
                      ? (perBulanProduk / oldEstProduk - 1) * 100 : null;
                    const pelunasanProduk = (psspHistory && psspHistory.length > 0)
                      ? computePelunasanAktual3BlnPerMonth(psspHistory, p.namaProduk) : null;
                    const growthPelunasanPct = (perBulanProduk > 0 && pelunasanProduk != null && pelunasanProduk > 0)
                      ? (perBulanProduk / pelunasanProduk - 1) * 100 : null;
                    return (
                      <tr key={entry.uid} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="py-1 pr-2 truncate" style={{ color: "var(--color-text-muted)" }}>
                          {isFokus && <span style={{ color: "var(--color-blue)" }}>★ </span>}
                          {p.namaProduk}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {qtyTotalUB > 0 ? `${qtyTotalUB.toLocaleString("id-ID")} UB` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {estimasiTotal > 0 ? formatRp(estimasiTotal) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                          {nilaiPSSP != null && nilaiPSSP > 0 ? formatRp(nilaiPSSP) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: growthEstimasiPct == null ? "var(--color-text-faint)" : growthEstimasiPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthEstimasiPct != null ? `${growthEstimasiPct >= 0 ? "+" : ""}${growthEstimasiPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums"
                          style={{ color: growthPelunasanPct == null ? "var(--color-text-faint)" : growthPelunasanPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                          {growthPelunasanPct != null ? `${growthPelunasanPct >= 0 ? "+" : ""}${growthPelunasanPct.toFixed(1)}%` : "—"}
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

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => router.push(redirectTo)}>Batal</Button>
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
  const [mode, setMode] = useState<"none" | "add" | "addBaru">(formOnly ? "add" : "none");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "info" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, type: "success" | "info" | "error" = "success") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // Show notice from URL (e.g. after duplicate-period redirect from createPoaAction)
  useEffect(() => {
    const notice = searchParams.get("notice");
    if (notice) showToast(notice, "info");
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
      const custKey = item.namaCust ?? "—";
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
          onCancel={formOnly ? undefined : () => setMode("none")}
          onSuccess={formOnly ? handleSuccess : () => { setMode("none"); window.location.reload(); }}
          onToast={showToast}
          onAddNewCustomer={() => setMode("addBaru")}
        />
      )}
      {mode === "addBaru" && (
        <AddDokterBaruPanel outlets={outlets} onCancel={() => setMode(formOnly ? "add" : "none")} />
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
