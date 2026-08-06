"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

export interface MonitoringGroup {
  code: string;
  name: string;
  pic: string;
  estimasi: number;
  variasiProduk: number;
  variasiProdukKontes: number;
  produkPssp: number;
  customer: number;
  pengajuan: number;
  terstandarisasi: number;
  prosesStandar: number;
  gap: number;
  psspTotal: number;
  discountTotal: number;
  entertainTotal: number;
  budgetTotal: number;
  realisasi: number;
  gapVsRealisasi: number;
  historis2025: number;
  salesYtd: number;
  salesPlusEst: number;
  growthPct: number;
  achievementPct: number;
  /** Raw components behind growthPct/achievementPct — Ringkasan sums these
   * across groups to derive a true growth-of-totals / total achievement
   * instead of averaging each group's own %. See summary/page.tsx. */
  salesComparable: number;
  achievementBase: number;
  // Matriks Summary Per Outlet / Per Produk (2026-07-27) — real data, not the
  // dummy "Data Sales" block above. estimasiAktif/userPsspAktif are populated
  // for BOTH the "outlet" and "produk" tabs; userPsspAktifEstimasi (the
  // aktif+pengajuan UNION headcount) and listingFeeTotal only make sense per
  // OUTLET so they're 0 on the "produk" tab. avgPasienPerUser/avgStPerPasien
  // are per-PRODUCT averages so they're null outside the "produk" tab.
  estimasiAktif: number;
  userPsspAktif: number;
  userPsspAktifEstimasi: number;
  salesAktif: number;
  listingFeeTotal: number;
  avgPasienPerUser: number | null;
  avgStPerPasien: number | null;
  /** "Pelunasan (%) dari Estimasi, secara Running Rate" (2026-07-27 follow-up)
   * — outlet only, null elsewhere. See summary/page.tsx for the formula. */
  pelunasanRunningRate: number | null;
  /** Sum of PsspKontrak.biaya (flat per-contract cost) across active contracts
   * — the "Aktif" counterpart to budgetTotal's "Pengajuan" cost, both under
   * the "Biaya" column on outlet/produk tabs (2026-07-27). */
  biayaAktif: number;
  /** Growth vs Quarter Sebelumnya (2026-07-28, redefined 2026-07-30) — THIS
   * quarter's Estimasi (submitted POA plan) vs LAST quarter's REALISASI
   * (PSSP pelunasan actually recorded in those months), same across all 4
   * tabs. null when last quarter had no realisasi to compare against, or
   * nothing has been submitted yet this quarter. See summary/page.tsx. */
  estimasiQuarterIni: number;
  realisasiQuarterSebelumnya: number;
  growthVsQuarterSebelumnyaPct: number | null;
}

/** Global unique counts — computed from all lineItems server-side to avoid double-counting */
export interface MonitoringTotals {
  customer: number;
  variasiProdukKontes: number;
  produkPssp: number;
  sudahStandar: number;
  prosesStandar: number;
  totalUniqueProducts: number;
}

// ─── Design tokens (this card's palette — validated categorical/status set) ───

const TEXT    = "var(--color-text)";
const MUTED   = "var(--color-text-muted)";
const FAINT   = "var(--color-text-faint)";
const BORDER  = "var(--color-border)";
const SURFACE = "var(--color-surface)";
const BG      = "var(--color-bg-subtle)";
const BLUE    = "var(--color-blue)";
const GREEN   = "var(--color-green)";
const WARNING = "var(--color-warning)";
const DANGER  = "var(--color-red)";

// ─── UI primitives — dashboard-style building blocks ──────────────────────────
// (2026-07-30 rework: "section visualisasi... dirework agar lebih terlihat
// seperti dashboard visualisasi data, dengan metrics yang sama cuma beda
// tampilan aja" — same figures as the old plain-stat/thin-progress-bar layout,
// restyled as a hero figure + KPI tiles + meters + part-to-whole stacked bars.)

/** Figure contract: label + big value + optional signed delta/sub-caption. */
function StatTile({ label, value, sub, tone = "neutral", hero = false }: {
  label: string; value: string; sub?: string; tone?: "neutral" | "good" | "bad"; hero?: boolean;
}) {
  const valueColor = tone === "good" ? GREEN : tone === "bad" ? DANGER : TEXT;
  return (
    <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
      <p className="text-xs mb-1" style={{ color: MUTED }}>{label}</p>
      <p className={hero ? "text-4xl font-bold" : "text-xl font-bold"} style={{ color: valueColor }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: tone !== "neutral" ? valueColor : FAINT }}>{sub}</p>}
    </div>
  );
}

/** A ratio against a fixed target — track is a lighter step of the same ramp, fill carries severity. */
function Meter({ label, value, target, unitLabel }: { label: string; value: number; target: number; unitLabel: string }) {
  const ratio = target > 0 ? value / target : 0;
  const pct = Math.min(100, ratio * 100);
  const met = value >= target;
  const color = met ? GREEN : ratio >= 0.7 ? WARNING : DANGER;
  return (
    <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs" style={{ color: MUTED }}>{label}</p>
        <p className="text-sm font-bold" style={{ color: met ? GREEN : TEXT }}>
          {value}<span className="text-xs font-normal" style={{ color: FAINT }}>/{target}</span>
        </p>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-blue-light)" }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-xs mt-1.5" style={{ color: met ? GREEN : FAINT }}>
        {met ? "terpenuhi ✓" : `kurang ${target - value} ${unitLabel}`}
      </p>
    </div>
  );
}

interface Segment { label: string; value: number; color: string }

/** Part-to-whole: thin stacked bar (rounded outer ends, 2px surface gaps between
 * segments) with a direct-labeled legend underneath — every value stays visible,
 * not hidden behind hover-only. */
function StackedBar({ segments, totalLabel }: { segments: Segment[]; totalLabel?: string }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const nonZero = segments.filter((s) => s.value > 0);

  return (
    <div>
      {total > 0 ? (
        <div className="flex h-5 gap-[2px] rounded-full overflow-hidden" style={{ background: SURFACE }}>
          {nonZero.map((seg) => (
            <div key={seg.label} title={`${seg.label}: ${formatRp(seg.value)} (${((seg.value / total) * 100).toFixed(1)}%)`}
              style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }} />
          ))}
        </div>
      ) : (
        <div className="h-5 rounded-full" style={{ background: BORDER }} />
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
        {segments.map((seg) => (
          <span key={seg.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
            <span style={{ color: MUTED }}>{seg.label}</span>
            <span style={{ color: TEXT, fontWeight: 600 }}>{formatRp(seg.value)}</span>
            {total > 0 && seg.value > 0 && <span style={{ color: FAINT }}>({((seg.value / total) * 100).toFixed(1)}%)</span>}
          </span>
        ))}
        {totalLabel && (
          <span className="ml-auto font-semibold" style={{ color: TEXT }}>{totalLabel}</span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3 pt-4" style={{ color: FAINT, borderTop: `1px solid ${BORDER}` }}>
      {children}
    </p>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function MonitoringChecklist({
  groups,
  totals,
  salesAvailable = true,
  poaCount,
  outletCount,
  produkCount,
  targetTotal,
  costRatioPct,
  growthPct,
}: {
  groups: MonitoringGroup[];
  totals?: MonitoringTotals;
  /** DIR10001B (OutletSalesValueMonthly) is outlet-level only — there's no
   * real per-customer/per-produk sales-value breakdown, so the "customer"
   * and "produk" /summary tabs have nothing genuine to show in this card
   * (2026-07-27: replaced the old dummySales() placeholder with real data
   * for "outlet"/"mr", see computeRealSales in summary/page.tsx). */
  salesAvailable?: boolean;
  /** Ringkasan-tab-only figures (2026-07-31 rework — Ringkasan is now its own
   * tab, always Personil-scoped, see summary/page.tsx). Optional so this
   * component still degrades gracefully if ever reused elsewhere without them. */
  poaCount?: number;
  outletCount?: number;
  produkCount?: number;
  /** PoaForm.target summed across visible MRs — the one REAL target source
   * in this app (same as Monitoring's SalesAchievementTable), never a
   * fabricated stand-in. 0 means nobody has set one yet. */
  targetTotal?: number;
  costRatioPct?: number | null;
  /** Growth-of-totals (Estimasi kuartal ini vs Realisasi kuartal sebelumnya),
   * summed across every visible MR — same definition as the per-row Growth
   * column on the Per Personil table, just aggregated. */
  growthPct?: number | null;
}) {
  const [salesOpen, setSalesOpen] = useState(false);

  const estimasi      = groups.reduce((s, g) => s + g.estimasi, 0);
  const estimasiAktifTotal = groups.reduce((s, g) => s + g.estimasiAktif, 0);
  const estimasiCombined   = estimasi + estimasiAktifTotal;
  const pengajuan     = groups.reduce((s, g) => s + g.pengajuan, 0);
  const psspTotal     = groups.reduce((s, g) => s + g.psspTotal, 0);
  const discountTotal = groups.reduce((s, g) => s + g.discountTotal, 0);
  const entertainTotal = groups.reduce((s, g) => s + g.entertainTotal, 0);
  const budgetTotal   = groups.reduce((s, g) => s + g.budgetTotal, 0);
  const historis2025  = groups.reduce((s, g) => s + g.historis2025, 0);
  const salesYtd      = groups.reduce((s, g) => s + g.salesYtd, 0);
  const salesPlusEst  = groups.reduce((s, g) => s + g.salesPlusEst, 0);
  // Growth-of-totals / total-achievement, not an average of each group's own
  // % (2026-07-27 rework: averaging % here diverged from the summed
  // historis2025/salesYtd/salesPlusEst shown in the same card whenever group
  // sizes differ — classic Simpson's-paradox drift).
  const salesComparableTotal  = groups.reduce((s, g) => s + g.salesComparable, 0);
  const achievementBaseTotal  = groups.reduce((s, g) => s + g.achievementBase, 0);
  const growthYtd  = salesComparableTotal > 0 ? ((salesYtd - salesComparableTotal) / salesComparableTotal) * 100 : 0;
  const achieveYtd = achievementBaseTotal > 0 ? (salesPlusEst / achievementBaseTotal) * 100 : 0;

  // Unique counts — use server-computed totals to avoid cross-group double-counting
  const customer         = totals?.customer         ?? groups.reduce((s, g) => s + g.customer, 0);
  const variasiProdukKontes = totals?.variasiProdukKontes ?? groups.reduce((s, g) => s + g.variasiProdukKontes, 0);
  const produkPssp       = totals?.produkPssp       ?? groups.reduce((s, g) => s + g.produkPssp, 0);
  const terstandar       = totals?.sudahStandar      ?? groups.reduce((s, g) => s + g.terstandarisasi, 0);
  const proses           = totals?.prosesStandar     ?? groups.reduce((s, g) => s + g.prosesStandar, 0);
  const listingDenom     = totals?.totalUniqueProducts ?? pengajuan;
  const gap              = listingDenom - terstandar;

  const budgetPctEst = estimasi > 0 ? (budgetTotal / estimasi) * 100 : 0;

  if (groups.length === 0) {
    return (
      <Card>
        <p className="py-10 text-center text-sm" style={{ color: MUTED }}>
          Belum ada data pengajuan.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="font-semibold text-base mb-5" style={{ color: TEXT }}>Ringkasan</p>

      {/* ── Activity footprint (2026-07-31, Ringkasan-tab-only) ── */}
      {poaCount != null && outletCount != null && produkCount != null && (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <StatTile label="Jumlah POA" value={String(poaCount)} />
          <StatTile label="Jumlah Outlet" value={String(outletCount)} />
          <StatTile label="Jumlah Produk" value={String(produkCount)} />
        </div>
      )}

      {/* ── Hero figure — the one number this dashboard leads with ── */}
      <div className="rounded-lg p-4 mb-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <p className="text-xs mb-1" style={{ color: MUTED }}>
          {estimasiAktifTotal > 0 ? "Estimasi Aktif+Pengajuan" : "Estimasi POA"}
        </p>
        <p className="text-4xl font-bold" style={{ color: TEXT }}>
          {estimasiCombined > 0 ? formatRp(estimasiCombined) : "-"}
        </p>
        {estimasiAktifTotal > 0 && (
          <p className="text-xs mt-1.5" style={{ color: FAINT }}>
            Aktif {formatRp(estimasiAktifTotal)} · Pengajuan {formatRp(estimasi)}
          </p>
        )}
        {targetTotal != null && (
          <p className="text-xs mt-1.5" style={{ color: targetTotal > 0 ? MUTED : FAINT }}>
            {targetTotal > 0
              ? `Target ${formatRp(targetTotal)}${estimasiCombined > 0 ? ` · ${((estimasiCombined / targetTotal) * 100).toFixed(1)}% dari target` : ""}`
              : "Belum ada target."}
          </p>
        )}
      </div>

      {/* ── Kinerja (2026-07-31, Ringkasan-tab-only) — Cost Ratio + Growth, same
          growth-of-totals definition as the Per Personil table's Growth column. ── */}
      {(costRatioPct !== undefined || growthPct !== undefined) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <StatTile label="Cost Ratio" value={costRatioPct != null ? `${costRatioPct.toFixed(1)}%` : "-"} />
          <StatTile label="Growth vs Quarter Sebelumnya" value={growthPct != null ? `${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(1)}%` : "-"}
            tone={growthPct == null ? "neutral" : growthPct >= 0 ? "good" : "bad"} />
        </div>
      )}

      {/* ── KPI tiles — Variasi Produk + Cakupan, same figures as before ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Meter label="Produk Kontes" value={variasiProdukKontes} target={22} unitLabel="variasi" />
        <StatTile label="Produk PSSP" value={String(produkPssp)} sub="variasi ada PSSP" />
        <Meter label="Customer per MR" value={customer} target={30} unitLabel="customer" />
        <StatTile label="Total Pengajuan" value={String(pengajuan)} sub="produk × customer" />
      </div>

      {/* ── Anggaran — part-to-whole stacked bar instead of 3 separate thin bars ── */}
      <SectionTitle>Anggaran</SectionTitle>
      <StackedBar
        totalLabel={`Total ${formatRp(budgetTotal)}${budgetPctEst > 0 ? ` (${budgetPctEst.toFixed(1)}% dari estimasi)` : ""}`}
        segments={[
          { label: "PSSP", value: psspTotal, color: BLUE },
          { label: "Discount + DPL + DPF", value: discountTotal, color: WARNING },
          { label: "Entertain", value: entertainTotal, color: GREEN },
        ]}
      />

      {/* ── Listing Produk — status stacked bar ── */}
      <SectionTitle>Listing Produk</SectionTitle>
      {listingDenom > 0 ? (
        <>
          <StackedBar
            segments={[
              { label: "Sudah listing", value: terstandar, color: GREEN },
              { label: "Proses", value: proses, color: WARNING },
              { label: "Belum", value: Math.max(0, gap), color: DANGER },
            ]}
          />
          <p className="text-xs mt-2" style={{ color: gap > 0 ? DANGER : MUTED }}>
            {gap > 0 ? `${gap} produk belum listing — perlu ditindaklanjuti.` : "Semua sudah listing ✓"}
            {totals && <span style={{ color: FAINT }}> · dihitung dari {listingDenom} variasi produk unik.</span>}
          </p>
        </>
      ) : (
        <p className="text-xs" style={{ color: FAINT }}>Tidak ada data.</p>
      )}

      {/* ── Data Sales (collapsible, real — sourced from DIR10001B) ── */}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setSalesOpen((v) => !v)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left"
          style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <span className="text-xs font-medium" style={{ color: MUTED }}>Data Sales</span>
          <span className="text-xs" style={{ color: FAINT }}>{salesOpen ? "▲" : "▼"}</span>
        </button>

        {salesOpen && (
          salesAvailable ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatTile label="Historis Tahun Lalu" value={formatRp(historis2025)} />
              <StatTile label="Sales YTD" value={formatRp(salesYtd)} />
              <StatTile label="Sales YTD + Estimasi" value={formatRp(salesPlusEst)} />
              <StatTile label="Growth YTD" value={`${growthYtd >= 0 ? "+" : ""}${growthYtd.toFixed(1)}%`}
                tone={growthYtd >= 0 ? "good" : "bad"} />
              <StatTile label="Achievement YTD+Est" value={achieveYtd > 0 ? `${achieveYtd.toFixed(1)}%` : "-"}
                tone={achieveYtd === 0 ? "neutral" : achieveYtd >= 100 ? "good" : "bad"} />
              <p className="col-span-full text-xs" style={{ color: FAINT }}>
                Sumber: DIR10001B (nilai sales per outlet).
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs" style={{ color: FAINT }}>
              Data Sales cuma tersedia per Outlet atau per Personil - DIR10001B sumbernya per outlet,
              tidak ada breakdown per Customer/Produk.
            </p>
          )
        )}
      </div>
    </Card>
  );
}
