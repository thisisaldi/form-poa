"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import type { PoaLineItem, PoaStatus } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { spesLabel } from "@/lib/spesialisasi";
import { getAllPakets } from "@/lib/paketProduk";
import { submitPoaWithSelectionAction } from "@/app/actions/poa";
import { deleteLineItemAction } from "@/app/actions/lineItem";
import { quarterToMonths } from "@/lib/quarterUtils";
import type { ActivePsspRow } from "@/app/actions/customer";
import { computeActivePsspStats, apportion } from "@/lib/activePssp";
import { LabelCustomerBadge } from "@/components/poa/LineItemEditor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

// Nilai PSSP displays in "Rb" (e.g. 3.000.000 → "3 Rb").
export function formatRpPssp(n: number) {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000).toLocaleString("id-ID")} Rb`;
  return Math.round(n).toLocaleString("id-ID");
}

// Masks a doctor's name for the draft view: keeps every other character, replaces the rest with X.
function censorName(name: string): string {
  return name
    .toUpperCase()
    .split(" ")
    .map((word) => [...word].map((ch, i) => (i % 2 === 0 ? ch : "X")).join(""))
    .join(" ");
}

export function toNum(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
  TIDAK_TAHU: "Tidak Tahu",
};

export function doctorKey(item: PoaLineItem): string {
  return `${item.kodePI ?? ""}|${item.namaCust}`;
}

/**
 * "Biaya Tercacah" — apportions a line item's total Estimasi / Nilai PSSP to
 * however many of its plan months fall inside the POA's own quarter. E.g. a
 * 6-month plan starting 202607 overlaps 3 months of a 2026-Q3 POA (Jul-Sep) →
 * counts 3/6 of the total; starting 202608 overlaps only Aug-Sep → 2/6.
 */
function computeBiayaTercacah(item: PoaLineItem, quarterMonths: string[]): { estimasi: number; nilaiPssp: number } {
  const lama = item.lamaPeriode || 0;
  if (lama <= 0 || !item.periodeAwal || item.periodeAwal.length !== 6) return { estimasi: 0, nilaiPssp: 0 };

  const startYear = parseInt(item.periodeAwal.slice(0, 4), 10);
  const startMonth = parseInt(item.periodeAwal.slice(4, 6), 10);
  let overlapCount = 0;
  for (let i = 0; i < lama; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (quarterMonths.includes(yyyymm)) overlapCount++;
  }
  if (overlapCount === 0) return { estimasi: 0, nilaiPssp: 0 };

  const totalBiaya = toNum(item.rencanaTotalBiaya);
  const estimasi = (totalBiaya / lama) * overlapCount;

  const persenPsspDokter = toNum(item.persenPsspDokter); // stored as a fraction, e.g. 0.05 for 5%
  const pengaliNilaiR = item.pengaliNilaiR != null ? toNum(item.pengaliNilaiR) : 1;
  const nilaiPsspTotal = totalBiaya * persenPsspDokter * pengaliNilaiR;
  const nilaiPssp = (nilaiPsspTotal / lama) * overlapCount;

  return { estimasi, nilaiPssp };
}

// ─── Dummy data (deterministik, ganti saat data aktual tersedia) ──────────────

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Shared by the real (DraftChecklist, from getMrSalesSummary) and still-dummy
// (ApprovalsChecklist, bulk multi-MR view — see computeDummySales below)
// "Data Sales" figures, so StatsPanel renders both without needing to know
// which one it got.
export interface SalesFigures {
  historisTahunLalu: number;
  historisTahunLaluLabel: string;
  salesYtd: number;
  growthPct: number;
}

// Fixed dummy target — a static placeholder (not derived from estimasi/seed) until
// real Target Area data is wired up.
const DUMMY_TARGET_AREA = 500_000_000;

export function computeDummyTarget(): number {
  return DUMMY_TARGET_AREA;
}

// Still dummy — used only by ApprovalsChecklist's bulk multi-POA view, where
// "the MR's outlets" isn't a single well-defined set the way it is for one
// POA's own Detail page (see getMrSalesSummary for the real counterpart).
export function computeDummySales(seed: string, totalEstimasi: number): SalesFigures {
  const h = hashSeed(seed);
  const base = Math.max(totalEstimasi, 5_000_000);
  const historisTahunLalu = base * (10 + (h % 10));
  const growthFactor = 0.88 + (h % 25) / 100;
  const salesYtd = historisTahunLalu * growthFactor * (7 / 12);
  return {
    historisTahunLalu,
    historisTahunLaluLabel: String(new Date().getFullYear() - 1),
    salesYtd,
    growthPct: (growthFactor - 1) * 100,
  };
}

// ─── Stats computation ────────────────────────────────────────────────────────

function computeStats(items: PoaLineItem[]) {
  let estimasiTotal = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
  for (const it of items) {
    const base = toNum(it.rencanaTotalBiaya);
    const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
    estimasiTotal  += base;
    psspTotal      += base * (toNum(it.persenPsspDokter) * pengaliNilaiR);
    discountTotal  += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
  }
  const sudah  = items.filter((i) => i.statusStandarisasi === "SUDAH_STANDARISASI").length;
  const proses = items.filter((i) => i.statusStandarisasi === "PROSES_PENGAJUAN").length;
  return {
    estimasiTotal, psspTotal, discountTotal, entertainTotal,
    budgetTotal: psspTotal + discountTotal + entertainTotal,
    productCount: new Set(items.filter((i) => getAllPakets(i.namaProduk).length > 0).map((i) => i.kodeProduk)).size,
    totalPengajuan: items.length,
    sudahStandar: sudah,
    prosesStandar: proses,
    gap: items.length - sudah,
  };
}


// ─── Active PSSP list card ─────────────────────────────────────────────────────
// One row per (kontrak × produk) — the raw grain PsspKontrak is stored at — for
// every still-running contract belonging to a doctor+outlet in this POA.

function psspPeriodeLabel(awal: string, akhir: string) {
  const fmt = (p: string) => `${p.slice(4, 6)}/${p.slice(2, 4)}`;
  return `${fmt(awal)}-${fmt(akhir)}`;
}

// One doctor's active-PSSP contracts, collapsed to a summary row — mirrors DoctorRow's
// pattern (name/outlet header, aggregate stats, expandable per-contract/product detail).
function ActivePsspDoctorRow({ doctorRows, quarterMonths }: { doctorRows: ActivePsspRow[]; quarterMonths: string[] }) {
  const first = doctorRows[0];
  const [detailOpen, setDetailOpen] = useState(false);

  const byContract = new Map<string, ActivePsspRow[]>();
  for (const r of doctorRows) {
    const bucket = byContract.get(r.cUrut) ?? [];
    bucket.push(r);
    byContract.set(r.cUrut, bucket);
  }
  const kontrakTotal = byContract.size;
  const totalBiaya = [...byContract.values()].reduce((s, rows) => s + rows[0].biaya, 0);
  const totalEst = doctorRows.reduce((s, r) => s + r.estBaris, 0);
  const totalLunas = doctorRows.reduce((s, r) => s + r.totalLunas, 0);
  // Estimasi Kuartal Ini — estBaris apportioned to just this POA's quarter (a PSSP contract
  // almost always spans more months than one quarter). Lunas % below stays full-period since
  // totalLunas is a real cumulative figure with no monthly breakdown to apportion meaningfully.
  const totalEstKuartal = doctorRows.reduce((s, r) => s + apportion(r.estBaris, r.prdAwal, r.prdAkhir, quarterMonths), 0);
  const lunasPct = totalEst > 0 ? (totalLunas / totalEst) * 100 : null;

  return (
    <div className="py-3 px-2 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {censorName(first.nmCust ?? "-")}
            </span>
          </div>
          <p className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>
            {first.nmOutlet ?? "-"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
            {kontrakTotal} kontrak
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{formatRp(totalBiaya)}</p>
          {lunasPct != null && (
            <p className="text-xs" style={{ color: lunasPct < 80 ? "var(--color-red)" : "var(--color-text-faint)" }}>
              Lunas {lunasPct.toFixed(0)}%
            </p>
          )}
          <p className="text-xs mt-0.5" style={{ color: "var(--color-blue)" }}>
            Estimasi Kuartal Ini: {formatRp(totalEstKuartal)}
          </p>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            Detail {detailOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {detailOpen && (
        <div className="mt-2 rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)" }}>
                {["No. Kontrak", "Produk", "Biaya", "Periode", "Lunas", "Estimasi Kuartal Ini"].map((h) => (
                  <th key={h} className="text-left px-2.5 py-1.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...doctorRows]
                .sort((a, b) => a.prdAkhir.localeCompare(b.prdAkhir) || a.cUrut.localeCompare(b.cUrut))
                .map((r) => {
                  const rowLunasPct = r.estBaris > 0 ? (r.totalLunas / r.estBaris) * 100 : null;
                  const rowEstKuartal = apportion(r.estBaris, r.prdAwal, r.prdAkhir, quarterMonths);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{r.cUrut}</td>
                      <td className="px-2.5 py-1.5" style={{ color: "var(--color-text-muted)" }}>{r.nmProduk ?? "-"}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(r.biaya)}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{psspPeriodeLabel(r.prdAwal, r.prdAkhir)}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap"
                        style={{ color: rowLunasPct != null && rowLunasPct < 80 ? "var(--color-red)" : "var(--color-text-muted)" }}>
                        {rowLunasPct != null ? `${rowLunasPct.toFixed(0)}%` : "-"}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--color-text)" }}>{formatRp(rowEstKuartal)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ActivePsspListCard({ rows, quarterMonths }: { rows: ActivePsspRow[]; quarterMonths: string[] }) {
  if (rows.length === 0) return null;

  const byDoctor = new Map<string, ActivePsspRow[]>();
  for (const r of rows) {
    const key = r.kdCust || r.nmCust || r.id;
    const bucket = byDoctor.get(key) ?? [];
    bucket.push(r);
    byDoctor.set(key, bucket);
  }
  const doctorGroups = [...byDoctor.values()].sort(
    (a, b) => (a[0].nmCust ?? "").localeCompare(b[0].nmCust ?? "", "id")
  );

  return (
    <Card>
      <p className="font-semibold text-sm mb-0.5" style={{ color: "var(--color-text)" }}>
        PSSP Aktif (Kontrak Berjalan)
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--color-text-faint)" }}>
        Kontrak PSSP yang masih berjalan untuk dokter di outlet yang sama dengan POA ini.
      </p>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {doctorGroups.map((doctorRows) => (
          <ActivePsspDoctorRow key={doctorRows[0].kdCust || doctorRows[0].nmCust || doctorRows[0].id} doctorRows={doctorRows} quarterMonths={quarterMonths} />
        ))}
      </div>
    </Card>
  );
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
      <div className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3 pt-1"
      style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
      {children}
    </p>
  );
}

// ─── Stats Panel ─────────────────────────────────────────────────────────────

export function StatsPanel({
  items, selectedDoctorCount, totalDoctorCount, targetArea, salesFigures, salesIsReal = false, quarterMonths, activePssp = [],
}: {
  items: PoaLineItem[];
  selectedDoctorCount: number;
  totalDoctorCount: number;
  targetArea: number;
  salesFigures: SalesFigures;
  /** True when salesFigures came from getMrSalesSummary (real MSSQL-sourced
   * data) rather than computeDummySales — hides the "data sementara" caveat. */
  salesIsReal?: boolean;
  quarterMonths: string[];
  /** Still-active PSSP contracts (from earlier POAs) for the doctors currently in view. */
  activePssp?: ActivePsspRow[];
}) {
  const [salesOpen, setSalesOpen] = useState(false);
  const s = computeStats(items);
  const tercacah = items.reduce((acc, it) => {
    const t = computeBiayaTercacah(it, quarterMonths);
    return { estimasi: acc.estimasi + t.estimasi, nilaiPssp: acc.nilaiPssp + t.nilaiPssp };
  }, { estimasi: 0, nilaiPssp: 0 });
  const aktifPssp = computeActivePsspStats(activePssp, quarterMonths);
  const budgetTotalWithAktif = s.budgetTotal + aktifPssp.nilaiTotal;
  // "Estimasi POA" / Rasio Estimasi include the sales estimate already running via
  // active PSSP contracts — kept separate from s.estimasiTotal so the Anggaran %
  // labels below (which divide by s.estimasiTotal) are unaffected.
  const estimasiDisplay = s.estimasiTotal + aktifPssp.estBarisTotal;
  // Tercacah = apportioned to just this POA's quarter — active PSSP contracts almost
  // always span more than one quarter, so their full-period nilaiTotal/estBarisTotal
  // would overstate what actually falls in this specific quarter. Use the apportioned
  // nilaiTercacah/estBarisTercacah here instead (see computeActivePsspStats).
  const tercacahEstimasiWithAktif = tercacah.estimasi + aktifPssp.estBarisTercacah;
  const tercacahNilaiPsspWithAktif = tercacah.nilaiPssp + aktifPssp.nilaiTercacah;

  // Cakupan User = doctors actually planned in this draft UNION doctors already
  // under an active PSSP contract — a doctor with a running PSSP but no fresh
  // line item this quarter still counts as "covered" (2026-07-23). Keyed the
  // same way as doctorKey() (kodePI|namaCust) so a doctor in both sets isn't
  // double-counted; ActivePsspRow's kdOutlet/nmCust are the same underlying
  // Outlet.kodePI / doctor name, just named differently on that type.
  const draftDoctorKeys = new Set(items.map(doctorKey));
  const aktifDoctorKeys = new Set(activePssp.map((r) => `${r.kdOutlet ?? ""}|${r.nmCust ?? ""}`));
  const cakupanUserCount = new Set([...draftDoctorKeys, ...aktifDoctorKeys]).size;

  const ratioEst     = targetArea > 0 ? (estimasiDisplay / targetArea) * 100 : 0;
  const salesPlusEst = salesFigures.salesYtd + s.estimasiTotal;
  const achievePct   = targetArea > 0 ? (salesPlusEst / targetArea) * 100 : 0;

  const allSelected  = selectedDoctorCount === totalDoctorCount;
  const DANGER       = "var(--color-danger, #dc2626)";
  const MUTED        = "var(--color-text-muted)";
  const FAINT        = "var(--color-text-faint)";
  const TEXT         = "var(--color-text)";
  const BORDER       = "var(--color-border)";
  const BG           = "var(--color-bg-subtle)";
  const PRIMARY      = "var(--color-blue, #2563eb)";

  return (
    <Card>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <p className="font-semibold text-base" style={{ color: TEXT }}>Ringkasan POA</p>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: BG, color: FAINT }}>
          {allSelected
            ? `${totalDoctorCount} user dipilih`
            : `${selectedDoctorCount} dari ${totalDoctorCount} user`}
        </span>
      </div>

      {/* ── 1. Estimasi vs Target ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "Estimasi POA",  value: estimasiDisplay > 0 ? formatRp(estimasiDisplay) : "-", span: false },
          { label: "Target Area ★", value: formatRp(targetArea), span: false },
          { label: "Rasio Estimasi", value: ratioEst > 0 ? `${ratioEst.toFixed(0)}%` : "-", span: true },
        ].map(({ label, value, span }) => (
          <div key={label} className={`rounded-lg p-3 space-y-0.5${span ? " col-span-2" : ""}`}
            style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: MUTED }}>{label}</p>
            <p className={`font-bold leading-tight ${span ? "text-lg" : "text-base"}`} style={{ color: TEXT }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Ratio bar — no fixed pass/fail threshold, just a plain fill of the ratio itself */}
      {ratioEst > 0 && (
        <div className="mb-5 space-y-1">
          <div className="flex justify-between text-xs" style={{ color: FAINT }}>
            <span>0%</span>
            <span>200%</span>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(ratioEst / 2, 100)}%`, background: PRIMARY }} />
          </div>
        </div>
      )}

      {/* ── 2. Anggaran ── */}
      <SectionTitle>Anggaran</SectionTitle>
      <div className="space-y-2.5 mb-5">
        {[
          { label: "PSSP",               value: s.psspTotal },
          { label: "Discount + DPL + DPF", value: s.discountTotal },
          { label: "Entertain",          value: s.entertainTotal },
        ].map(({ label, value }) => {
          const pct = s.estimasiTotal > 0 ? (value / s.estimasiTotal) * 100 : 0;
          const fmt = label === "PSSP" ? formatRpPssp : formatRp;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ color: TEXT }}>
                  {value > 0 ? fmt(value) : "-"}
                  {pct > 0 && <span style={{ color: FAINT }}> · {pct.toFixed(1)}%</span>}
                </span>
              </div>
              <Bar pct={pct * 5} color={PRIMARY} />
            </div>
          );
        })}
        {aktifPssp.kontrakTotal > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: MUTED }}>PSSP Aktif (kontrak berjalan)</span>
              <span style={{ color: TEXT }}>{formatRp(aktifPssp.nilaiTotal)}</span>
            </div>
            <p className="text-xs" style={{ color: FAINT }}>
              {aktifPssp.kontrakTotal} kontrak · {aktifPssp.dokterCount} user
            </p>
          </div>
        )}
        <div className="flex justify-between pt-2 text-sm font-semibold"
          style={{ borderTop: `1px solid ${BORDER}`, color: TEXT }}>
          <span>Total Budget</span>
          <span>{formatRp(budgetTotalWithAktif)}</span>
        </div>
      </div>

      {/* ── 2b. Estimasi & Nilai PSSP — PSSP Berjalan vs POA, Tercacah vs Bukan Tercacah ──
          Tercacah = apportioned to just this POA's quarter. Bukan Tercacah = full
          period as originally planned/contracted. Kept as two clearly-labeled tables
          (not blended into one number) so it's unambiguous which slice of which
          source a figure represents. */}
      {(tercacahEstimasiWithAktif > 0 || tercacahNilaiPsspWithAktif > 0 ||
        estimasiDisplay > 0 || (s.psspTotal + aktifPssp.nilaiTotal) > 0) && (
        <div className="mb-5 space-y-3">
          {[
            {
              title: "Tercacah (Kuartal Ini)",
              rows: [
                { label: "PSSP Berjalan", estimasi: aktifPssp.estBarisTercacah, nilai: aktifPssp.nilaiTercacah },
                { label: "POA",           estimasi: tercacah.estimasi,          nilai: tercacah.nilaiPssp },
                { label: "Total",         estimasi: tercacahEstimasiWithAktif,  nilai: tercacahNilaiPsspWithAktif, bold: true },
              ],
            },
            {
              title: "Bukan Tercacah (Full Periode)",
              rows: [
                { label: "PSSP Berjalan", estimasi: aktifPssp.estBarisTotal,          nilai: aktifPssp.nilaiTotal },
                { label: "POA",           estimasi: s.estimasiTotal,                 nilai: s.psspTotal },
                { label: "Total",         estimasi: estimasiDisplay,                 nilai: s.psspTotal + aktifPssp.nilaiTotal, bold: true },
              ],
            },
          ].map(({ title, rows }) => (
            <div key={title} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold px-3 py-1.5" style={{ background: BG, color: MUTED }}>{title}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: FAINT }}>
                    <th className="text-left font-medium px-3 py-1.5"></th>
                    <th className="text-right font-medium px-3 py-1.5">Estimasi</th>
                    <th className="text-right font-medium px-3 py-1.5">Nilai PSSP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} style={r.bold ? { borderTop: `1px solid ${BORDER}` } : undefined}>
                      <td className={`px-3 py-1.5 ${r.bold ? "font-semibold" : ""}`} style={{ color: r.bold ? TEXT : MUTED }}>{r.label}</td>
                      <td className={`text-right px-3 py-1.5 ${r.bold ? "font-semibold" : ""}`} style={{ color: TEXT }}>
                        {r.estimasi > 0 ? formatRp(r.estimasi) : "-"}
                      </td>
                      <td className={`text-right px-3 py-1.5 ${r.bold ? "font-semibold" : ""}`} style={{ color: TEXT }}>
                        {r.nilai > 0 ? formatRpPssp(r.nilai) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── 3. Cakupan ── */}
      <SectionTitle>Cakupan</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          {
            label: "User",
            value: cakupanUserCount,
            sub: cakupanUserCount >= 30 ? "min. 30 ✓" : `min. 30 (kurang ${30 - cakupanUserCount})`,
            danger: false,
          },
          {
            label: "Target Produk Fokus ★",
            value: `${s.productCount}/22`,
            sub: s.productCount >= 22 ? "terpenuhi ✓" : `kurang ${22 - s.productCount}`,
            danger: s.productCount < 22,
          },
        ].map(({ label, value, sub, danger }) => (
          <div key={label} className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs mb-0.5" style={{ color: MUTED }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            {sub && <p className="text-xs mt-0.5" style={{ color: danger ? DANGER : FAINT }}>{sub}</p>}
          </div>
        ))}
        <div className="col-span-2 flex justify-between items-center rounded-lg px-3 py-2"
          style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Total baris pengajuan</p>
          <p className="text-sm font-bold" style={{ color: TEXT }}>{s.totalPengajuan}</p>
        </div>
      </div>

      {/* ── 4. Listing / Standarisasi ── */}
      <SectionTitle>Listing Produk</SectionTitle>
      <div className="mb-5 space-y-2">
        {s.totalPengajuan > 0 ? (
          <>
            <div className="h-2 rounded-full overflow-hidden flex" style={{ background: BORDER }}>
              <div className="h-full transition-all duration-300"
                style={{ width: `${(s.sudahStandar / s.totalPengajuan) * 100}%`, background: PRIMARY }} />
              <div className="h-full transition-all duration-300"
                style={{ width: `${(s.prosesStandar / s.totalPengajuan) * 100}%`, background: MUTED, opacity: 0.4 }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <span style={{ color: MUTED }}>Sudah listing <span style={{ color: TEXT, fontWeight: 600 }}>{s.sudahStandar}</span></span>
              <span style={{ color: MUTED }}>Proses <span style={{ color: TEXT, fontWeight: 600 }}>{s.prosesStandar}</span></span>
              {s.gap > 0 && (
                <span style={{ color: DANGER }}>Belum <span style={{ fontWeight: 600 }}>{s.gap}</span> - perlu ditindaklanjuti</span>
              )}
              {s.gap === 0 && <span style={{ color: MUTED }}>Semua sudah listing ✓</span>}
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: FAINT }}>Tidak ada data.</p>
        )}
      </div>

      {/* ── 5. Data Sales (collapsible) ── */}
      <button
        type="button"
        onClick={() => setSalesOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left"
        style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          Data Sales {!salesIsReal && <span style={{ color: FAINT }}>★ data sementara</span>}
        </span>
        <span className="text-xs" style={{ color: FAINT }}>{salesOpen ? "▲" : "▼"}</span>
      </button>

      {salesOpen && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: `Historis ${salesFigures.historisTahunLaluLabel}`, value: formatRp(salesFigures.historisTahunLalu) },
            { label: `Sales YTD ${new Date().getFullYear()}`,           value: formatRp(salesFigures.salesYtd) },
            { label: "Sales YTD + Estimasi", value: formatRp(salesPlusEst) },
            { label: "Growth YTD",          value: `${salesFigures.growthPct >= 0 ? "+" : ""}${salesFigures.growthPct.toFixed(1)}%`, danger: salesFigures.growthPct < 0 },
            { label: "Achievement YTD+Est", value: achievePct > 0 ? `${achievePct.toFixed(1)}%` : "-", danger: achievePct > 0 && achievePct < 100 },
          ].map(({ label, value, danger }) => (
            <div key={label} className="rounded-lg p-2.5"
              style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <p className="text-xs mb-0.5" style={{ color: FAINT }}>{label}</p>
              <p className="text-sm font-semibold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            </div>
          ))}
          {!salesIsReal && (
            <p className="col-span-full text-xs mt-1" style={{ color: FAINT }}>
              ★ Data dummy - akan diganti data aktual.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Doctor row ───────────────────────────────────────────────────────────────

// Small labeled figure used inside the doctor row's stat grid — deliberately
// larger type than the old inline text lines (2026-07-27: rows were too
// cramped to read the emphasized figures at a glance).
function StatTile({ label, value, sub, emphasize = false }: { label: string; value: string; sub?: string; emphasize?: boolean }) {
  return (
    <div className="rounded-md px-2.5 py-2 min-w-0"
      style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
      <p className="text-[11px] leading-tight" style={{ color: "var(--color-text-faint)" }}>{label}</p>
      <p className={`leading-tight truncate ${emphasize ? "text-sm font-bold" : "text-sm font-semibold"}`}
        style={{ color: "var(--color-text)" }}>
        {value}
      </p>
      {sub && <p className="text-[11px] leading-tight mt-0.5 truncate" style={{ color: "var(--color-text-faint)" }}>{sub}</p>}
    </div>
  );
}

function DoctorRow({
  doctorItems, checked, onToggle, selectable = true, totalEstimasi, poaId, userCanEdit, quarterMonths,
}: {
  doctorItems: PoaLineItem[];
  checked: boolean;
  onToggle: () => void;
  selectable?: boolean;
  totalEstimasi: number;
  poaId?: string;
  userCanEdit?: boolean;
  quarterMonths: string[];
}) {
  const first = doctorItems[0];
  const rowEst = doctorItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
  const rowTercacah = doctorItems.reduce((acc, it) => {
    const t = computeBiayaTercacah(it, quarterMonths);
    return { estimasi: acc.estimasi + t.estimasi, nilaiPssp: acc.nilaiPssp + t.nilaiPssp };
  }, { estimasi: 0, nilaiPssp: 0 });
  // Nilai PSSP (full period, not apportioned to this quarter) — the doctor-level
  // total behind the per-product "Nilai PSSP" figures in the detail table below.
  const rowNilaiPssp = doctorItems.reduce((s, it) => {
    const base = toNum(it.rencanaTotalBiaya);
    const pengali = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
    return s + base * toNum(it.persenPsspDokter) * pengali;
  }, 0);
  // Pengali Nilai R shown at doctor level is a weighted average across products —
  // weighted by each product's own rencanaTotalBiaya, since a doctor's products
  // can carry different pengali overrides.
  const pengaliAvg = (() => {
    let weighted = 0, total = 0;
    for (const it of doctorItems) {
      const base = toNum(it.rencanaTotalBiaya);
      if (base <= 0) continue;
      const pengali = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      weighted += base * pengali;
      total += base;
    }
    return total > 0 ? weighted / total : null;
  })();
  // Nilai R Final = persenPsspDokter (the product's Nilai R) × Pengali Nilai R in effect
  // for that line — weighted by each product's own rencanaTotalBiaya, since a doctor's
  // products can carry different Nilai R% and different pengali overrides.
  const nilaiRFinal = (() => {
    let weighted = 0, total = 0;
    for (const it of doctorItems) {
      const base = toNum(it.rencanaTotalBiaya);
      if (base <= 0) continue;
      const pengali = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      weighted += base * toNum(it.persenPsspDokter) * pengali;
      total += base;
    }
    return total > 0 ? (weighted / total) * 100 : null;
  })();
  // Jumlah Variasi (& Produk Fokus) — distinct products this doctor is planned
  // for, split by whether the product belongs to a Fokus paket.
  const variasiTotal = new Set(doctorItems.map((it) => it.kodeProduk)).size;
  const variasiFokus = new Set(
    doctorItems.filter((it) => getAllPakets(it.namaProduk).length > 0).map((it) => it.kodeProduk)
  ).size;
  const isDokterBaru = !first.kodeCust;
  const contribPct = totalEstimasi > 0 ? (rowEst / totalEstimasi) * 100 : 0;
  const [isDeleting, startDelete] = useTransition();
  const [detailOpen, setDetailOpen] = useState(false);

  function handleDelete() {
    if (!poaId) return;
    const label = doctorItems.length > 1 ? `${doctorItems.length} produk` : "1 produk";
    if (!confirm(`Hapus ${first.namaCust} beserta ${label}?`)) return;
    startDelete(async () => {
      for (const it of doctorItems) await deleteLineItemAction(poaId, it.id);
    });
  }

  return (
    <div className="py-3 px-2.5 rounded-lg" style={{ opacity: checked ? 1 : 0.5, border: "1px solid var(--color-border)" }}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 shrink-0 rounded mt-0.5"
            style={{ accentColor: "var(--color-blue)" }}
          />
        )}

        <div className="flex-1 min-w-0">
          {/* ── Nama Dokter (+ Label) & Rumah Sakit ── emphasized: this is the
              row's primary identity, so it gets full-width, larger type instead
              of competing for space with the stat numbers. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {censorName(first.namaCust)}
            </span>
            {isDokterBaru && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{ background: "#fff7ed", color: "#92400e", border: "1px solid #fcd34d" }}>
                Baru
              </span>
            )}
            {first.labelCustomer && <LabelCustomerBadge label={first.labelCustomer} />}
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {spesLabel(first.spesialisasi)}
            </span>
          </div>
          <p className="text-sm font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {first.namaOutlet}
          </p>
          {checked && contribPct > 0 && (
            <div className="h-1 rounded-full overflow-hidden mt-1.5 max-w-xs" style={{ background: "var(--color-border)" }}>
              <div className="h-full rounded-full" style={{ width: `${contribPct}%`, background: "var(--color-blue, #2563eb)", opacity: 0.5 }} />
            </div>
          )}

          {/* ── Stat grid — Estimasi / Nilai PSSP / Pengali Nilai R / Tercacah / Variasi ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2.5">
            <StatTile label="Estimasi" value={rowEst > 0 ? formatRp(rowEst) : "-"}
              sub={contribPct > 0 ? `${contribPct.toFixed(1)}% dari total` : undefined} emphasize />
            <StatTile label="Nilai PSSP" value={rowNilaiPssp > 0 ? formatRpPssp(rowNilaiPssp) : "-"}
              sub={nilaiRFinal != null ? `Nilai R Final ${nilaiRFinal.toFixed(2)}%` : undefined} emphasize />
            <StatTile label="Pengali Nilai R" value={pengaliAvg != null ? `${pengaliAvg.toFixed(2)}x` : "-"} />
            <StatTile label="Variasi Produk" value={`${variasiFokus}/${variasiTotal}`} sub="fokus/total" />
          </div>
          {(rowTercacah.estimasi > 0 || rowTercacah.nilaiPssp > 0) && (
            <div className="mt-1.5">
              <StatTile
                label="Pengajuan Sebelumnya (Tercacah - Kuartal Ini)"
                value={formatRp(rowTercacah.estimasi)}
                sub={rowTercacah.nilaiPssp > 0 ? `Nilai PSSP ${formatRpPssp(rowTercacah.nilaiPssp)}` : undefined}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <p className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
            {doctorItems.length} produk
          </p>
          {poaId && (
            <div className="flex flex-col gap-1 items-end">
              {/* Same route either way — /doctor/[itemId]/edit renders read-only
                  (fieldset disabled) for anyone who can view but not edit, so a
                  VIEWER/GM/SFE gets the SAME full per-product detail (Histori
                  PSSP, Kriteria Produk, semua field) an editor sees, not just
                  the lightweight "Detail ▼" summary table below (2026-07-31:
                  "benar-benar bisa lihat detailnya, bukan cuma ringkasan"). */}
              <Link href={`/poa/${poaId}/doctor/${doctorItems[0].id}/edit`}
                className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
                style={userCanEdit
                  ? { background: "var(--color-blue)", color: "#fff" }
                  : { background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
                {userCanEdit ? "Edit" : "Lihat"}
              </Link>
              {userCanEdit && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="text-xs" style={{ color: "var(--color-red)" }}>
                  Hapus
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            className="text-xs mt-1 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
            Detail {detailOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {detailOpen && (
        <div className="mt-2.5 rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)" }}>
                <th className="text-left px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Produk</th>
                <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Resep/Hr</th>
                <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Qty</th>
                <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Estimasi</th>
                <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Nilai PSSP</th>
                <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Pengali Nilai R</th>
                <th className="text-left px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {doctorItems.map((it) => {
                const itemPengali = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
                const itemBase = toNum(it.rencanaTotalBiaya);
                const itemNilaiPssp = itemBase * toNum(it.persenPsspDokter) * itemPengali;
                return (
                  <tr key={it.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-2.5 py-2" style={{ color: "var(--color-text)" }}>{it.namaProduk}</td>
                    <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{it.jumlahResepHari ?? "-"}</td>
                    <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{it.qtyProdukResep ?? "-"}</td>
                    <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text)" }}>
                      {itemBase > 0 ? formatRp(itemBase) : "-"}
                    </td>
                    <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text)" }}>
                      {itemNilaiPssp > 0 ? formatRpPssp(itemNilaiPssp) : "-"}
                    </td>
                    <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text)" }}>
                      {itemPengali.toFixed(2)}x
                    </td>
                    <td className="px-2.5 py-2" style={{ color: "var(--color-text-muted)" }}>
                      {it.statusStandarisasi ? STATUS_STANDARISASI_LABELS[it.statusStandarisasi] ?? it.statusStandarisasi : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function DraftChecklist({ items, poaId, poaPeriod, poaStatus, poaVersion, showSubmit, userCanEdit, selectable = true, activePssp = [], salesSummary }: {
  items: PoaLineItem[];
  poaId?: string;
  poaPeriod: string;
  poaStatus?: PoaStatus;
  poaVersion?: number;
  showSubmit?: boolean;
  /** Whether this user can edit right now — server-computed (canEdit in
   * authz.ts), already accounts for Lock Edit Logic (someone above having
   * approved this cycle locks the owner out, routing them to "Ajukan Edit"
   * instead — see poa/[id]/page.tsx) and ownership/subtree visibility. No
   * extra client-side "click to unlock" gate on top of this (removed
   * 2026-07-31 — it required an extra click even before anyone had approved
   * anything, which is exactly when editing should just work immediately). */
  userCanEdit?: boolean;
  /** False for approvers viewing the checklist read-only — no checkboxes, all items count toward the summary. */
  selectable?: boolean;
  /** Still-active PSSP contracts for the doctors on this POA, for the ringkasan. */
  activePssp?: ActivePsspRow[];
  /** Real "Data Sales" figures from getMrSalesSummary (server-computed, scoped
   * to this POA's own MR) — absent only if the caller genuinely couldn't
   * compute it, in which case the card shows zeros rather than a guess. */
  salesSummary?: SalesFigures;
}) {
  const quarterMonths = useMemo(() => {
    try { return quarterToMonths(poaPeriod); } catch { return []; }
  }, [poaPeriod]);

  const canEditNow = !!userCanEdit;

  const groups = useMemo(() => {
    const map = new Map<string, PoaLineItem[]>();
    for (const item of items) {
      const key = doctorKey(item);
      const g = map.get(key) ?? [];
      g.push(item);
      map.set(key, g);
    }
    return map;
  }, [items]);

  const allKeys = useMemo(() => [...groups.keys()], [groups]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys));

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setChecked(checked.size === allKeys.length ? new Set() : new Set(allKeys));
  }

  // targetArea is still a dummy stand-in (not affected by checklist selection);
  // salesFigures is the real server-computed summary for this POA's MR.
  const targetArea = useMemo(() => computeDummyTarget(), []);
  const salesFigures: SalesFigures = salesSummary ?? {
    historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0,
  };

  const selectedItems = useMemo(
    () => items.filter((it) => checked.has(doctorKey(it))),
    [items, checked],
  );

  // Total estimasi of selected items (for contribution bars)
  const selectedEstimasi = useMemo(
    () => selectedItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0),
    [selectedItems],
  );

  const [isSubmitting, startSubmit] = useTransition();
  const [submitNotes, setSubmitNotes] = useState("");
  // Resubmitting from Revisi means an approver bounced this back with feedback —
  // notes explaining what changed is required here, unlike a normal first-time
  // submission (2026-07-23 request).
  const notesRequired = poaStatus === "REVISI";
  const notesMissing = notesRequired && !submitNotes.trim();

  function handleSubmit() {
    if (!poaId || checked.size === 0 || notesMissing) return;
    const keepIds = items
      .filter((it) => checked.has(doctorKey(it)))
      .map((it) => it.id);
    startSubmit(() => submitPoaWithSelectionAction(poaId, keepIds, submitNotes));
  }

  if (items.length === 0) return null;

  const allChecked = checked.size === allKeys.length;

  return (
    <div className="grid md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Left: checklist */}
      <div className="space-y-4 min-w-0">
        {/* Stats visible on mobile (above checklist) */}
        <div className="md:hidden">
          <StatsPanel
            items={selectedItems}
            selectedDoctorCount={checked.size}
            totalDoctorCount={allKeys.length}
            targetArea={targetArea}
            salesFigures={salesFigures}
            salesIsReal={!!salesSummary}
            quarterMonths={quarterMonths}
            activePssp={activePssp}
          />
        </div>

        <Card>
          {/* Checklist header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Daftar User</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                {selectable ? "Centang user yang ingin dihitung statistiknya" : "Ringkasan seluruh rencana"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {poaStatus && <StatusBadge status={poaStatus} version={poaVersion} />}
              {canEditNow && poaId && (
                <Link href={`/poa/${poaId}/edit`}
                  className="text-xs px-2.5 py-1 rounded-md font-medium"
                  style={{ background: "var(--color-blue)", color: "#fff" }}>
                  + Tambah User
                </Link>
              )}
              {selectable && (
                <button
                  type="button"
                  className="text-xs px-2.5 py-1 rounded-md font-medium"
                  style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
                  onClick={toggleAll}
                >
                  {allChecked ? "Unselect All" : "Select All"}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {[...groups.entries()].map(([key, doctorItems]) => (
              <DoctorRow
                key={key}
                doctorItems={doctorItems}
                checked={checked.has(key)}
                onToggle={() => toggle(key)}
                selectable={selectable}
                totalEstimasi={selectedEstimasi}
                poaId={poaId}
                userCanEdit={canEditNow}
                quarterMonths={quarterMonths}
              />
            ))}
          </div>
        </Card>

        {showSubmit && poaId && (
          <div className="rounded-lg border p-4"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
              Ajukan ke Atasan
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              {checked.size === allKeys.length
                ? `Semua ${allKeys.length} user akan diajukan.`
                : checked.size === 0
                ? "Pilih minimal 1 user untuk diajukan."
                : `${checked.size} dari ${allKeys.length} user dipilih - ${allKeys.length - checked.size} user tidak dicentang akan dihapus dari POA.`}
            </p>
            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs" style={{ color: notesMissing ? "var(--color-red)" : "var(--color-text-muted)" }}>
                {notesRequired
                  ? "Notes - jelaskan apa yang diubah dari revisi sebelumnya"
                  : "Notes tambahan untuk perkuat argumen pengajuan (opsional)"}
                {notesRequired && <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>}
              </span>
              <div style={notesMissing ? { outline: "2px solid var(--color-red)", outlineOffset: 2, borderRadius: 6 } : undefined}>
                <textarea
                  value={submitNotes}
                  onChange={(e) => setSubmitNotes(e.target.value)}
                  rows={2}
                  placeholder={notesRequired
                    ? "Jelaskan perubahan yang dilakukan untuk menjawab catatan revisi…"
                    : "mis. konteks tambahan yang tidak terlihat dari angka…"}
                  className="input-field text-xs" />
              </div>
              {notesMissing && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
            </label>
            <Button
              type="button"
              disabled={checked.size === 0 || isSubmitting || notesMissing}
              onClick={handleSubmit}>
              {isSubmitting ? "Mengajukan…" : "Ajukan ke Atasan"}
            </Button>
          </div>
        )}
      </div>

      {/* Right: stats panel — sticky, scrollable internally so it never enlarges the page */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <StatsPanel
          items={selectedItems}
          selectedDoctorCount={checked.size}
          totalDoctorCount={allKeys.length}
          targetArea={targetArea}
          salesFigures={salesFigures}
          salesIsReal={!!salesSummary}
          quarterMonths={quarterMonths}
          activePssp={activePssp}
        />
      </div>
    </div>
  );
}
