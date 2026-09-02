"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import type { PoaLineItem, PoaStatus } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { spesLabel } from "@/lib/spesialisasi";
import { getAllPakets } from "@/lib/paketProduk";
import { submitDoctorAction } from "@/app/actions/poa";
import type { DoctorActions, DoctorEditRequestInfo, DoctorRejectInfo } from "@/components/poa/PoaDetailTabs";
import { deleteLineItemAction } from "@/app/actions/lineItem";
import { quarterToMonths, quarterLabelFromMonths } from "@/lib/quarterUtils";
import type { ActivePsspRow } from "@/app/actions/customer";
import { computeActivePsspStats, apportion } from "@/lib/activePssp";
import { computeMonthlyBreakdown, formatPeriode, formatPeriodeRange, REJECT_CATEGORY_LABELS } from "@/lib/poaUtils";
import { LabelCustomerBadge } from "@/components/poa/LineItemEditor";
import { formatCurrency } from "@/lib/format";
import { displayRole } from "@/lib/role";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Hospital draft (this file, feeds /poa/[id]) drops the "Jt/M/Rb" suffix and
// always shows plain ÷1.000.000 — SC/non-hospital (SalesCounterStatsPanel)
// keeps the suffixed formatCurrency default (2026-09-02 request).
export const formatRp = (val: Parameters<typeof formatCurrency>[0]) => formatCurrency(val, false);
export const formatRpPssp = (val: Parameters<typeof formatCurrency>[0]) => formatCurrency(val, false);

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
 * "Biaya Tercacah" — apportions a line item's total Estimasi / Nilai PSSP /
 * DP / Listing Fee to however many of its plan months fall inside the POA's
 * own quarter. E.g. a 6-month plan starting 202607 overlaps 3 months of a
 * 2026-Q3 POA (Jul-Sep) → counts 3/6 of the total; starting 202608 overlaps
 * only Aug-Sep → 2/6.
 */
function computeBiayaTercacah(item: PoaLineItem, quarterMonths: string[]): { estimasi: number; nilaiPssp: number; dp: number; listingFee: number } {
  const lama = item.lamaPeriode || 0;
  if (lama <= 0 || !item.periodeAwal || item.periodeAwal.length !== 6) return { estimasi: 0, nilaiPssp: 0, dp: 0, listingFee: 0 };

  const startYear = parseInt(item.periodeAwal.slice(0, 4), 10);
  const startMonth = parseInt(item.periodeAwal.slice(4, 6), 10);
  let overlapCount = 0;
  for (let i = 0; i < lama; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (quarterMonths.includes(yyyymm)) overlapCount++;
  }
  if (overlapCount === 0) return { estimasi: 0, nilaiPssp: 0, dp: 0, listingFee: 0 };

  const totalBiaya = toNum(item.rencanaTotalBiaya);
  const estimasi = (totalBiaya / lama) * overlapCount;

  const persenPsspDokter = toNum(item.persenPsspDokter); // stored as a fraction, e.g. 0.05 for 5%
  const pengaliNilaiR = item.pengaliNilaiR != null ? toNum(item.pengaliNilaiR) : 1;
  const nilaiPsspTotal = totalBiaya * persenPsspDokter * pengaliNilaiR;
  const nilaiPssp = (nilaiPsspTotal / lama) * overlapCount;

  const dpTotal = totalBiaya * toNum(item.persenDp);
  const dp = (dpTotal / lama) * overlapCount;
  const listingFeeTotal = totalBiaya * toNum(item.persenListingFee);
  const listingFee = (listingFeeTotal / lama) * overlapCount;

  return { estimasi, nilaiPssp, dp, listingFee };
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
  const qLabel = quarterLabelFromMonths(quarterMonths);

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
            Estimasi Kuartal {qLabel}: {formatRp(totalEstKuartal)}
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
                {["No. Kontrak", "Produk", "Biaya", "Periode", "Lunas", `Estimasi Kuartal ${qLabel}`].map((h) => (
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
  items, selectedDoctorCount, totalDoctorCount, targetArea, targetAreaIsReal = false, salesFigures, salesIsReal = false, quarterMonths, activePssp = [],
}: {
  items: PoaLineItem[];
  selectedDoctorCount: number;
  totalDoctorCount: number;
  targetArea: number;
  /** True when targetArea came from real TargetHospitalValue data rather than
   * the dummy placeholder — controls the "★" dummy-data marker below. */
  targetAreaIsReal?: boolean;
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
    return {
      estimasi: acc.estimasi + t.estimasi, nilaiPssp: acc.nilaiPssp + t.nilaiPssp,
      dp: acc.dp + t.dp, listingFee: acc.listingFee + t.listingFee,
    };
  }, { estimasi: 0, nilaiPssp: 0, dp: 0, listingFee: 0 });
  const aktifPssp = computeActivePsspStats(activePssp, quarterMonths);
  const budgetTotalWithAktif = s.budgetTotal + aktifPssp.nilaiTotal;
  // Full-period estimasi (not apportioned to the quarter) — only feeds the
  // "Bukan Tercacah (Full Periode)" table below now; kept separate from
  // s.estimasiTotal so the Anggaran % labels (which divide by s.estimasiTotal)
  // are unaffected by the active-PSSP add-on.
  const estimasiDisplay = s.estimasiTotal + aktifPssp.estBarisTotal;
  // Tercacah = apportioned to just this POA's quarter — active PSSP contracts almost
  // always span more than one quarter, so their full-period nilaiTotal/estBarisTotal
  // would overstate what actually falls in this specific quarter. Use the apportioned
  // nilaiTercacah/estBarisTercacah here instead (see computeActivePsspStats). This is
  // what "Estimasi POA" / Rasio Estimasi above now use (2026-08-03) — Target Area is
  // itself a single-quarter figure, so comparing it against a full-period estimasi
  // overstated the ratio.
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

  const monthlyBreakdown = useMemo(() => computeMonthlyBreakdown(items), [items]);
  const monthlyBreakdownSorted = [...monthlyBreakdown.keys()].sort();
  const monthlyBreakdownTotal = [...monthlyBreakdown.values()].reduce(
    (acc, v) => ({ estimasi: acc.estimasi + v.estimasi, nilaiPssp: acc.nilaiPssp + v.nilaiPssp }),
    { estimasi: 0, nilaiPssp: 0 }
  );

  const qLabel = quarterLabelFromMonths(quarterMonths);

  const ratioEst     = targetArea > 0 ? (tercacahEstimasiWithAktif / targetArea) * 100 : 0;
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

      {/* ── 1. Estimasi & Nilai PSSP — PSSP Aktif vs PSSP Rencana, Bukan Tercacah vs Tercacah ──
          Moved to the top (2026-08-04 request) so it's immediately visible, above
          the fold. Bukan Tercacah = full period as originally planned/contracted.
          Tercacah = apportioned to just this POA's quarter. Order corrected
          2026-08-05: Full Periode first, then Tercacah (was swapped). Kept as two
          clearly-labeled tables (not blended into one number) so it's unambiguous
          which slice of which source a figure represents. */}
      {(tercacahEstimasiWithAktif > 0 || tercacahNilaiPsspWithAktif > 0 ||
        estimasiDisplay > 0 || (s.psspTotal + aktifPssp.nilaiTotal) > 0) && (
        <div className="mb-5 space-y-3">
          {[
            {
              title: "Full Periode",
              rows: [
                { label: "PSSP Aktif",    estimasi: aktifPssp.estBarisTotal,          nilai: aktifPssp.nilaiTotal },
                { label: "PSSP Rencana",  estimasi: s.estimasiTotal,                 nilai: s.psspTotal },
                { label: "Total",         estimasi: estimasiDisplay,                 nilai: s.psspTotal + aktifPssp.nilaiTotal, bold: true },
              ],
            },
            {
              title: `Tercacah (Kuartal ${qLabel})`,
              rows: [
                { label: `PSSP Aktif ${qLabel}`,   estimasi: aktifPssp.estBarisTercacah, nilai: aktifPssp.nilaiTercacah },
                { label: `PSSP Rencana ${qLabel}`, estimasi: tercacah.estimasi,          nilai: tercacah.nilaiPssp },
                { label: "Total",                estimasi: tercacahEstimasiWithAktif,  nilai: tercacahNilaiPsspWithAktif, bold: true },
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

      {/* ── 2. Estimasi & Nilai PSSP per Bulan — same rata-rata spread across
          periodeAwal..periodeAkhir as the "Estimasi PSSP per Bulan" Excel sheet,
          shown here too so the monthly breakdown isn't Excel-only (2026-08-04).
          Ordered right after Tercacah/Bukan Tercacah (2026-08-04 request: Tercacah
          → Full Periode → Per Bulan), not after Anggaran. */}
      {monthlyBreakdownSorted.length > 0 && (
        <div className="mb-5">
          <SectionTitle>Estimasi & Nilai PSSP per Bulan</SectionTitle>
          <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: FAINT, background: BG }}>
                  <th className="text-left font-medium px-3 py-1.5">Bulan</th>
                  <th className="text-right font-medium px-3 py-1.5">Estimasi</th>
                  <th className="text-right font-medium px-3 py-1.5">Nilai PSSP</th>
                </tr>
              </thead>
              <tbody>
                {monthlyBreakdownSorted.map((m) => {
                  const v = monthlyBreakdown.get(m)!;
                  return (
                    <tr key={m} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-3 py-1.5" style={{ color: MUTED }}>{formatPeriode(m)}</td>
                      <td className="text-right px-3 py-1.5" style={{ color: TEXT }}>{v.estimasi > 0 ? formatRp(v.estimasi) : "-"}</td>
                      <td className="text-right px-3 py-1.5" style={{ color: TEXT }}>{v.nilaiPssp > 0 ? formatRpPssp(v.nilaiPssp) : "-"}</td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `1px solid ${BORDER}`, fontWeight: 600 }}>
                  <td className="px-3 py-1.5" style={{ color: TEXT }}>Total</td>
                  <td className="text-right px-3 py-1.5" style={{ color: TEXT }}>{formatRp(monthlyBreakdownTotal.estimasi)}</td>
                  <td className="text-right px-3 py-1.5" style={{ color: TEXT }}>{formatRpPssp(monthlyBreakdownTotal.nilaiPssp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3. Estimasi vs Target ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "Estimasi POA (Tercacah)", value: tercacahEstimasiWithAktif > 0 ? formatRp(tercacahEstimasiWithAktif) : "-", span: false },
          { label: targetAreaIsReal ? "Target" : "Target ★", value: formatRp(targetArea), span: false },
          { label: "Rasio Estimasi", value: ratioEst > 0 ? `${ratioEst.toFixed(0)}%` : "-", span: true },
        ].map(({ label, value, span }) => (
          <div key={label} className={`rounded-lg p-3 space-y-0.5${span ? " col-span-2" : ""}`}
            style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: MUTED }}>{label}</p>
            <p className={`font-bold leading-tight ${span ? "text-lg" : "text-base"}`} style={{ color: TEXT }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── 4. Anggaran ── */}
      <SectionTitle>Anggaran</SectionTitle>
      <div className="space-y-2.5 mb-5">
        {[
          { label: "PSSP",               value: s.psspTotal },
          { label: "Campaign / DPL / DPF", value: s.discountTotal },
          { label: "ENT",                value: s.entertainTotal },
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
        {/* DP & Listing Fee (Tercacah Kuartal Ini) — split out from the
            "Campaign / DPL / DPF" full-period bucket above (2026-08-08
            request), apportioned to just this quarter the same way
            "Estimasi POA (Tercacah)" is (computeBiayaTercacah), not blended
            full-period like the 3 bars above. Denominator is tercacah.estimasi
            (not s.estimasiTotal) so the % stays internally consistent — both
            numerator and denominator are the same tercacah scope. */}
        {[
          { label: "DP (Tercacah Kuartal Ini)",          value: tercacah.dp },
          { label: "Listing Fee (Tercacah Kuartal Ini)", value: tercacah.listingFee },
        ].map(({ label, value }) => {
          const pct = tercacah.estimasi > 0 ? (value / tercacah.estimasi) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ color: TEXT }}>
                  {value > 0 ? formatRp(value) : "-"}
                  {pct > 0 && <span style={{ color: FAINT }}> · {pct.toFixed(1)}%</span>}
                </span>
              </div>
              <Bar pct={pct * 5} color={PRIMARY} />
            </div>
          );
        })}
        {/* Biaya Aktif vs Biaya Rencana, separated instead of blended
            straight into one "Total Budget" line (2026-08-05, stakeholder item #9:
            "Biaya Estimasi Tercacah di Ringkasan Draft — breakdown Estimasi Aktif,
            Biaya Aktif, dan Total Setelah Akumulasi POA Baru"). Biaya PSSP Rencana is
            the subtotal of the PSSP/Campaign-DPL-DPF/ENT bars above (= s.budgetTotal);
            Biaya PSSP Aktif is the still-running PSSP contracts' own budget contribution.
            Label diselaraskan ke "PSSP Rencana"/"PSSP Aktif" (2026-08-10, item #6 dari
            daftar 13 task baru). */}
        <div className="pt-2 space-y-1.5" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="flex justify-between text-xs">
            <span style={{ color: MUTED }}>Biaya PSSP Rencana</span>
            <span style={{ color: TEXT }}>{s.budgetTotal > 0 ? formatRp(s.budgetTotal) : "-"}</span>
          </div>
          {aktifPssp.kontrakTotal > 0 && (
            <div>
              <div className="flex justify-between text-xs">
                <span style={{ color: MUTED }}>Biaya PSSP Aktif</span>
                <span style={{ color: TEXT }}>{formatRp(aktifPssp.nilaiTotal)}</span>
              </div>
              <p className="text-xs" style={{ color: FAINT }}>
                {aktifPssp.kontrakTotal} kontrak · {aktifPssp.dokterCount} user
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-between pt-2 text-sm font-semibold"
          style={{ borderTop: `1px solid ${BORDER}`, color: TEXT }}>
          <span>Total Setelah Akumulasi POA Baru</span>
          <span>{formatRp(budgetTotalWithAktif)}</span>
        </div>
      </div>

      {/* ── 5. Cakupan ── */}
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
            label: "Target Produk Kontes ★",
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
          <p className="text-xs" style={{ color: MUTED }}>Jumlah Produk X Estimasi</p>
          <p className="text-sm font-bold" style={{ color: TEXT }}>{s.totalPengajuan}</p>
        </div>
      </div>

      {/* ── 6. Listing / Standarisasi ── */}
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

      {/* ── 7. Data Sales (collapsible) ── */}
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
    <div className="rounded-md px-2 py-1.5 min-w-0"
      style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
      <p className="text-[11px] leading-tight truncate" style={{ color: "var(--color-text-faint)" }}>{label}</p>
      <p className={`leading-tight truncate ${emphasize ? "text-xs sm:text-sm font-bold" : "text-xs sm:text-sm font-semibold"}`}
        style={{ color: "var(--color-text)" }}>
        {value}
      </p>
      {sub && <p className="text-[10px] leading-tight mt-0.5 truncate" style={{ color: "var(--color-text-faint)" }}>{sub}</p>}
    </div>
  );
}

function DoctorRow({
  doctorItems, checked, onToggle, selectable = true, totalEstimasi, poaId, userCanEdit, quarterMonths, everPsspKodeCust, otherDoctorsAtOutletCount, outletPsspInfo, doctorPsspInfo, showSubmit, doctorStatus, doctorVersion, doctorActions, doctorEditRequest, doctorRejectInfo,
}: {
  doctorItems: PoaLineItem[];
  checked: boolean;
  onToggle: () => void;
  selectable?: boolean;
  totalEstimasi: number;
  poaId?: string;
  userCanEdit?: boolean;
  quarterMonths: string[];
  /** kodeCust values with any PSSP history ever — see DraftChecklist's own prop doc. */
  everPsspKodeCust?: Set<string>;
  /** Dokter lain (selain baris ini) di outlet yang sama, dalam POA yang sama
   * (2026-08-10, item #7 dari daftar 13 task baru). */
  otherDoctorsAtOutletCount?: number;
  /** Feeds "PSSP Outlet" dropdown — server-computed per outlet (poa/[id]/page.tsx),
   * SENGAJA bukan hasil filter `activePssp` di sini — lihat catatan di
   * poa/[id]/page.tsx soal kenapa itu scope-nya salah untuk kebutuhan ini
   * (activePssp cuma mencakup territory MR pemilik POA, bukan outlet dokter
   * ini spesifik). */
  outletPsspInfo?: Record<string, { userCount: number; rencanaTercacahEstimasi: number; rencanaTercacahNilaiPssp: number; aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** This doctor's own Estimasi Aktif (docs/TODO.md #17, 2026-08-13) — see DraftChecklist's own prop doc. */
  doctorPsspInfo?: { aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number };
  /** Whether the draft-level submit UI is showing at all (owner + DRAFT/REVISI) — see DraftChecklist's own prop doc. */
  showSubmit?: boolean;
  /** This doctor's own PoaDoctorApproval.status — undefined means never submitted this cycle. */
  doctorStatus?: PoaStatus;
  /** This doctor's own PoaDoctorApproval.version — feeds the "Version X" chip next to its StatusBadge. */
  doctorVersion?: number;
  /** This viewer's atasan actions for this doctor — see DraftChecklist's own prop doc. */
  doctorActions?: DoctorActions;
  /** This doctor's edit-lock/request-edit state — see DraftChecklist's own prop doc. */
  doctorEditRequest?: DoctorEditRequestInfo;
  /** This doctor's rejection reason/category — see DraftChecklist's own prop doc. */
  doctorRejectInfo?: DoctorRejectInfo;
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
  // Jumlah Variasi (& Produk Kontes) — distinct products this doctor is planned
  // for, split by whether the product belongs to a Kontes paket.
  const variasiTotal = new Set(doctorItems.map((it) => it.kodeProduk)).size;
  const variasiKontes = new Set(
    doctorItems.filter((it) => getAllPakets(it.namaProduk).length > 0).map((it) => it.kodeProduk)
  ).size;
  const isDokterBaru = !first.kodeCust;
  // "No PSSP ever" — either not matched to a Customer record at all (isDokterBaru)
  // or matched but never actually had a PSSP contract (absent from
  // everPsspKodeCust). Stakeholder confirmed these are the same concept for
  // this purpose (2026-08-04, item #11), not two separate conditions.
  const hasPsspNow = !isDokterBaru && !!everPsspKodeCust?.has(first.kodeCust!);
  const noPsspHistory = !hasPsspNow;
  const qLabel = quarterLabelFromMonths(quarterMonths);
  // first.labelCustomer is a SNAPSHOT taken when this line item was created
  // (computeLabelCustomer in LineItemEditor.tsx, saved once into
  // PoaLineItem.labelCustomer) — it never gets recomputed afterward. A
  // customer who had no PSSP yet at that moment (saved as "" or literally
  // "Dokter Baru") but has since gotten a real PSSP contract synced in keeps
  // showing that stale label forever otherwise (2026-08-04 bug report: "masih
  // ada yang udah ada pssp nya tapi gaad label pernah pssp nya"). everPsspKodeCust
  // is the live check, so it wins whenever the two disagree — but a richer
  // stored label ("Pernah PSSP, Pelunasan Bagus", "Retensi", ...) that's
  // already consistent with hasPsspNow is left alone rather than flattened
  // to the generic fallback.
  const displayLabelCustomer = hasPsspNow && (!first.labelCustomer || first.labelCustomer === "Dokter Baru")
    ? "Pernah PSSP"
    : first.labelCustomer;
  const contribPct = totalEstimasi > 0 ? (rowEst / totalEstimasi) * 100 : 0;
  const [isDeleting, startDelete] = useTransition();
  const [detailOpen, setDetailOpen] = useState(false);
  const [outletInfoOpen, setOutletInfoOpen] = useState(false);

  // "PSSP Outlet" dropdown (2026-08-10) — semua 4 angka (Aktif & Rencana)
  // datang dari `outletPsspInfo`, server-computed sekali untuk semua outlet
  // di draft ini (poa/[id]/page.tsx), tercacah ke kuartal POA ini. TIDAK
  // pakai `activePssp` prop di sini — itu di-scope ke territory MR pemilik
  // POA (via MrOutletAssignment bulan berjalan), yang ternyata bisa
  // tidak mencakup outlet dokter ini (bug ditemukan 2026-08-10: dropdown
  // selalu "-" walau kontrak aktif riil ada, karena outlet itu assignment-nya
  // sedang dipegang MR lain bulan ini).
  const outletInfo = first.kodePI ? outletPsspInfo?.[first.kodePI] : undefined;

  function handleDelete() {
    if (!poaId) return;
    const label = doctorItems.length > 1 ? `${doctorItems.length} produk` : "1 produk";
    if (!confirm(`Hapus ${first.namaCust} beserta ${label}?`)) return;
    startDelete(async () => {
      for (const it of doctorItems) await deleteLineItemAction(poaId, it.id);
    });
  }

  // Per-doctor submit (docs/poa-per-doctor-approval/, OQ-2) — lets the owner
  // send THIS doctor to the atasan without touching the rest of the draft,
  // separate from the destructive "Ajukan ke Atasan" bulk flow below (which
  // deletes any unchecked doctor). Only offered when this doctor is actually
  // eligible: no PoaDoctorApproval row yet, or bounced back to REVISI.
  const canSubmitThisDoctor = !!showSubmit && !!poaId && !!userCanEdit && (!doctorStatus || doctorStatus === "REVISI");
  const [isSubmittingDoctor, startSubmitDoctor] = useTransition();
  const [doctorSubmitOpen, setDoctorSubmitOpen] = useState(false);
  const [doctorSubmitNotes, setDoctorSubmitNotes] = useState("");
  const doctorNotesRequired = doctorStatus === "REVISI";
  const doctorNotesMissing = doctorNotesRequired && !doctorSubmitNotes.trim();

  function handleSubmitDoctor() {
    if (!poaId || !first.kodePI || doctorNotesMissing) return;
    startSubmitDoctor(async () => {
      await submitDoctorAction(poaId, first.kodePI!, first.namaCust, doctorSubmitNotes.trim() || undefined);
      setDoctorSubmitOpen(false);
      setDoctorSubmitNotes("");
    });
  }

  // Atasan actions (approve/reject/fast-track/cancel) inline in this same row
  // (2026-08-14 request: "kenapa ga dibuat menyatu di draftnya juga" — these
  // used to live in a separate "Tindakan Per Dokter" list below the whole
  // checklist, duplicating the doctor's name). Reject and Cancel each still
  // need their own reason field, so both stay as real <form action> — the
  // approve/fast-track single-click actions do too, for the same free
  // pending-state styling a plain onClick handler doesn't get.
  const [atasanPanelOpen, setAtasanPanelOpen] = useState(false);

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
            {displayLabelCustomer && <LabelCustomerBadge label={displayLabelCustomer} />}
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {spesLabel(first.spesialisasi)}
            </span>
            {/* Info Periode (docs/TODO.md #20, 2026-08-13) — periode produk
                PERTAMA dokter ini, pola sama dengan field level-dokter lain
                (mis. labelCustomer) yang direpresentasikan dari `first`. Produk
                lain milik dokter yang sama BISA punya periode berbeda — lihat
                tabel Detail ▼ untuk breakdown per-produk apabila divergen. */}
            {first.periodeAwal && first.lamaPeriode && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
                {formatPeriodeRange(first.periodeAwal, first.lamaPeriode)}
              </span>
            )}
          </div>
          <p className="text-sm font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {first.namaOutlet}
            {!!otherDoctorsAtOutletCount && (
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
                +{otherDoctorsAtOutletCount} dokter lain di outlet ini
              </span>
            )}
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
            <StatTile label="Variasi Produk" value={`${variasiKontes}/${variasiTotal}`} sub="kontes/total" />
          </div>
          {/* Hidden for any doctor with zero PSSP history — whether truly new
              (no kodeCust) or already matched to a Customer record but never
              actually had a PSSP contract (see noPsspHistory / everPsspKodeCust
              above). This figure is always this same draft's own line items
              sliced to the quarter (see computeBiayaTercacah), which for a
              doctor with zero prior history is indistinguishable from (and
              reads as a confusing duplicate of) the "Estimasi" tile above
              (2026-08-03 #12, extended 2026-08-04 #11 to also cover matched
              customers with no PSSP history). */}
          {!noPsspHistory && (rowTercacah.estimasi > 0 || rowTercacah.nilaiPssp > 0) && (
            <div className="mt-1.5">
              <StatTile
                label={`Tercacah (Kuartal ${qLabel})`}
                value={formatRp(rowTercacah.estimasi)}
                sub={rowTercacah.nilaiPssp > 0 ? `Nilai PSSP ${formatRpPssp(rowTercacah.nilaiPssp)}` : undefined}
              />
            </div>
          )}
          {/* Estimasi Aktif — docs/TODO.md #17 (2026-08-13): this doctor's own
              currently-running PSSP contract(s), tercacah ke kuartal POA ini —
              distinct from "Tercacah" above (this draft's own plan) and from
              the outlet-wide "PSSP Outlet" dropdown (all doctors at that outlet). */}
          {doctorPsspInfo && (doctorPsspInfo.aktifTercacahEstimasi > 0 || doctorPsspInfo.aktifTercacahNilaiPssp > 0) && (
            <div className="mt-1.5">
              <StatTile
                label={`Estimasi Aktif (Kuartal ${qLabel})`}
                value={formatRp(doctorPsspInfo.aktifTercacahEstimasi)}
                sub={doctorPsspInfo.aktifTercacahNilaiPssp > 0 ? `Nilai PSSP ${formatRpPssp(doctorPsspInfo.aktifTercacahNilaiPssp)}` : undefined}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* Per-doctor status (docs/poa-per-doctor-approval/, 2026-08-18) —
              approval is per-doctor now, not per-draft, so the badge belongs
              here rather than as one whole-draft summary at the checklist
              header. Undefined doctorStatus means no PoaDoctorApproval row
              yet this cycle, same DRAFT state the rollup treats it as. */}
          <StatusBadge status={doctorStatus ?? "DRAFT"} version={doctorVersion} />
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
              <div className="flex items-center gap-2">
                <Link href={`/poa/${poaId}/doctor/${doctorItems[0].id}/edit`}
                  className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
                  style={userCanEdit
                    ? { background: "var(--color-blue)", color: "#fff" }
                    : { background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
                  {userCanEdit ? "Edit" : "Lihat"}
                </Link>
                {doctorActions && (
                  <button
                    type="button"
                    onClick={() => setAtasanPanelOpen((v) => !v)}
                    className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-opacity hover:opacity-90"
                    style={{ background: "var(--color-warning)", color: "#fff" }}>
                    Approval
                  </button>
                )}
              </div>
              {userCanEdit && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="text-xs" style={{ color: "var(--color-red)" }}>
                  Hapus
                </button>
              )}
              {canSubmitThisDoctor && (
                <Button type="button" size="sm" variant="orange" onClick={() => setDoctorSubmitOpen((v) => !v)}>
                  Ajukan dokter ini
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-col items-start gap-1 mt-1">
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
              Detail {detailOpen ? "▲" : "▼"}
            </button>
            <button
              type="button"
              onClick={() => setOutletInfoOpen((v) => !v)}
              className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
              PSSP Outlet {outletInfoOpen ? "▲" : "▼"}
            </button>
          </div>
        </div>
      </div>

      {doctorSubmitOpen && (
        <div className="mt-2.5 rounded-lg border p-3" style={{ borderColor: "var(--color-blue)" }}>
          <label className="flex flex-col gap-1 mb-2">
            <span className="text-xs" style={{ color: doctorNotesMissing ? "var(--color-red)" : "var(--color-text-muted)" }}>
              {doctorNotesRequired
                ? "Notes - jelaskan apa yang diubah dari revisi sebelumnya"
                : "Notes tambahan (opsional)"}
              {doctorNotesRequired && <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>}
            </span>
            <textarea
              value={doctorSubmitNotes}
              onChange={(e) => setDoctorSubmitNotes(e.target.value)}
              rows={2}
              placeholder={doctorNotesRequired
                ? "Jelaskan perubahan yang dilakukan untuk menjawab catatan revisi…"
                : "mis. konteks tambahan…"}
              className="input-field text-xs" />
            {doctorNotesMissing && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="orange" disabled={isSubmittingDoctor || doctorNotesMissing} onClick={handleSubmitDoctor}>
              {isSubmittingDoctor ? "Mengajukan…" : `Ajukan ${censorName(first.namaCust)}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDoctorSubmitOpen(false)}>Batal</Button>
          </div>
        </div>
      )}

      {/* Rejection label (2026-08-19: "si MR bisa liat mana line yang di
          reject") — shown whenever this doctor's current REVISI came from a
          REJECT or CANCEL, right on the row, instead of buried in the
          whole-draft audit log. */}
      {doctorRejectInfo && (
        <div className="mt-2.5 rounded-lg px-3 py-2.5 text-xs space-y-1"
          style={{ background: "var(--color-status-revisi-bg)", color: "var(--color-status-revisi)" }}>
          <p className="font-semibold">
            {doctorRejectInfo.action === "REJECT" ? "Ditolak" : "Dibatalkan"} oleh {doctorRejectInfo.rejectedByLabel}
            {doctorRejectInfo.category ? ` — ${doctorRejectInfo.category}` : ""}
          </p>
          {doctorRejectInfo.reason && <p className="font-normal italic">&quot;{doctorRejectInfo.reason}&quot;</p>}
        </div>
      )}

      {/* Edit-lock / request-edit — per doctor (docs/poa-per-doctor-approval/,
          2026-08-18: "tidak ada approval, request edit, dan revisi yang by
          draft" — used to be one whole-draft banner at the top of
          poa/[id]/page.tsx, now scoped to this one doctor). Always visible
          when relevant, not behind the "Approval" toggle below, since it
          concerns the OWNER (locked out) as much as the atasan (responding). */}
      {doctorEditRequest?.editLockRoleLabel && (
        <div className="mt-2.5 rounded-lg px-3 py-2.5 text-xs font-medium space-y-2"
          style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #f59e0b)" }}>
          <p>
            Dokter ini terkunci untuk diedit — sudah ada tindakan (approve/edit) dari level {displayRole(doctorEditRequest.editLockRoleLabel)} ke atas.
            {" "}
            {doctorEditRequest.pendingEditRequest
              ? "Menunggu persetujuan permintaan edit di bawah ini."
              : "Tunggu sampai direject/dibatalkan, atau ajukan permintaan edit di bawah ini."}
          </p>
          {doctorEditRequest.pendingEditRequest && (
            <p className="font-normal">
              Menunggu persetujuan {doctorEditRequest.lastApproverLabel ?? "atasan"} untuk membuka kembali akses edit.
            </p>
          )}
          {doctorEditRequest.canRequestEdit && !doctorEditRequest.pendingEditRequest && (
            <form action={doctorEditRequest.requestEditAction} className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-normal">
                  Alasan permintaan edit (opsional) — akan dikirim ke {doctorEditRequest.lastApproverLabel ?? "atasan"} yang terakhir approve
                </span>
                <textarea
                  name="reason"
                  rows={2}
                  placeholder="mis. ada koreksi jumlah/estimasi yang perlu diperbaiki…"
                  className="input-field text-xs" />
              </label>
              <Button type="submit" size="sm" variant="secondary">
                Ajukan Edit{doctorEditRequest.lastApproverLabel ? ` ke ${doctorEditRequest.lastApproverLabel}` : ""}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Permintaan edit dari MR — hanya muncul untuk approver terakhir yang dituju */}
      {doctorEditRequest?.canRespondEditRequest && (
        <div className="mt-2.5 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--color-blue)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Permintaan Edit</p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {censorName(first.namaCust)} — MR meminta izin untuk mengedit kembali dokter ini yang sudah Anda setujui.
            {doctorEditRequest.pendingEditRequestNote ? ` Alasan: "${doctorEditRequest.pendingEditRequestNote}"` : ""}
          </p>
          <form action={doctorEditRequest.grantEditRequestAction}>
            <Button type="submit" size="sm" style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}>
              Setujui Permintaan Edit (kembali ke Revisi)
            </Button>
          </form>
          <form action={doctorEditRequest.declineEditRequestAction} className="pt-2 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Menolak</span>
              <textarea
                name="reason"
                required
                rows={2}
                placeholder="Jelaskan alasan menolak permintaan edit ini…"
                className="input-field text-xs" />
            </label>
            <Button type="submit" size="sm" variant="danger">
              Tolak Permintaan Edit
            </Button>
          </form>
        </div>
      )}

      {atasanPanelOpen && doctorActions && (
        <div className="mt-2.5 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--color-blue)" }}>
          {(doctorActions.canApprove || doctorActions.canFastTrack) && (
            <div className="flex flex-wrap items-center gap-3">
              {doctorActions.canApprove && (
                <form action={doctorActions.approveAction}>
                  <Button type="submit" size="sm" style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}>
                    Approve &amp; Teruskan
                  </Button>
                </form>
              )}
              {doctorActions.canFastTrack && (
                <form action={doctorActions.fastTrackAction}>
                  <Button type="submit" size="sm" variant="secondary"
                    style={{ borderColor: "var(--color-warning, #f59e0b)", color: "var(--color-warning, #f59e0b)" }}>
                    Approve Langsung (Lewati ASM/SM)
                  </Button>
                </form>
              )}
            </div>
          )}
          {doctorActions.canFastTrack && (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Sebagai NSM, Anda bisa langsung menyetujui dokter ini sampai final tanpa menunggu approval ASM/SM.
            </p>
          )}
          {doctorActions.canApprove && (
            <form action={doctorActions.rejectAction} className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Kategori Reject</span>
                <select name="rejectCategory" required defaultValue="" className="input-field text-sm">
                  <option value="" disabled>Pilih kategori…</option>
                  {Object.entries(REJECT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Reject</span>
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder={`Jelaskan alasan reject dokter ${first.namaCust} - MR akan melihat catatan ini di Riwayat Aktivitas…`}
                  className="input-field text-sm" />
              </label>
              <Button type="submit" size="sm" variant="danger">
                Tolak Dokter Ini (kembali ke Revisi)
              </Button>
            </form>
          )}
          {doctorActions.canCancel && (
            <form action={doctorActions.cancelAction} className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Pembatalan</span>
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder={`Jelaskan alasan membatalkan approval dokter ${first.namaCust} - MR akan melihat catatan ini di Riwayat Aktivitas…`}
                  className="input-field text-sm" />
              </label>
              <Button type="submit" size="sm" variant="danger">
                Batalkan Approval Dokter Ini (kembali ke Revisi)
              </Button>
            </form>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setAtasanPanelOpen(false)}>Tutup</Button>
        </div>
      )}

      {outletInfoOpen && (
        <div className="mt-2.5 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
            {first.namaOutlet} — semua user di outlet ini{quarterMonths.length > 0 ? ` (tercacah ${qLabel})` : ""}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: "Jumlah User", value: (outletInfo?.userCount ?? 0).toLocaleString("id-ID") },
              { label: "Estimasi PSSP Aktif", value: (outletInfo?.aktifTercacahEstimasi ?? 0) > 0 ? formatRp(outletInfo!.aktifTercacahEstimasi) : "-" },
              { label: "Estimasi PSSP Rencana", value: (outletInfo?.rencanaTercacahEstimasi ?? 0) > 0 ? formatRp(outletInfo!.rencanaTercacahEstimasi) : "-" },
              { label: "Nilai PSSP Aktif", value: (outletInfo?.aktifTercacahNilaiPssp ?? 0) > 0 ? formatRpPssp(outletInfo!.aktifTercacahNilaiPssp) : "-" },
              { label: "Nilai PSSP Rencana", value: (outletInfo?.rencanaTercacahNilaiPssp ?? 0) > 0 ? formatRpPssp(outletInfo!.rencanaTercacahNilaiPssp) : "-" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md px-2.5 py-2" style={{ background: "var(--color-bg-subtle)" }}>
                <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{label}</p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--color-text-faint)" }}>
            Rencana = pengajuan yang sudah disubmit (bukan draft), tercacah ke kuartal ini. Aktif = kontrak PSSP yang masih berjalan.
          </p>
        </div>
      )}

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

export function DraftChecklist({ items, poaId, poaPeriod, showSubmit, userCanEdit, canAddDoctor, selectable = true, activePssp = [], outletPsspInfo = {}, doctorPsspInfo = {}, everPsspKodeCust = [], salesSummary, targetArea: targetAreaProp, doctorStatuses = {}, doctorVersions = {}, doctorActions = {}, doctorEditRequests = {}, doctorRejectInfo = {}, doctorCanEdit = {} }: {
  items: PoaLineItem[];
  poaId?: string;
  poaPeriod: string;
  showSubmit?: boolean;
  /** Whether this user can edit right now — server-computed (canEdit in
   * authz.ts), already accounts for Lock Edit Logic (someone above having
   * approved this cycle locks the owner out, routing them to "Ajukan Edit"
   * instead — see poa/[id]/page.tsx) and ownership/subtree visibility. No
   * extra client-side "click to unlock" gate on top of this (removed
   * 2026-07-31 — it required an extra click even before anyone had approved
   * anything, which is exactly when editing should just work immediately). */
  userCanEdit?: boolean;
  /** Whether this user can add a BRAND-NEW doctor right now — see
   * PoaDetailTabs' own prop doc. Controls the "+ Tambah User" link only;
   * everything else here still keys off userCanEdit. */
  canAddDoctor?: boolean;
  /** False for approvers viewing the checklist read-only — no checkboxes, all items count toward the summary. */
  selectable?: boolean;
  /** Still-active PSSP contracts for the doctors on this POA, for the ringkasan. */
  activePssp?: ActivePsspRow[];
  /** Per-outlet stats for "Informasi PSSP Outlet" dropdown (2026-08-10, item
   * baru: jumlah user + Rencana submitted tercacah per outlet) —
   * server-computed in poa/[id]/page.tsx, batched once for every outlet in
   * this draft (not per-row — see docs/PERFORMANCE.md §2.4). */
  outletPsspInfo?: Record<string, { userCount: number; rencanaTercacahEstimasi: number; rencanaTercacahNilaiPssp: number; aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** Per-doctor Estimasi Aktif (docs/TODO.md #17, 2026-08-13), keyed by
   * `${kodePI}|${namaCust}` — server-computed in poa/[id]/page.tsx, narrowed
   * from outletPsspInfo's outlet-wide rows down to just this one doctor's
   * own kodeCust. Absent entries mean zero/no active PSSP for that doctor. */
  doctorPsspInfo?: Record<string, { aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** kodeCust values that have EVER had a PSSP contract (any period, active or
   * expired — see getPsspEverKodeCust). A doctor matched to a Customer record
   * (kodeCust set) but absent from this list has never actually had PSSP,
   * same as a brand-new doctor for the "Tercacah (Kuartal Ini)" tile's
   * purposes (2026-08-04, stakeholder item #11). */
  everPsspKodeCust?: string[];
  /** Real "Data Sales" figures from getMrSalesSummary (server-computed, scoped
   * to this POA's own MR) — absent only if the caller genuinely couldn't
   * compute it, in which case the card shows zeros rather than a guess. */
  salesSummary?: SalesFigures;
  /** Real Target Value for this MR's own GT(s), summed for this POA's quarter
   * (TargetHospitalValue, server-computed — see poa/[id]/page.tsx). Falls back
   * to the dummy placeholder only if the caller genuinely has none to give
   * (e.g. an ASM/SM self-owned POA with no single "own GT" to sum — see the
   * same MR-only scoping note on poa/[id]/page.tsx's targetValueFromGT). */
  targetArea?: number;
  /** kodePI|namaCust -> that doctor's own PoaDoctorApproval.status, for the
   * per-doctor "Ajukan" button (docs/poa-per-doctor-approval/, OQ-2) — see
   * PoaDetailTabs' own prop doc. Absent key means never submitted this cycle. */
  doctorStatuses?: Record<string, PoaStatus>;
  /** kodePI|namaCust -> that doctor's own PoaDoctorApproval.version, for the
   * "Version X" chip next to that doctor's StatusBadge — see PoaDetailTabs'
   * own prop doc. */
  doctorVersions?: Record<string, number>;
  /** kodePI|namaCust -> this viewer's atasan actions for that one doctor
   * (approve/reject/fast-track/cancel) — see PoaDetailTabs' own prop doc.
   * Absent key means nothing to show for that doctor to this viewer. */
  doctorActions?: Record<string, DoctorActions>;
  /** kodePI|namaCust -> that doctor's edit-lock/request-edit state — see PoaDetailTabs' own prop doc. Computed for every doctor. */
  doctorEditRequests?: Record<string, DoctorEditRequestInfo>;
  /** kodePI|namaCust -> that doctor's rejection reason/category — see PoaDetailTabs' own prop doc. Absent key means no rejection behind this doctor's current state. */
  doctorRejectInfo?: Record<string, DoctorRejectInfo>;
  /** kodePI|namaCust -> per-doctor canEditDoctor result — see PoaDetailTabs'
   * own prop doc. This is what actually gates each row's Edit/Hapus/Ajukan
   * controls now, NOT the whole-draft `userCanEdit` above (docs/poa-per-doctor-approval/
   * OQ-3 — a sibling doctor being approved must never lock this one). Falls
   * back to `userCanEdit` for a doctor absent from the map. */
  doctorCanEdit?: Record<string, boolean>;
}) {
  const quarterMonths = useMemo(() => {
    try { return quarterToMonths(poaPeriod); } catch { return []; }
  }, [poaPeriod]);

  const canEditNow = !!userCanEdit;

  const everPsspKodeCustSet = useMemo(() => new Set(everPsspKodeCust), [everPsspKodeCust]);

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

  // Jumlah dokter lain per outlet (2026-08-10, item #7 dari daftar 13 task
  // baru) — feeds badge "N dokter lain di outlet ini" per DoctorRow, supaya
  // dokter-dokter di outlet yang sama gampang dikenali walau list-nya tetap
  // flat (bukan di-restructure jadi nested group per outlet).
  const doctorCountByOutlet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const key of groups.keys()) {
      const outletKey = key.split("|")[0];
      counts.set(outletKey, (counts.get(outletKey) ?? 0) + 1);
    }
    return counts;
  }, [groups]);

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

  // targetArea prefers the real server-computed Target Value (see poa/[id]/page.tsx);
  // only falls back to the dummy placeholder when the caller has none to give.
  // salesFigures is the real server-computed summary for this POA's MR.
  const targetArea = targetAreaProp ?? computeDummyTarget();
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
            targetAreaIsReal={targetAreaProp != null}
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
              {/* No whole-draft StatusBadge here anymore (docs/poa-per-doctor-approval/,
                  2026-08-18) — approval is per-doctor now, poaStatus is only a
                  best-effort rollup (resolvePoaRollup in poaWorkflow.ts) that
                  can't represent a draft with doctors at different stages.
                  Each DoctorRow below shows its own real status instead. */}
              {!!canAddDoctor && poaId && (
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
                userCanEdit={doctorCanEdit[key] ?? canEditNow}
                quarterMonths={quarterMonths}
                everPsspKodeCust={everPsspKodeCustSet}
                otherDoctorsAtOutletCount={(doctorCountByOutlet.get(key.split("|")[0]) ?? 1) - 1}
                outletPsspInfo={outletPsspInfo}
                doctorPsspInfo={doctorPsspInfo[key]}
                showSubmit={showSubmit}
                doctorStatus={doctorStatuses[key]}
                doctorVersion={doctorVersions[key]}
                doctorActions={doctorActions[key]}
                doctorEditRequest={doctorEditRequests[key]}
                doctorRejectInfo={doctorRejectInfo[key]}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Right: stats panel — sticky, scrollable internally so it never enlarges the page */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <StatsPanel
          items={selectedItems}
          selectedDoctorCount={checked.size}
          totalDoctorCount={allKeys.length}
          targetArea={targetArea}
          targetAreaIsReal={targetAreaProp != null}
          salesFigures={salesFigures}
          salesIsReal={!!salesSummary}
          quarterMonths={quarterMonths}
          activePssp={activePssp}
        />
      </div>
    </div>
  );
}
