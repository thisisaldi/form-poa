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
  variasiProdukFokus: number;
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
  /** Growth vs Quarter Sebelumnya (2026-07-28) — estimasi for the quarter
   * currently in view vs the quarter right before it, same across all 4
   * tabs. null when the previous quarter had nothing submitted to compare
   * against. See summary/page.tsx for how "quarter ini" is picked. */
  estimasiQuarterIni: number;
  estimasiQuarterSebelumnya: number;
  growthVsQuarterSebelumnyaPct: number | null;
}

/** Global unique counts — computed from all lineItems server-side to avoid double-counting */
export interface MonitoringTotals {
  customer: number;
  variasiProdukFokus: number;
  produkPssp: number;
  sudahStandar: number;
  prosesStandar: number;
  totalUniqueProducts: number;
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function MonitoringChecklist({
  groups,
  totals,
  salesAvailable = true,
}: {
  groups: MonitoringGroup[];
  totals?: MonitoringTotals;
  /** DIR10001B (OutletSalesValueMonthly) is outlet-level only — there's no
   * real per-customer/per-produk sales-value breakdown, so the "customer"
   * and "produk" /summary tabs have nothing genuine to show in this card
   * (2026-07-27: replaced the old dummySales() placeholder with real data
   * for "outlet"/"mr", see computeRealSales in summary/page.tsx). */
  salesAvailable?: boolean;
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
  const variasiProdukFok = totals?.variasiProdukFokus ?? groups.reduce((s, g) => s + g.variasiProdukFokus, 0);
  const produkPssp       = totals?.produkPssp       ?? groups.reduce((s, g) => s + g.produkPssp, 0);
  const terstandar       = totals?.sudahStandar      ?? groups.reduce((s, g) => s + g.terstandarisasi, 0);
  const proses           = totals?.prosesStandar     ?? groups.reduce((s, g) => s + g.prosesStandar, 0);
  const listingDenom     = totals?.totalUniqueProducts ?? pengajuan;
  const gap              = listingDenom - terstandar;

  const TEXT    = "var(--color-text)";
  const MUTED   = "var(--color-text-muted)";
  const FAINT   = "var(--color-text-faint)";
  const BORDER  = "var(--color-border)";
  const BG      = "var(--color-bg-subtle)";
  const PRIMARY = "var(--color-blue, #2563eb)";
  const DANGER  = "var(--color-danger, #dc2626)";

  const psspPctEst   = estimasi > 0 ? (psspTotal / estimasi) * 100 : 0;
  const discPctEst   = estimasi > 0 ? (discountTotal / estimasi) * 100 : 0;
  const entPctEst    = estimasi > 0 ? (entertainTotal / estimasi) * 100 : 0;
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

      {/* ── 1. Estimasi ── */}
      <div className="rounded-lg p-3 mb-5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <p className="text-xs mb-0.5" style={{ color: MUTED }}>
          {estimasiAktifTotal > 0 ? "Estimasi Aktif+Pengajuan" : "Estimasi POA"}
        </p>
        <p className="text-2xl font-bold" style={{ color: TEXT }}>
          {estimasiCombined > 0 ? formatRp(estimasiCombined) : "-"}
        </p>
        {estimasiAktifTotal > 0 && (
          <p className="text-xs mt-0.5" style={{ color: FAINT }}>
            Aktif {formatRp(estimasiAktifTotal)} · Pengajuan {formatRp(estimasi)}
          </p>
        )}
      </div>

      {/* ── 2. Variasi Produk ── */}
      <SectionTitle>Variasi Produk</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs mb-0.5" style={{ color: MUTED }}>Produk Fokus</p>
          <p className="text-xl font-bold" style={{ color: variasiProdukFok < 22 ? DANGER : TEXT }}>
            {variasiProdukFok}<span className="text-sm font-normal" style={{ color: FAINT }}>/22</span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: variasiProdukFok < 22 ? DANGER : FAINT }}>
            {variasiProdukFok >= 22 ? "terpenuhi ✓" : `kurang ${22 - variasiProdukFok}`}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs mb-0.5" style={{ color: MUTED }}>Produk PSSP</p>
          <p className="text-xl font-bold" style={{ color: TEXT }}>{produkPssp}</p>
          <p className="text-xs mt-0.5" style={{ color: FAINT }}>variasi ada PSSP</p>
        </div>
      </div>

      {/* ── 3. Anggaran ── */}
      <SectionTitle>Anggaran</SectionTitle>
      <div className="space-y-2.5 mb-5">
        {[
          { label: "PSSP",                 value: psspTotal,      pct: psspPctEst },
          { label: "Discount + DPL + DPF", value: discountTotal,  pct: discPctEst },
          { label: "Entertain",            value: entertainTotal, pct: entPctEst },
        ].map(({ label, value, pct }) => (
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
        ))}
        <div className="flex justify-between pt-2 text-sm font-semibold"
          style={{ borderTop: `1px solid ${BORDER}`, color: TEXT }}>
          <span>Total Budget</span>
          <span>
            {formatRp(budgetTotal)}
            {budgetPctEst > 0 && (
              <span className="ml-1.5 text-xs font-normal" style={{ color: FAINT }}>
                ({budgetPctEst.toFixed(1)}% dari estimasi)
              </span>
            )}
          </span>
        </div>
      </div>

      {/* ── 4. Cakupan ── */}
      <SectionTitle>Cakupan</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        {[
          {
            label: "Customer per MR",
            value: customer,
            sub: customer >= 30 ? "min. 30 ✓" : `min. 30 (kurang ${30 - customer})`,
            danger: false,
          },
          { label: "Produk PSSP / MR", value: produkPssp, sub: "variasi × PSSP", danger: false },
          { label: "Total Pengajuan",  value: pengajuan,  sub: "produk × customer", danger: false },
        ].map(({ label, value, sub, danger }) => (
          <div key={label} className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs mb-0.5" style={{ color: MUTED }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            {sub && <p className="text-xs mt-0.5" style={{ color: danger ? DANGER : FAINT }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── 5. Listing Produk ── */}
      <SectionTitle>Listing Produk</SectionTitle>
      <div className="mb-5 space-y-2">
        {listingDenom > 0 ? (
          <>
            <div className="h-2 rounded-full overflow-hidden flex" style={{ background: BORDER }}>
              <div className="h-full transition-all duration-300"
                style={{ width: `${(terstandar / listingDenom) * 100}%`, background: PRIMARY }} />
              <div className="h-full transition-all duration-300"
                style={{ width: `${(proses / listingDenom) * 100}%`, background: MUTED, opacity: 0.4 }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <span style={{ color: MUTED }}>Sudah listing <span style={{ color: TEXT, fontWeight: 600 }}>{terstandar}</span></span>
              <span style={{ color: MUTED }}>Proses <span style={{ color: TEXT, fontWeight: 600 }}>{proses}</span></span>
              {gap > 0 ? (
                <span style={{ color: DANGER }}>Belum <span style={{ fontWeight: 600 }}>{gap}</span> - perlu ditindaklanjuti</span>
              ) : (
                <span style={{ color: MUTED }}>Semua sudah listing ✓</span>
              )}
            </div>
            {totals && (
              <p className="text-xs" style={{ color: FAINT }}>
                Dihitung berdasarkan {listingDenom} variasi produk unik.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs" style={{ color: FAINT }}>Tidak ada data.</p>
        )}
      </div>

      {/* ── 6. Data Sales (collapsible, real — sourced from DIR10001B) ── */}
      <button
        type="button"
        onClick={() => setSalesOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left"
        style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <span className="text-xs" style={{ color: MUTED }}>Data Sales</span>
        <span className="text-xs" style={{ color: FAINT }}>{salesOpen ? "▲" : "▼"}</span>
      </button>

      {salesOpen && (
        salesAvailable ? (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Historis Tahun Lalu",  value: formatRp(historis2025) },
              { label: "Sales YTD",            value: formatRp(salesYtd) },
              { label: "Sales YTD + Estimasi", value: formatRp(salesPlusEst) },
              { label: "Growth YTD",           value: `${growthYtd >= 0 ? "+" : ""}${growthYtd.toFixed(1)}%`, danger: growthYtd < 0 },
              { label: "Achievement YTD+Est",  value: achieveYtd > 0 ? `${achieveYtd.toFixed(1)}%` : "-", danger: achieveYtd > 0 && achieveYtd < 100 },
            ].map(({ label, value, danger }) => (
              <div key={label} className="rounded-lg p-2.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                <p className="text-xs mb-0.5" style={{ color: FAINT }}>{label}</p>
                <p className="text-sm font-semibold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
              </div>
            ))}
            <p className="col-span-full text-xs mt-1" style={{ color: FAINT }}>
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
    </Card>
  );
}
