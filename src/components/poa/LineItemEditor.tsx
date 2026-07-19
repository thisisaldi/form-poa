"use client";

import { useState, useTransition, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { PoaLineItem } from "@prisma/client";
import type { Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { getSpesialisasiByOutlet, getCustomersByOutletSpesialisasi, createCustomerAction, getPsspHistory, getListingFeeHistory, getKriteriaByOutlet, getSales3BlnByOutlet, type CustomerOption, type PsspKontrakSummary, type ListingFeeKontrakSummary, type KriteriaByOutlet, type Sales3BlnByProduct } from "@/app/actions/customer";
import { computePeriodeAkhir, formatPeriode, formatPeriodeRange } from "@/lib/poaUtils";
import { spesLabel, SPESIALISASI_PM_LABEL } from "@/lib/spesialisasi";
import { getAllPakets, sortProductsBySpesialisasi, getPaketsBySpesialisasi, getProductTier } from "@/lib/paketProduk";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
  TIDAK_TAHU: "Tidak Tahu",
};


interface OutletOption { kodePI: string; namaOutlet: string; groupRS?: string | null }

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
  pengaliNilaiR: string;  // multiplier for nilai R per doctor (e.g. "1", "1.2")
}

function emptyDokterFields(periodeAwal = ""): DokterFields {
  return {
    periodeAwal, lamaPeriode: 3,
    hariKerjaBulan: "",
    rencanaVisitMinggu: "4",
    pengaliNilaiR: "1",
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
  persenPsspDokter: string;  // % as 0-100
  persenPsspKpdm: string;
  persenDiskon: string;
  persenDp: string;
  persenListingFee: string;
  persenEntertain: string;
  hariKerjaBulan: string;  // per-product override of the doctor-level default; "" = inherit
  pengaliNilaiR: string;   // per-product override of the doctor-level default; "" = inherit
  // kriteriaProduk & rasioEstimasiGrowth: auto (not user input)
}

function emptyProdukEntry(): ProdukEntry {
  return {
    uid: Math.random().toString(36).slice(2),
    kodeProduk: "", jumlahResepHari: "", qtyProdukResep: "",
    produkKompetitor: "", statusStandarisasi: "",
    // 0 until a product is picked — then populated with dummy defaults / auto-computed from DB
    persenPsspDokter: "", persenPsspKpdm: "0",
    persenDiskon: "0", persenDp: "0", persenListingFee: "0", persenEntertain: "0",
    hariKerjaBulan: "",
    pengaliNilaiR: "",
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
function resolvePengaliNilaiR(entryValue: string, doctorValue: string): number {
  if (entryValue.trim() !== "") {
    const n = parseFloat(entryValue);
    if (!isNaN(n)) return n;
  }
  if (doctorValue.trim() !== "") {
    const n = parseFloat(doctorValue);
    if (!isNaN(n)) return n;
  }
  return 1;
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

// Returns the per-month estimate from the most recent COMPLETED PSSP contract for a product.
// Matches by product name only (Procode ≠ Item Kode across systems).
// estBaris is the full-period total, divided by months to get per-month baseline.
function computeOldEstPerMonth(history: PsspKontrakSummary[], namaProduk: string): number | null {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const norm = namaProduk.toLowerCase().trim();
  // Only expired contracts, matched by name
  const rows = history.filter(
    (r) => r.nmProduk?.toLowerCase().trim() === norm && r.prdAkhir < currentPeriod
  );
  if (rows.length === 0) return null;
  const latest = rows[0]; // sorted desc by prdAkhir from query — most recent expired
  const sy = parseInt(latest.prdAwal.slice(0, 4)), sm = parseInt(latest.prdAwal.slice(4));
  const ey = parseInt(latest.prdAkhir.slice(0, 4)), em = parseInt(latest.prdAkhir.slice(4));
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return months > 0 && latest.estBaris > 0 ? latest.estBaris / months : null;
}

// Like computeOldEstPerMonth but includes active contracts too (for total-level growth card).
// Requires estBaris > 0 — active contracts often have estBaris = 0 before data is filled.
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
    return pct >= 80 ? "Akan Selesai, Pelunasan Bagus" : "Akan Selesai, Pelunasan Buruk";
  }
  const pct = allEst > 0 ? allLunas / allEst * 100 : 0;
  return pct >= 80 ? "Pernah PSSP, Pelunasan Bagus" : "Pernah PSSP, Pelunasan Buruk";
}

function LabelCustomerBadge({ label }: { label: string }) {
  const isNew = label === "Dokter Baru";
  const isGood = label.includes("Bagus");
  const isBad = label.includes("Buruk");
  const color = isNew
    ? "var(--color-blue)"
    : isGood ? "var(--color-success, #16a34a)"
    : isBad ? "var(--color-red)"
    : "var(--color-text-muted)";
  const bg = isNew
    ? "var(--color-blue-light, #eff6ff)"
    : isGood ? "var(--color-success-bg, #dcfce7)"
    : isBad ? "var(--color-red-light)"
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

function UnitInput({ value, onChange, unit, placeholder = "0" }: {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
  }

  return (
    <div className="flex items-stretch rounded-md overflow-hidden"
      style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
      <input type="text" inputMode="decimal" placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className="flex-1 min-w-0 w-0 px-2.5 py-1.5 text-sm outline-none"
        style={{ background: "transparent", color: "var(--color-text)" }} />
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

// Like UnitInput, plus up/down stepper buttons that bump the value by `step`.
function NumberStepperInput({ value, onChange, unit, placeholder = "0", step = 1, min }: {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
  step?: number;
  min?: number;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
  }

  function bump(delta: number) {
    const current = parseFloat(value) || 0;
    let next = Math.round((current + delta) * 100) / 100;
    if (min != null && next < min) next = min;
    onChange(String(next));
  }

  return (
    <div className="flex items-stretch rounded-md overflow-hidden"
      style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
      <input type="text" inputMode="decimal" placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className="flex-1 min-w-0 w-0 px-2.5 py-1.5 text-sm outline-none"
        style={{ background: "transparent", color: "var(--color-text)" }} />
      {unit && (
        <>
          <span style={{ width: 1, background: "var(--color-border-strong)" }} />
          <span className="flex items-center px-2 text-xs font-medium whitespace-nowrap"
            style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
            {unit}
          </span>
        </>
      )}
      <span style={{ width: 1, background: "var(--color-border-strong)" }} />
      <div className="flex flex-col" style={{ width: 18 }}>
        <button type="button" tabIndex={-1} onClick={() => bump(step)}
          className="flex-1 flex items-center justify-center leading-none"
          style={{ fontSize: 8, color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>▲</button>
        <span style={{ height: 1, background: "var(--color-border-strong)" }} />
        <button type="button" tabIndex={-1} onClick={() => bump(-step)}
          className="flex-1 flex items-center justify-center leading-none"
          style={{ fontSize: 8, color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>▼</button>
      </div>
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

function DokterFieldsSection({ fields, onChange, poaPeriod, periodeAwalError, hariKerjaBulanError, lamaPeriodeRequiredError }: {
  fields: DokterFields;
  onChange: (patch: Partial<DokterFields>) => void;
  poaPeriod: string;
  periodeAwalError?: boolean;
  hariKerjaBulanError?: boolean;
  lamaPeriodeRequiredError?: boolean;
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
                placeholder="22" />
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
        </div>
      </div>
    </div>
  );
}

// ─── buildProductOptions ────────────────────────────────────────────────────
// Shared product-picker options builder — tiers by spesialisasi match, tags paket fokus.

function buildProductOptions(products: Product[], spesialisasi: string | undefined, kriteriaMap?: Map<string, string>): ComboboxOption[] {
  const sorted = spesialisasi
    ? sortProductsBySpesialisasi(products, spesialisasi)
    : products;
  const matchedPakets = spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [];
  const TIER_LABEL = ["Produk Fokus Sesuai Spesialisasi", "Produk Fokus Lainnya", "Produk Lainnya"];
  return sorted.map((p) => {
    const allPakets = getAllPakets(p.namaProduk);
    const relevantPaket = allPakets.find((pk) => matchedPakets.includes(pk)) ?? allPakets[0] ?? null;
    const tier = getProductTier(p.namaProduk, matchedPakets);
    const kriteria = kriteriaMap?.get(p.kodeProduk);
    const tagColor: "blue" | "yellow" | "red" | undefined = kriteria?.startsWith("Produk Sudah Terstandarisasi")
      ? "yellow"
      : kriteria?.startsWith("Produk Kompetisi Rendah")
      ? "blue"
      : kriteria?.startsWith("Produk Kompetisi Tinggi")
      ? "red"
      : undefined;
    const paketLabel = relevantPaket ?? p.namaGroupBrand;
    return {
      value: p.kodeProduk,
      label: p.namaProduk,
      sublabel: `${p.kodeProduk} · ${paketLabel}`,
      group: spesialisasi ? TIER_LABEL[tier] : allPakets.length > 0 ? "Produk Fokus" : "Produk Lainnya",
      accent: tier === 0,
      tag: kriteria,
      tagColor,
    };
  });
}

// ─── ProdukEntryRow ───────────────────────────────────────────────────────────
// Per-product: product picker + resep/hari + qty/resep + status + grey calculator

function ProdukEntryRow({
  entry, index, products, dokterFields, spesialisasi, psspHistory, sales3Bln, kriteriaList, usedKodeProduk, onChange, onRemove, showRemove, showError,
}: {
  entry: ProdukEntry;
  index: number;
  products: Product[];
  dokterFields: DokterFields;
  spesialisasi?: string;
  psspHistory?: PsspKontrakSummary[];
  /** Actual sales qty for the last 3 completed months, per product, at this outlet. */
  sales3Bln?: Sales3BlnByProduct[];
  kriteriaList?: KriteriaByOutlet[];
  /** kodeProduk values already used by OTHER rows for this same doctor — excluded from the picker. */
  usedKodeProduk?: Set<string>;
  onChange: (patch: Partial<ProdukEntry>) => void;
  onRemove: () => void;
  showRemove: boolean;
  showError?: boolean;
}) {
  const kriteriaMap = useMemo(() => {
    const m = new Map<string, string>(); // kodeProduk → kriteriaBaru
    for (const k of kriteriaList ?? []) m.set(k.kodeProduk, k.kriteriaBaru);
    return m;
  }, [kriteriaList]);

  const productOptions = useMemo(() => {
    const opts = buildProductOptions(products, spesialisasi, kriteriaMap);
    if (!usedKodeProduk || usedKodeProduk.size === 0) return opts;
    return opts.filter((o) => o.value === entry.kodeProduk || !usedKodeProduk.has(o.value));
  }, [products, spesialisasi, kriteriaMap, usedKodeProduk, entry.kodeProduk]);

  const product = useMemo(() => products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null, [products, entry.kodeProduk]);

  const resep  = parseFloat(entry.jumlahResepHari) || 0;
  const qty    = parseFloat(entry.qtyProdukResep) || 0;
  const hari   = parseFloat(entry.hariKerjaBulan) || parseFloat(dokterFields.hariKerjaBulan) || 0;
  const hna    = product ? hargaST(product) : 0;  // price per ST
  const lama   = dokterFields.lamaPeriode || 1;
  const nilaiRPersen = product?.nilaiRPersen ? parseFloat(product.nilaiRPersen) : null;
  const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR, dokterFields.pengaliNilaiR);
  const canCalc = resep > 0 && qty > 0 && hari > 0 && hna > 0;
  const perBulan = canCalc ? Math.round(resep * qty * hari * hna) : null;
  const totalEst = perBulan != null ? perBulan * lama : null;
  const qtyPerBulan = canCalc ? Math.round(resep * qty * hari) : null;
  const qtyTotal = qtyPerBulan != null ? qtyPerBulan * lama : null;
  const satuanQty = product?.satuanTerkecil ?? product?.satuan ?? "";
  const nilaiPSSPBulan = perBulan != null && nilaiRPersen != null ? Math.round(perBulan * nilaiRPersen * pengaliNilaiR) : null;
  const nilaiPSSPTotal = nilaiPSSPBulan != null ? nilaiPSSPBulan * lama : null;

  const oldEstPerMonth = (psspHistory && psspHistory.length > 0 && product)
    ? computeOldEstPerMonth(psspHistory, product.namaProduk)
    : null;
  const growthRatio = (perBulan != null && oldEstPerMonth != null && oldEstPerMonth > 0)
    ? perBulan / oldEstPerMonth
    : null;
  const growthPct = growthRatio != null ? (growthRatio - 1) * 100 : null;

  // Additional Growth PSSP metric based on actual sales qty from the last 3 completed
  // months (separate from — not a replacement for — the PSSP-contract-based growth above).
  const qty3Bln = product ? (sales3Bln?.find((s) => s.itemKode === product.kodeProduk)?.qty3Bln ?? 0) : 0;
  const estValue3BlnPerMonth = qty3Bln > 0 && hna > 0 ? (qty3Bln / 3) * hna : null;
  const growthPct3Bln = (perBulan != null && estValue3BlnPerMonth != null && estValue3BlnPerMonth > 0)
    ? ((perBulan / estValue3BlnPerMonth) - 1) * 100
    : null;

  const produkErr = showError && !entry.kodeProduk;
  const resepErr = showError && !entry.jumlahResepHari;
  const qtyErr = showError && !entry.qtyProdukResep;

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
                const prod = products.find((p) => p.kodeProduk === v);
                const nr = prod?.nilaiRPersen ? parseFloat(prod.nilaiRPersen) : null;
                const kriteria = kriteriaMap.get(v);
                const autoStandarisasi = kriteria
                  ? (kriteria.startsWith("Produk Sudah Terstandarisasi") ? "SUDAH_STANDARISASI" : "BELUM_STANDARISASI")
                  : entry.statusStandarisasi;
                onChange({
                  kodeProduk: v,
                  persenPsspDokter: nr != null ? (nr * 100).toFixed(2) : "",
                  statusStandarisasi: autoStandarisasi,
                  // Dummy defaults once a product is picked — akan diganti data asli kalau sudah ada sumbernya
                  persenDiskon: v ? "10" : "0",
                  persenListingFee: v ? "2.5" : "0",
                  persenEntertain: v ? "2.5" : "0",
                });
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

      {/* Produk Kompetitor */}
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor yang dipakai User<Opt /></span>
        <input type="text" placeholder="Nama produk kompetitor yang digunakan user"
          value={entry.produkKompetitor}
          onChange={(e) => onChange({ produkKompetitor: e.target.value })}
          className="input-field text-xs" />
      </label>

      {/* Per-product inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <label className="flex flex-col gap-1" {...(resepErr ? { "data-field-err": "true" } : {})}>
          <span className="text-xs" style={{ color: resepErr ? "var(--color-red)" : "var(--color-text-muted)" }}>Pasien Baru / Hari<Req /></span>
          <div style={resepErr ? ERR_RING : undefined}>
            <UnitInput
              value={entry.jumlahResepHari}
              onChange={(v) => onChange({ jumlahResepHari: v })}
              unit="Resep"
              placeholder="3" />
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
              placeholder="1" />
          </div>
          {qtyErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
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
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Praktek<Opt /></span>
          <UnitInput
            value={entry.hariKerjaBulan}
            onChange={(v) => onChange({ hariKerjaBulan: v })}
            unit="Hari"
            placeholder={dokterFields.hariKerjaBulan || "default"} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R<Opt /></span>
          <UnitInput
            value={entry.pengaliNilaiR}
            onChange={(v) => onChange({ pengaliNilaiR: v })}
            unit="x"
            placeholder={dokterFields.pengaliNilaiR || "1"} />
        </label>
      </div>

      {/* Estimasi Sales card */}
      {perBulan != null && (
        <div className="rounded-lg border px-3 py-2.5 space-y-2"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
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
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Qty / Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {qtyPerBulan != null ? `${qtyPerBulan.toLocaleString("id-ID")} ${satuanQty}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Qty {lama} Bln</div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>
                {qtyTotal != null ? `${qtyTotal.toLocaleString("id-ID")} ${satuanQty}` : "—"}
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
              <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth PSSP (3 Bln Terakhir)</div>
              {estValue3BlnPerMonth != null && (
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  Actual {formatRp(Math.round(estValue3BlnPerMonth))}/bln
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
                Belum ada data sales 3 bln
              </span>
            )}
          </div>
        </div>
      )}

      {/* Nilai PSSP card — shown when estimasi is filled AND product has nilaiRPersen */}
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
    [entry.persenPsspKpdm, entry.persenDiskon,
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
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>% PSSP Dokter (Nilai R)</span>
          <div style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <UnitInput value={entry.persenPsspDokter} onChange={() => {}} unit="%" />
          </div>
        </label>
        {numInput("% PSSP KPDM", "persenPsspKpdm")}
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

function PsspHistoryPanel({ kodeCustomer, onLabel, onHistory }: {
  kodeCustomer: string;
  onLabel?: (label: string) => void;
  onHistory?: (rows: PsspKontrakSummary[]) => void;
}) {
  const [history, setHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const rows = await getPsspHistory(kodeCustomer);
      setHistory(rows);
      onLabel?.(computeLabelCustomer(rows));
      onHistory?.(rows);
    });
  }, [kodeCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || history === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat histori PSSP…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada histori PSSP untuk dokter ini.{" "}
        <span className="font-mono" style={{ opacity: 0.6 }}>({kodeCustomer})</span>
      </div>
    );
  }

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

  function ContractCard({ cUrut, rows }: { cUrut: string; rows: PsspKontrakSummary[] }) {
    const first = rows[0];
    const biaya    = first.biaya;
    const sumEst   = rows.reduce((s, r) => s + r.estBaris, 0);
    const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
    const pct = sumEst > 0 ? Math.round((sumLunas / sumEst) * 100) : null;
    const pctColor = pct == null ? "var(--color-text-faint)"
      : pct >= 80 ? "var(--color-success, #16a34a)"
      : pct >= 40 ? "var(--color-warning, #f59e0b)"
      : "var(--color-red)";

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
            </div>
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: pctColor }}>
            {pct != null ? `${pct}%` : "—"}
          </span>
        </div>
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
        <div className="space-y-0.5 pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
          {rows.map((r) => {
            const rowPct = r.estBaris > 0 ? Math.round((r.totalLunas / r.estBaris) * 100) : null;
            return (
              <div key={r.id} className="flex items-center justify-between text-xs gap-2">
                <span style={{ color: "var(--color-text-muted)" }} className="truncate min-w-0">{r.nmProduk ?? r.kdProduk}</span>
                <span className="shrink-0 tabular-nums text-right" style={{ color: "var(--color-text-faint)" }}>
                  {formatRp(r.totalLunas)}
                  {rowPct != null && (
                    <span className="ml-1" style={{ color: rowPct >= 80 ? "var(--color-success, #16a34a)" : rowPct >= 40 ? "var(--color-warning, #f59e0b)" : "var(--color-red)" }}>
                      ({rowPct}%)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-blue)" }}>
            Aktif ({activeContracts.length})
          </p>
          {activeContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} />)}
        </div>
      )}
      {expiredContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            Selesai ({expiredContracts.length})
          </p>
          {expiredContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} />)}
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
}: {
  spesialisasi: string;
  produkList: ProdukEntry[];
  products: Product[];
}) {
  const matchedPakets = getPaketsBySpesialisasi(spesialisasi);
  if (matchedPakets.length === 0) return null;

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
        {missing.map((p) => (
          <li key={p.kodeProduk} className="text-xs px-2 py-1.5 rounded"
            style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
            {p.namaProduk}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── PsspSidebar ─────────────────────────────────────────────────────────────
// Fixed right-side panel showing PSSP history for the currently-selected doctor.
// Freezes on scroll (position:fixed), collapsible to a thin tab.

function PsspSidebar({
  kodeCustomer,
  doctorName,
  onLabel,
  onHistory,
  spesialisasi,
  produkList,
  products,
}: {
  kodeCustomer: string;
  doctorName?: string;
  onLabel?: (label: string) => void;
  onHistory?: (rows: PsspKontrakSummary[]) => void;
  spesialisasi?: string;
  produkList?: ProdukEntry[];
  products?: Product[];
}) {
  const [open, setOpen] = useState(true);
  const [label, setLabel] = useState("");

  function handleLabel(l: string) {
    setLabel(l);
    onLabel?.(l);
  }

  if (!open) {
    return (
      <div style={{ position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 40 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "18px 10px", gap: 2,
            background: "var(--color-blue)",
            border: "1px solid var(--color-blue)", borderRight: "none",
            borderRadius: "8px 0 0 8px",
            color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            writingMode: "vertical-rl", letterSpacing: "0.05em",
          }}>
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
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-faint)" }}>
            Histori PSSP
          </p>
          {doctorName && (
            <p className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginTop: 1 }}>
              {doctorName}
            </p>
          )}
          {label && <div style={{ marginTop: 4 }}><LabelCustomerBadge label={label} /></div>}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ color: "var(--color-text-faint)", fontSize: 18, lineHeight: 1, padding: "0 2px", cursor: "pointer", flexShrink: 0 }}>
          ›
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-4">
        {spesialisasi && produkList && products && (
          <ProdukFokusPanel spesialisasi={spesialisasi} produkList={produkList} products={products} />
        )}
        <PsspHistoryPanel kodeCustomer={kodeCustomer} onLabel={handleLabel} onHistory={onHistory} />
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
            Histori Listing Fee
          </p>
          <ListingFeeHistoryPanel kodeCustomer={kodeCustomer} />
        </div>
      </div>
    </div>
  );
}

// ─── AddPanel (new dokter + multi-produk) ─────────────────────────────────────

function AddPanel({
  poaId, poaPeriod, outlets, products, onCancel, onSuccess, onToast,
}: {
  poaId: string; poaPeriod: string; outlets: OutletOption[]; products: Product[];
  onCancel?: () => void;
  onSuccess?: () => void;
  onToast?: (msg: string, type?: "success" | "error") => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [specList, setSpecList] = useState<string[]>([]);
  const [customerList, setCustomerList] = useState<CustomerOption[]>([]);
  const [loadingSpec, startLoadSpec] = useTransition();
  const [loadingCust, startLoadCust] = useTransition();

  const [dokterFields, setDokterFields] = useState<DokterFields>(emptyDokterFields(""));
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);
  const [labelCustomer, setLabelCustomer] = useState("");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [sales3Bln, setSales3Bln] = useState<Sales3BlnByProduct[]>([]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  const outletOptions = useMemo(() => outlets.map((o) => ({
    value: o.kodePI,
    label: `${o.kodePI} - ${o.namaOutlet}`,
    sublabel: o.groupRS ?? "NON CHAIN",
  })), [outlets]);
  const specOptions = useMemo(() => specList.map((s) => ({ value: s, label: spesLabel(s) })), [specList]);
  const customerOptions = useMemo(() => customerList.map((c) => ({
    value: c.id, label: c.namaCustomer,
    sublabel: c.isFokus ? "⭐ Rekomendasi PM" : undefined,
  })), [customerList]);

  const selectedCustomer = useMemo(() => customerList.find((c) => c.id === customerId) ?? null, [customerList, customerId]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(e.pengaliNilaiR, dokterFields.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // Sum of latest PSSP per-month estimates across all filled products (active + expired)
  const totalOldEstPerMonth = useMemo(() => {
    if (!psspHistory || psspHistory.length === 0) return null;
    let sum = 0; let hasAny = false;
    for (const entry of produkList) {
      if (!entry.kodeProduk) continue;
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
      if (!p) continue;
      const old = computeLatestEstPerMonth(psspHistory, p.namaProduk);
      if (old == null) continue;
      sum += old; hasAny = true;
    }
    return hasAny ? sum : null;
  }, [produkList, products, psspHistory]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR, dokterFields.pengaliNilaiR);
      const pct = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR
        + [entry.persenPsspKpdm, entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
          .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
      budgetWeighted += base * pct;
      estTotal += base;
    }
    return estTotal > 0 ? budgetWeighted / estTotal : null;
  }, [produkList, dokterFields, products]);

  function handleOutletChange(val: string) {
    setKodePI(val); setSpesialisasi(""); setCustomerId("");
    setSpecList([]); setCustomerList([]); setKriteriaList([]); setSales3Bln([]);
    if (!val) return;
    startLoadSpec(async () => {
      const [specs, kriteria, sales3BlnData] = await Promise.all([
        getSpesialisasiByOutlet(val),
        getKriteriaByOutlet(val),
        getSales3BlnByOutlet(val),
      ]);
      setSpecList(specs);
      setKriteriaList(kriteria);
      setSales3Bln(sales3BlnData);
    });
  }

  function handleSpecChange(val: string) {
    setSpesialisasi(val); setCustomerId(""); setCustomerList([]);
    if (!val || !kodePI) return;
    startLoadCust(async () => setCustomerList(await getCustomersByOutletSpesialisasi(kodePI, val)));
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
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", entry.pengaliNilaiR || dokterFields.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeOldEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst > 0 ? perBulan / oldEst : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasErrors = !kodePI || !spesialisasi || !customerId || !dokterFields.periodeAwal
      || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12
      || produkList.some((p) => !p.kodeProduk || !p.jumlahResepHari || !p.qtyProdukResep);
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
                Spesialisasi<Req /> {loadingSpec && <span style={{ color: "var(--color-text-faint)" }}>…</span>}
              </span>
              <div style={attempted && !spesialisasi ? ERR_RING : undefined}>
                <Combobox name="_spesialisasi" value={spesialisasi} onChange={handleSpecChange}
                  placeholder={kodePI ? (loadingSpec ? "Memuat…" : "Pilih spesialisasi") : "Pilih outlet dulu"}
                  disabled={!kodePI || loadingSpec} options={specOptions} />
              </div>
              {attempted && !spesialisasi && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            </div>
            <div className="flex flex-col gap-1"
              {...(attempted && !customerId ? { "data-field-err": "true" } : {})}>
              <span className="text-xs" style={{ color: attempted && !customerId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                User<Req /> {loadingCust && <span style={{ color: "var(--color-text-faint)" }}>…</span>}
              </span>
              <div style={attempted && !customerId ? ERR_RING : undefined}>
                <Combobox name="_dokter" value={customerId} onChange={setCustomerId}
                  placeholder={spesialisasi ? (loadingCust ? "Memuat…" : "Pilih user") : "Pilih spesialisasi dulu"}
                  disabled={!spesialisasi || loadingCust} options={customerOptions} />
              </div>
              {attempted && !customerId && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
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
                sales3Bln={sales3Bln}
                kriteriaList={kriteriaList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
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
          const growthPct = totalOldEstPerMonth != null && totalOldEstPerMonth > 0
            ? (newPerMonth / totalOldEstPerMonth - 1) * 100 : null;
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
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Growth vs PSSP</div>
                {growthPct != null ? (
                  <>
                    <div className="text-xl font-bold"
                      style={{ color: growthPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      PSSP lama {formatRp(Math.round(totalOldEstPerMonth! * lama))}/{lama}bln
                    </div>
                  </>
                ) : (
                  <div className="text-sm mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                    {psspHistory === null ? "Memuat…" : psspHistory.length === 0 ? "Tidak ada histori PSSP" : "Belum ada data PSSP"}
                  </div>
                )}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R (default)</span>
              <div style={{ maxWidth: 120 }}>
                <NumberStepperInput
                  value={dokterFields.pengaliNilaiR}
                  onChange={(v) => setDokterFields((prev) => ({ ...prev, pengaliNilaiR: v }))}
                  unit="%"
                  placeholder="1"
                  step={0.1}
                  min={0} />
              </div>
            </label>
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
      {selectedCustomer?.kodeCustomer && (
        <PsspSidebar
          kodeCustomer={selectedCustomer.kodeCustomer}
          doctorName={selectedCustomer.namaCustomer}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
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
  const [isFokus, setIsFokus] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const outletOptions = useMemo(() => outlets.map((o) => ({
    value: o.kodePI,
    label: `${o.kodePI} - ${o.namaOutlet}`,
    sublabel: o.groupRS ?? "NON CHAIN",
  })), [outlets]);

  const spesOptions = Object.entries(SPESIALISASI_PM_LABEL).map(([db, pm]) => ({ value: db, label: pm }));
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
    fd.set("isFokus", isFokus ? "true" : "false");
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
            onClick={() => { setSuccess(false); setNamaDokter(""); setSpesialisasi(""); setKodePI(""); setIsFokus(false); }}>
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
              {spesOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {attempted && !spesialisasi && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isFokus}
            onChange={(e) => setIsFokus(e.target.checked)}
            className="rounded" />
          <span style={{ color: "var(--color-text-muted)" }}>
            Termasuk Rekomendasi PM
          </span>
        </label>

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
  const [sales3Bln, setSales3Bln] = useState<Sales3BlnByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
    getSales3BlnByOutlet(kodePI).then(setSales3Bln);
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
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    const totalBiayaAP = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiayaAP));
    const perBulanAP = dokterFields.lamaPeriode > 0 ? totalBiayaAP / dokterFields.lamaPeriode : 0;
    const oldEstAP = (product && psspHistory && psspHistory.length > 0) ? computeOldEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasioAP = perBulanAP > 0 && oldEstAP && oldEstAP > 0 ? perBulanAP / oldEstAP : null;
    fd.set("rasioEstimasiGrowth", rasioAP != null ? rasioAP.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || validEntries.some((e) => !e.jumlahResepHari || !e.qtyProdukResep);
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
                sales3Bln={sales3Bln}
                kriteriaList={kriteriaList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
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
      {kodeCust && (
        <PsspSidebar
          kodeCustomer={kodeCust}
          doctorName={namaCust}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
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
  item: PoaLineItem, products: Product[], doctorDefaultHariKerja: string, doctorDefaultPengaliNilaiR: string
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
    persenPsspDokter: p?.nilaiRPersen
      ? (parseFloat(p.nilaiRPersen) * 100).toFixed(2)
      : item.persenPsspDokter ? (parseFloat(item.persenPsspDokter.toString()) * 100).toFixed(2) : "",
    persenPsspKpdm: item.persenPsspKpdm ? (parseFloat(item.persenPsspKpdm.toString()) * 100).toFixed(2) : "",
    persenDiskon: item.persenDiskon ? (parseFloat(item.persenDiskon.toString()) * 100).toFixed(2) : "",
    persenDp: item.persenDp ? (parseFloat(item.persenDp.toString()) * 100).toFixed(2) : "",
    persenListingFee: item.persenListingFee ? (parseFloat(item.persenListingFee.toString()) * 100).toFixed(2) : "",
    persenEntertain: item.persenEntertain ? (parseFloat(item.persenEntertain.toString()) * 100).toFixed(2) : "",
    // Only surface as an explicit override when it actually differs from the doctor's default.
    hariKerjaBulan: itemHari && itemHari !== doctorDefaultHariKerja ? itemHari : "",
    pengaliNilaiR: itemPengali && itemPengali !== doctorDefaultPengaliNilaiR ? itemPengali : "",
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

  const doctorDefaultPengaliNilaiR = first.pengaliNilaiR ? first.pengaliNilaiR.toString() : "1";
  const [dokterFields, setDokterFields] = useState<DokterFields>({
    periodeAwal: first.periodeAwal,
    lamaPeriode: first.lamaPeriode,
    hariKerjaBulan: first.hariKerjaBulan?.toString() ?? "",
    rencanaVisitMinggu: first.rencanaVisitMinggu.toString(),
    pengaliNilaiR: doctorDefaultPengaliNilaiR,
  });
  const [produkList, setProdukList] = useState<EditableProdukEntry[]>(
    () => items.map((it) => produkEntryFromItem(it, products, first.hariKerjaBulan?.toString() ?? "", doctorDefaultPengaliNilaiR))
  );
  const [labelCustomer, setLabelCustomer] = useState(first.labelCustomer ?? "");
  const [psspHistory, setPsspHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [kriteriaList, setKriteriaList] = useState<KriteriaByOutlet[]>([]);
  const [sales3Bln, setSales3Bln] = useState<Sales3BlnByProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    getKriteriaByOutlet(kodePI).then(setKriteriaList);
    getSales3BlnByOutlet(kodePI).then(setSales3Bln);
  }, [kodePI]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  const totalNilaiPSSP = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    if (!p) return sum;
    const nilaiR = p.nilaiRPersen ? parseFloat(p.nilaiRPersen) : null;
    if (nilaiR == null) return sum;
    const pengali = resolvePengaliNilaiR(e.pengaliNilaiR, dokterFields.pengaliNilaiR);
    return sum + Math.round(computeEstimasi(e, dokterFields, p) * nilaiR * pengali);
  }, 0), [produkList, dokterFields, products]);

  // Sum of latest PSSP per-month estimates across all filled products (active + expired)
  const totalOldEstPerMonth = useMemo(() => {
    if (!psspHistory || psspHistory.length === 0) return null;
    let sum = 0; let hasAny = false;
    for (const entry of produkList) {
      if (!entry.kodeProduk) continue;
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk);
      if (!p) continue;
      const old = computeLatestEstPerMonth(psspHistory, p.namaProduk);
      if (old == null) continue;
      sum += old; hasAny = true;
    }
    return hasAny ? sum : null;
  }, [produkList, products, psspHistory]);

  // % Budget across all products, weighted by each product's own estimasi (mirrors detail-page calc)
  const totalPctBudget = useMemo(() => {
    let budgetWeighted = 0, estTotal = 0;
    for (const entry of produkList) {
      const p = products.find((pr) => pr.kodeProduk === entry.kodeProduk) ?? null;
      const base = computeEstimasi(entry, dokterFields, p);
      if (base <= 0) continue;
      const pengaliNilaiR = resolvePengaliNilaiR(entry.pengaliNilaiR, dokterFields.pengaliNilaiR);
      const pct = (parseFloat(entry.persenPsspDokter) || 0) * pengaliNilaiR
        + [entry.persenPsspKpdm, entry.persenDiskon, entry.persenDp, entry.persenListingFee, entry.persenEntertain]
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
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("pengaliNilaiR", entry.pengaliNilaiR || dokterFields.pengaliNilaiR);
    const totalBiaya = computeEstimasi(entry, dokterFields, product);
    fd.set("rencanaTotalBiaya", String(totalBiaya));
    const perBulan = dokterFields.lamaPeriode > 0 ? totalBiaya / dokterFields.lamaPeriode : 0;
    const oldEst = (product && psspHistory && psspHistory.length > 0) ? computeOldEstPerMonth(psspHistory, product.namaProduk) : null;
    const rasio = perBulan > 0 && oldEst && oldEst > 0 ? perBulan / oldEst : null;
    fd.set("rasioEstimasiGrowth", rasio != null ? rasio.toFixed(4) : "");
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    const hasErrors = !dokterFields.periodeAwal || !!periodeAwalFormatError(dokterFields.periodeAwal, poaPeriod)
      || !dokterFields.hariKerjaBulan || !dokterFields.lamaPeriode || dokterFields.lamaPeriode > 12 || validEntries.length === 0
      || validEntries.some((e) => !e.jumlahResepHari || !e.qtyProdukResep);
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
                sales3Bln={sales3Bln}
                kriteriaList={kriteriaList}
                usedKodeProduk={new Set(produkList.filter((_, idx) => idx !== i).map((e) => e.kodeProduk).filter(Boolean))}
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
          const growthPct = totalOldEstPerMonth != null && totalOldEstPerMonth > 0
            ? (newPerMonth / totalOldEstPerMonth - 1) * 100 : null;
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
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Growth vs PSSP</div>
                {growthPct != null ? (
                  <>
                    <div className="text-xl font-bold"
                      style={{ color: growthPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}>
                      {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      PSSP lama {formatRp(Math.round(totalOldEstPerMonth! * lama))}/{lama}bln
                    </div>
                  </>
                ) : (
                  <div className="text-sm mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                    {psspHistory === null ? "Memuat…" : psspHistory.length === 0 ? "Tidak ada histori PSSP" : "Belum ada data PSSP"}
                  </div>
                )}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R (default)</span>
              <div style={{ maxWidth: 120 }}>
                <NumberStepperInput
                  value={dokterFields.pengaliNilaiR}
                  onChange={(v) => setDokterFields((prev) => ({ ...prev, pengaliNilaiR: v }))}
                  unit="%"
                  placeholder="1"
                  step={0.1}
                  min={0} />
              </div>
            </label>
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
      {kodeCust && (
        <PsspSidebar
          kodeCustomer={kodeCust}
          doctorName={namaCust}
          onLabel={setLabelCustomer}
          onHistory={setPsspHistory}
          spesialisasi={spesialisasi}
          produkList={produkList}
          products={products}
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
        />
      )}
      {mode === "addBaru" && (
        <AddDokterBaruPanel outlets={outlets} onCancel={() => setMode("none")} />
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
