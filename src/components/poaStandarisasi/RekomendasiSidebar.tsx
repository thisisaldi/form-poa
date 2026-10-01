"use client";

/**
 * POA Standarisasi's Phase 1 sidebar — spec'd in docs/poa-standarisasi/03-ui-and-access.md
 * as "RekomendasiSidebar" but never built (verified 2026-08-26 via grep, zero
 * matches for Sidebar|Panel in PoaStandarisasiWizard.tsx). Mirrors the fixed
 * right-side collapsible pattern from POA Estimasi's PsspSidebar
 * (LineItemEditor.tsx), but every tab here is aggregated PER OUTLET-PRODUK
 * (all dokter combined), not per single dokter — POA Standarisasi's row axis
 * is Produk × Outlet, and at Planning no single dokter is picked yet (see
 * PlanningPhase's own comment on why per-dokter scoring doesn't apply here).
 * Local to this feature folder, doesn't touch shared src/components/ui/.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getSurveyRekomendasiByOutletAggregate,
  getKriteriaByOutlet,
  type SurveyRekomendasiOutletRow,
  type KriteriaByOutlet,
} from "@/app/actions/customer";
import { getSalesHistoryByOutletAction, getActiveDplByOutletAction, getSalesLast3MonthsByOutletAction, getStandarisasiGroupOutletsAction, type SalesHistoryOutletRow, type StandarisasiGroupOutletRow } from "@/app/actions/poaStandarisasi";
import type { Product } from "@/lib/masterData";
import { isEndingThisQuarter } from "@/lib/quarterUtils";

const SIDEBAR_ORANGE = "var(--color-orange, #ea580c)";
const SIDEBAR_GREEN = "var(--color-success, #16a34a)";
const SIDEBAR_BLUE = "var(--color-blue)";
const SIDEBAR_RED = "var(--color-error, #dc2626)";

type Tab = "survey" | "kriteria" | "standarisasiSales";

type DplRow = { kodeProduk: string; prdAwal: string; prdAkhir: string; diskonPct: number };
type GroupOutlet = { namaOutlet: string; salesAvg3Bulan: number | null; dplPeriode: string | null; dplDiskonPct: number | null };
type StandarisasiCard = {
  kodeProduk: string;
  namaProduk: string;
  sales3Rp: number;
  dplDiskonPct: number;
  dplAwal: string;
  dplAkhir: string;
  expiring: boolean;
  history: SalesHistoryOutletRow | null;
};

const formatRp = (n: number) => n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function edgeTabStyle(color: string): React.CSSProperties {
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

function pillStyle(color: string, active: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
    cursor: "pointer", letterSpacing: "0.01em", border: `1px solid ${color}`,
    background: active ? color : "transparent",
    color: active ? "#fff" : color,
  };
}

export function RekomendasiSidebar({ kodePI, pengajuanId, productByKode }: { kodePI: string; pengajuanId?: string; productByKode: Map<string, Product> }) {
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [surveyRows, setSurveyRows] = useState<SurveyRekomendasiOutletRow[] | null>(null);
  const [kriteriaRows, setKriteriaRows] = useState<KriteriaByOutlet[] | null>(null);
  const [dplRows, setDplRows] = useState<DplRow[] | null>(null);
  const [salesQtrRows, setSalesQtrRows] = useState<{ kodeProduk: string; salesRp: number }[] | null>(null);
  const [salesHistoryRows, setSalesHistoryRows] = useState<SalesHistoryOutletRow[] | null>(null);
  const [groupOutletRows, setGroupOutletRows] = useState<StandarisasiGroupOutletRow[] | null>(null);
  const [, startLoad] = useTransition();

  useEffect(() => {
    // Guards against a stale response from a PREVIOUS outlet landing after a
    // newer one already resolved (network timing isn't guaranteed to match
    // request order) — without this, switching outlets quickly could leave
    // the sidebar showing the old outlet's data (2026-08-26 bug report).
    let cancelled = false;
    startLoad(async () => {
      setSurveyRows(null);
      setKriteriaRows(null);
      setSalesHistoryRows(null);
      setDplRows(null);
      setSalesQtrRows(null);
      setGroupOutletRows(null);
      if (!kodePI) return;
      const [survey, kriteria, salesHistory, dpl, salesQtr, groupOutlets] = await Promise.all([
        getSurveyRekomendasiByOutletAggregate(kodePI),
        getKriteriaByOutlet(kodePI),
        getSalesHistoryByOutletAction(kodePI),
        getActiveDplByOutletAction(kodePI),
        getSalesLast3MonthsByOutletAction(kodePI),
        getStandarisasiGroupOutletsAction(kodePI),
      ]);
      if (cancelled) return;
      setSurveyRows(survey);
      setKriteriaRows(kriteria);
      setSalesHistoryRows(salesHistory);
      setDplRows(dpl);
      setSalesQtrRows(salesQtr);
      setGroupOutletRows(groupOutlets);
    });
    return () => { cancelled = true; };
  }, [kodePI, pengajuanId]);

  // "Sudah Standarisasi" = ada sales (3 bulan penuh terakhir) DAN ada DPL aktif
  // bulan berjalan (user 2026-10-01; sebelumnya OR dari pengajuan submit /
  // label kriteria / DPL). Info Historical Sales (12 bln) digabung ke kartu
  // yang sama — satu tab, satu list. Produk yang cuma punya salah satunya
  // tampil di tab Produk Rekomendasi, bukan di sini.
  const standarisasiMerged: StandarisasiCard[] = useMemo(() => {
    if (!salesQtrRows || !dplRows) return [];
    const salesByKode = new Map(salesQtrRows.map((s) => [s.kodeProduk, s.salesRp]));
    const historyByKode = new Map((salesHistoryRows ?? []).map((h) => [h.kodeProduk, h]));
    return dplRows
      .filter((d) => salesByKode.has(d.kodeProduk))
      .map((d) => ({
        kodeProduk: d.kodeProduk,
        namaProduk: productByKode.get(d.kodeProduk)?.namaProduk ?? d.kodeProduk,
        sales3Rp: salesByKode.get(d.kodeProduk)!,
        dplDiskonPct: d.diskonPct,
        dplAwal: d.prdAwal,
        dplAkhir: d.prdAkhir,
        expiring: isEndingThisQuarter(d.prdAkhir),
        history: historyByKode.get(d.kodeProduk) ?? null,
      }))
      .sort((a, b) => a.namaProduk.localeCompare(b.namaProduk, "id"));
  }, [salesQtrRows, dplRows, salesHistoryRows, productByKode]);

  const standarisasiKode = useMemo(() => new Set(standarisasiMerged.map((r) => r.kodeProduk)), [standarisasiMerged]);

  // "Belum" first, "Sudah" last (user request 2026-08-26) — so the products
  // still needing attention aren't buried below ones already standardized.
  function sortByStandarisasi<T extends { kodeProduk: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => Number(standarisasiKode.has(a.kodeProduk)) - Number(standarisasiKode.has(b.kodeProduk)));
  }

  const groupOutletsByKode = useMemo(() => new Map((groupOutletRows ?? []).map((r) => [r.kodeProduk, r.outlets])), [groupOutletRows]);

  if (!kodePI) return null;

  if (activeTab === null) {
    return (
      <div style={{ position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 40, display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" onClick={() => setActiveTab("survey")} style={edgeTabStyle(SIDEBAR_ORANGE)}>
          Data Survey
        </button>
        <button type="button" onClick={() => setActiveTab("kriteria")} style={edgeTabStyle(SIDEBAR_GREEN)}>
          Produk Rekomendasi
        </button>
        <button type="button" onClick={() => setActiveTab("standarisasiSales")} style={edgeTabStyle(SIDEBAR_BLUE)}>
          Standarisasi & Historis Sales
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
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setActiveTab("survey")} style={pillStyle(SIDEBAR_ORANGE, activeTab === "survey")}>Data Survey</button>
          <button type="button" onClick={() => setActiveTab("kriteria")} style={pillStyle(SIDEBAR_GREEN, activeTab === "kriteria")}>Produk Rekomendasi</button>
          <button type="button" onClick={() => setActiveTab("standarisasiSales")} style={pillStyle(SIDEBAR_BLUE, activeTab === "standarisasiSales")}>Standarisasi & Historis Sales</button>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab(null)}
          style={{ color: "var(--color-text-faint)", fontSize: 18, lineHeight: 1, padding: "0 2px", cursor: "pointer", flexShrink: 0 }}
        >
          ›
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-3">
        {activeTab === "survey" && <SurveyOutletPanel rows={surveyRows} standarisasiKode={standarisasiKode} sortByStandarisasi={sortByStandarisasi} />}
        {activeTab === "kriteria" && <KriteriaOutletPanel rows={kriteriaRows} dplRows={dplRows} salesQtrRows={salesQtrRows} productByKode={productByKode} groupOutletsByKode={groupOutletsByKode} />}
        {activeTab === "standarisasiSales" && (
          <StandarisasiOutletPanel
            rows={salesQtrRows === null || dplRows === null || salesHistoryRows === null ? null : standarisasiMerged}
            groupOutletsByKode={groupOutletsByKode}
          />
        )}
      </div>
    </div>
  );
}

/** Badge shown on every product row across tabs — cross-referenced against the "Sudah Standarisasi" tab's data so it's visible without switching tabs. */
function StandarisasiBadge({ done }: { done: boolean }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide shrink-0"
      style={{
        background: done ? "var(--color-status-approved-bg, #E6F5EC)" : "var(--color-bg-subtle)",
        color: done ? "var(--color-status-approved, #008f42)" : "var(--color-text-faint)",
        border: `1px solid ${done ? "var(--color-status-approved, #008f42)" : "var(--color-border)"}`,
      }}
    >
      {done ? "✓ Sudah Standarisasi" : "Belum Standarisasi"}
    </span>
  );
}

function LoadingOrEmpty({ rows, emptyText }: { rows: unknown[] | null; emptyText: string }) {
  if (rows === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        {emptyText}
      </div>
    );
  }
  return null;
}

function SurveyOutletPanel({ rows, standarisasiKode, sortByStandarisasi }: { rows: SurveyRekomendasiOutletRow[] | null; standarisasiKode: Set<string>; sortByStandarisasi: <T extends { kodeProduk: string }>(rows: T[]) => T[] }) {
  const empty = <LoadingOrEmpty rows={rows} emptyText="Tidak ada data survey untuk outlet ini." />;
  if (!rows || rows.length === 0) return empty;
  const sorted = sortByStandarisasi(rows);
  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {rows.length} produk direkomendasikan survey di outlet ini (gabungan semua dokter).
      </p>
      {sorted.map((r) => (
        <div key={r.kodeProduk} className="rounded-lg border px-3 py-2 space-y-1.5" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{r.namaProdukRekomendasi}</div>
            <StandarisasiBadge done={standarisasiKode.has(r.kodeProduk)} />
          </div>
          <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            Direkomendasikan untuk <strong style={{ color: "var(--color-text-muted)" }}>{r.jumlahDokter}</strong> dokter
            {r.totalPotensiBulan != null && <> · Total potensi: <strong style={{ color: "var(--color-text-muted)" }}>{r.totalPotensiBulan.toLocaleString("id-ID")}</strong> / bulan</>}
          </div>
          {r.kompetitor.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {r.kompetitor.map((k, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                  {k.namaProduk} ({k.jumlahDokter} dokter)
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

function RecommendationPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
      style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {children}
    </span>
  );
}

/** Baris info sales + DPL satu produk (dipakai di tab Produk Rekomendasi). */
function SalesDplInfo({ salesRp, dpl }: { salesRp: number | undefined; dpl: DplRow | undefined }) {
  const ending = dpl ? isEndingThisQuarter(dpl.prdAkhir) : false;
  return (
    <div className="text-xs mt-1 space-y-0.5" style={{ color: "var(--color-text-faint)" }}>
      <div>{salesRp !== undefined ? <>Sales 3 bln terakhir: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(salesRp)}</strong></> : "Belum ada sales (3 bln terakhir)"}</div>
      <div style={{ color: ending ? "#d97706" : undefined, fontWeight: ending ? 600 : undefined }}>
        {dpl ? <>{ending && "⚠ "}DPL {dpl.diskonPct}% · {formatPeriodeYyyymm(dpl.prdAwal)} – {formatPeriodeYyyymm(dpl.prdAkhir)}{ending && " · mau habis"}</> : "Belum ada DPL"}
      </div>
    </div>
  );
}

/**
 * "Produk Rekomendasi" — section "Paket Produk Kontes" (user 2026-10-01):
 * produk rekomendasi (kriteria) di outlet ini dikelompokkan per status
 * sales/DPL: (1) ada sales, tidak ada DPL, (2) tidak ada sales, ada DPL,
 * (3) tidak ada keduanya. Tiap produk menampilkan sales 3 bln dan DPL
 * (% + periode) serta info RS segrup (tag Gap Group). Produk yang SUDAH
 * punya sales DAN DPL = sudah standarisasi, bukan gap, jadi tidak
 * ditampilkan di sini (ada di tab "Standarisasi & Historis Sales").
 */
function KriteriaOutletPanel({ rows, dplRows, salesQtrRows, productByKode, groupOutletsByKode }: {
  rows: KriteriaByOutlet[] | null;
  dplRows: DplRow[] | null;
  salesQtrRows: { kodeProduk: string; salesRp: number }[] | null;
  productByKode: Map<string, Product>;
  groupOutletsByKode: Map<string, GroupOutlet[]>;
}) {
  const loaded = rows !== null && dplRows !== null && salesQtrRows !== null;
  const empty = <LoadingOrEmpty rows={loaded ? rows : null} emptyText="Belum ada kriteria produk untuk outlet ini." />;
  if (!loaded || rows.length === 0) return empty;

  const dplByKode = new Map(dplRows.map((d) => [d.kodeProduk, d]));
  const salesByKode = new Map(salesQtrRows.map((s) => [s.kodeProduk, s.salesRp]));
  const nama = (kode: string) => productByKode.get(kode)?.namaProduk ?? kode;

  const salesNoDpl = rows.filter((r) => salesByKode.has(r.kodeProduk) && !dplByKode.has(r.kodeProduk));
  const dplNoSales = rows.filter((r) => dplByKode.has(r.kodeProduk) && !salesByKode.has(r.kodeProduk));
  const neither = rows.filter((r) => !dplByKode.has(r.kodeProduk) && !salesByKode.has(r.kodeProduk));
  if (dplNoSales.length + salesNoDpl.length + neither.length === 0) return empty;

  const card = "rounded-xl border px-3.5 py-3 shadow-sm";
  const cardStyle = { background: "var(--color-bg)", borderColor: "var(--color-border)" };
  const sub = (label: string, color: string, list: KriteriaByOutlet[], pill: (r: KriteriaByOutlet) => React.ReactNode, faded = false) =>
    list.length === 0 ? null : (
      <div>
        <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color }}>{label}</div>
        <div className="space-y-2">
          {list.map((r) => {
            const groupOutlets = groupOutletsByKode.get(r.kodeProduk);
            return (
              <div key={r.kodeProduk} className={card} style={{ ...cardStyle, opacity: faded ? 0.8 : 1 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold" style={{ color: "var(--color-text)" }}>{nama(r.kodeProduk)}</div>
                  {pill(r)}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-faint)" }}>{r.paket}</div>
                <SalesDplInfo salesRp={salesByKode.get(r.kodeProduk)} dpl={dplByKode.get(r.kodeProduk)} />
                {groupOutlets && groupOutlets.length > 0 && <GroupGapTag outlets={groupOutlets} />}
              </div>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Paket Produk Kontes</div>
      {sub("Ada Sales, Tidak Ada DPL", SIDEBAR_BLUE, salesNoDpl, (r) => <RecommendationPill color="#2563eb">{formatRp(salesByKode.get(r.kodeProduk) ?? 0)}</RecommendationPill>)}
      {sub("Tidak Ada Sales, Ada DPL", SIDEBAR_ORANGE, dplNoSales, (r) => <RecommendationPill color="#d97706">DPL {dplByKode.get(r.kodeProduk)?.diskonPct}%</RecommendationPill>)}
      {sub("Tidak Ada Sales & DPL", "var(--color-text-faint)", neither, () => <RecommendationPill color="#7c3aed">Belum ada</RecommendationPill>, true)}
    </div>
  );
}

/**
 * Tag "RS segrup" di kartu produk — expand-on-click nunjukin outlet LAIN dalam
 * group corporate yang sama yang sudah standarisasi produk ini (sales DAN
 * DPL), plus sales rata² 3 bln dan DPL (% + periode). Cuma dirender kalau ada
 * sibling.
 */
function GroupGapTag({ outlets }: { outlets: GroupOutlet[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] font-bold px-1.5 py-0.5 rounded"
        style={{ background: `color-mix(in srgb, ${SIDEBAR_RED} 10%, transparent)`, color: SIDEBAR_RED, cursor: "pointer" }}
      >
        {expanded ? "▾" : "▸"} {outlets.length} RS segrup sudah standarisasi
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg border max-h-40 overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
          {outlets.map((o, i) => (
            <div
              key={i}
              className="px-2 py-1 text-xs space-y-0.5"
              style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : undefined, color: "var(--color-text-muted)" }}
            >
              <div className="truncate">{o.namaOutlet}</div>
              {o.salesAvg3Bulan != null && (
                <div style={{ color: "var(--color-text-faint)" }}>Sales rata² 3 bln: {formatRp(o.salesAvg3Bulan)}</div>
              )}
              {o.dplPeriode && (
                <div style={{ color: "var(--color-text-faint)" }}>DPL{o.dplDiskonPct != null ? ` ${o.dplDiskonPct}%` : ""} · {o.dplPeriode}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPeriodeYyyymm(yyyymm: string): string {
  const y = yyyymm.slice(0, 4);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return m >= 1 && m <= 12 ? `${bulan[m - 1]} ${y}` : yyyymm;
}

/**
 * Tab "Standarisasi & Historis Sales" — satu list produk yang sudah
 * standarisasi (sales DAN DPL), tiap kartu memuat DPL (% + periode), sales 3
 * bln terakhir, historical sales 12 bln (digabung dari widget lama "Historical
 * Sales", user 2026-10-01), dan info RS segrup.
 */
function StandarisasiOutletPanel({ rows, groupOutletsByKode }: {
  rows: StandarisasiCard[] | null;
  groupOutletsByKode: Map<string, GroupOutlet[]>;
}) {
  const empty = <LoadingOrEmpty rows={rows} emptyText="Belum ada produk yang sudah standarisasi (ada sales dan DPL) di outlet ini." />;
  if (!rows || rows.length === 0) return empty;
  return (
    <div className="space-y-1.5">
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {rows.length} produk sudah standarisasi (ada sales dan DPL aktif) di outlet ini.
      </p>
      {rows.map((r) => {
        const groupOutlets = groupOutletsByKode.get(r.kodeProduk);
        return (
          <div key={r.kodeProduk} className="rounded-lg border px-3 py-2" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{r.namaProduk}</div>
            <div className="text-xs mt-0.5" style={{ color: r.expiring ? "#d97706" : "var(--color-text-faint)", fontWeight: r.expiring ? 600 : undefined }}>
              {r.expiring && "⚠ "}DPL {r.dplDiskonPct}% · {formatPeriodeYyyymm(r.dplAwal)} – {formatPeriodeYyyymm(r.dplAkhir)}{r.expiring && " · periode mau habis"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>Sales 3 bln terakhir: {formatRp(r.sales3Rp)}</div>
            {r.history && (
              <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Historical sales: {formatRp(r.history.totalSales12Bln)} ({formatPeriodeYyyymm(r.history.periodeFrom)} – {formatPeriodeYyyymm(r.history.periodeTo)})
              </div>
            )}
            {groupOutlets && groupOutlets.length > 0 && <GroupGapTag outlets={groupOutlets} />}
          </div>
        );
      })}
    </div>
  );
}
