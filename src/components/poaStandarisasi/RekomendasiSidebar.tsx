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
import { getStandarisasiProdukByOutletAction, getSalesHistoryByOutletAction, type StandarisasiProdukOutletRow, type SalesHistoryOutletRow } from "@/app/actions/poaStandarisasi";
import type { Product } from "@/lib/masterData";
import { formatKategoriLabel } from "@/lib/hargaST";

const SIDEBAR_ORANGE = "var(--color-orange, #ea580c)";
const SIDEBAR_GREEN = "var(--color-success, #16a34a)";
const SIDEBAR_BLUE = "var(--color-blue)";
const SIDEBAR_PURPLE = "var(--color-purple, #7c3aed)";

type Tab = "survey" | "kriteria" | "standarisasi" | "sales";

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
  const [standarisasiRows, setStandarisasiRows] = useState<StandarisasiProdukOutletRow[] | null>(null);
  const [salesHistoryRows, setSalesHistoryRows] = useState<SalesHistoryOutletRow[] | null>(null);
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
      setStandarisasiRows(null);
      setSalesHistoryRows(null);
      if (!kodePI) return;
      const [survey, kriteria, standarisasi, salesHistory] = await Promise.all([
        getSurveyRekomendasiByOutletAggregate(kodePI),
        getKriteriaByOutlet(kodePI),
        getStandarisasiProdukByOutletAction(kodePI, pengajuanId),
        getSalesHistoryByOutletAction(kodePI),
      ]);
      if (cancelled) return;
      setSurveyRows(survey);
      setKriteriaRows(kriteria);
      setStandarisasiRows(standarisasi);
      setSalesHistoryRows(salesHistory);
    });
    return () => { cancelled = true; };
  }, [kodePI, pengajuanId]);

  // "Sudah Standarisasi" has TWO independent sources, merged here so the
  // badge (and the "Sudah Standarisasi" tab itself) reflects either: (1) an
  // actual PoaStandarisasi pengajuan already submitted for this produk at
  // this outlet (standarisasiRows), or (2) the OutletProductKriteria import
  // already labels it "Produk Sudah Terstandarisasi..." (kriteriaBaru) — same
  // label POA Estimasi's KriteriaProdukPanel checks via
  // kriteria?.startsWith(...) for its own "Listing Corporate" sections. A
  // product can be true via either source independently of the other (e.g.
  // labeled standarisasi in the import long before this app ever had a
  // submitted pengajuan for it) — 2026-08-26 bug report: the tab itself only
  // read source (1), showing empty whenever no in-app submission existed yet
  // even though source (2) had plenty of labeled products.
  const standarisasiMerged: { kodeProduk: string; namaProduk: string; detail: string }[] = useMemo(() => {
    const byKode = new Map<string, { kodeProduk: string; namaProduk: string; detail: string }>();
    for (const r of standarisasiRows ?? []) {
      byKode.set(r.kodeProduk, { kodeProduk: r.kodeProduk, namaProduk: r.namaProduk, detail: `${r.statusPengajuan} · ${r.tipeStandarisasi} · disubmit ${new Date(r.submittedAt).toLocaleDateString("id-ID")}` });
    }
    for (const r of kriteriaRows ?? []) {
      if (byKode.has(r.kodeProduk) || !r.kriteriaBaru.startsWith("Produk Sudah Terstandarisasi")) continue;
      byKode.set(r.kodeProduk, { kodeProduk: r.kodeProduk, namaProduk: productByKode.get(r.kodeProduk)?.namaProduk ?? r.kodeProduk, detail: `Kriteria: ${r.kriteriaBaru}` });
    }
    return Array.from(byKode.values()).sort((a, b) => a.namaProduk.localeCompare(b.namaProduk, "id"));
  }, [standarisasiRows, kriteriaRows, productByKode]);

  const standarisasiKode = useMemo(() => new Set(standarisasiMerged.map((r) => r.kodeProduk)), [standarisasiMerged]);

  // "Belum" first, "Sudah" last (user request 2026-08-26) — so the products
  // still needing attention aren't buried below ones already standardized.
  function sortByStandarisasi<T extends { kodeProduk: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => Number(standarisasiKode.has(a.kodeProduk)) - Number(standarisasiKode.has(b.kodeProduk)));
  }

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
        <button type="button" onClick={() => setActiveTab("standarisasi")} style={edgeTabStyle(SIDEBAR_BLUE)}>
          Sudah Standarisasi
        </button>
        <button type="button" onClick={() => setActiveTab("sales")} style={edgeTabStyle(SIDEBAR_PURPLE)}>
          Historical Sales
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
          <button type="button" onClick={() => setActiveTab("standarisasi")} style={pillStyle(SIDEBAR_BLUE, activeTab === "standarisasi")}>Sudah Standarisasi</button>
          <button type="button" onClick={() => setActiveTab("sales")} style={pillStyle(SIDEBAR_PURPLE, activeTab === "sales")}>Historical Sales</button>
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
        {activeTab === "kriteria" && <KriteriaOutletPanel rows={kriteriaRows} productByKode={productByKode} standarisasiKode={standarisasiKode} sortByStandarisasi={sortByStandarisasi} />}
        {activeTab === "standarisasi" && <StandarisasiOutletPanel rows={standarisasiRows === null || kriteriaRows === null ? null : standarisasiMerged} />}
        {activeTab === "sales" && <SalesHistoryOutletPanel rows={salesHistoryRows} />}
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

/**
 * "Produk Rekomendasi" section buckets (2026-08-27, user request) — each row
 * lands in exactly ONE bucket by priority order (a row could technically
 * match more than one condition, e.g. Blue Ocean + Tidak Ada Sales — first
 * match wins so a product never appears twice), rows matching none of the 3
 * (e.g. kategori "Low Hanging Fruit" with a kriteriaBaru other than "Sudah
 * Terstandarisasi - Tidak Ada Sales") are NOT shown in this tab — only the 3
 * buckets the user specified, in this exact order.
 */
const KRITERIA_SECTIONS: { key: string; label: string; color: string; match: (r: KriteriaByOutlet) => boolean }[] = [
  {
    key: "sudah-standarisasi-corporate",
    label: "Sudah Standarisasi Corporate",
    color: "var(--color-orange, #ea580c)",
    match: (r) => r.kriteriaBaru === "Produk Sudah Terstandarisasi - Tidak Ada Sales",
  },
  {
    key: "blue-ocean",
    label: "Produk Rekomendasi PM (Kompetisi Rendah)",
    color: SIDEBAR_BLUE,
    match: (r) => r.kategori === "Blue Ocean",
  },
  {
    key: "red-ocean",
    label: "Produk Rekomendasi PM (Kompetisi Tinggi)",
    color: "var(--color-red, #dc2626)",
    match: (r) => r.kategori === "Red Ocean",
  },
];

function KriteriaOutletPanel({ rows, productByKode, standarisasiKode, sortByStandarisasi }: { rows: KriteriaByOutlet[] | null; productByKode: Map<string, Product>; standarisasiKode: Set<string>; sortByStandarisasi: <T extends { kodeProduk: string }>(rows: T[]) => T[] }) {
  const empty = <LoadingOrEmpty rows={rows} emptyText="Belum ada kriteria produk untuk outlet ini." />;
  if (!rows || rows.length === 0) return empty;

  const remaining = [...rows];
  const sections = KRITERIA_SECTIONS.map((section) => {
    const matched: KriteriaByOutlet[] = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (section.match(remaining[i])) matched.push(...remaining.splice(i, 1));
    }
    return { ...section, rows: sortByStandarisasi(matched.reverse()) };
  }).filter((s) => s.rows.length > 0);

  if (sections.length === 0) return empty;

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: section.color }}>
            {section.label} ({section.rows.length})
          </div>
          <div className="space-y-1.5">
            {section.rows.map((r) => (
              <div key={r.kodeProduk} className="rounded-lg border px-3 py-2" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{productByKode.get(r.kodeProduk)?.namaProduk ?? r.kodeProduk}</div>
                  <StandarisasiBadge done={standarisasiKode.has(r.kodeProduk)} />
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                  {r.paket} · {r.kriteriaBaru} · <span style={{ color: "var(--color-text-muted)" }}>{formatKategoriLabel(r.kategori)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StandarisasiOutletPanel({ rows }: { rows: { kodeProduk: string; namaProduk: string; detail: string }[] | null }) {
  const empty = <LoadingOrEmpty rows={rows} emptyText="Belum ada produk yang sudah standarisasi di outlet ini." />;
  if (!rows || rows.length === 0) return empty;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.kodeProduk} className="rounded-lg border px-3 py-2" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{r.namaProduk}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{r.detail}</div>
        </div>
      ))}
    </div>
  );
}

function formatPeriodeYyyymm(yyyymm: string): string {
  const y = yyyymm.slice(0, 4);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return m >= 1 && m <= 12 ? `${bulan[m - 1]} ${y}` : yyyymm;
}

/** Widget "Historical Sales per Produk/Outlet" (2026-09-08, user request) —
 * flat 12-bulan rollup per produk untuk outlet terpilih, sumber sama seperti
 * warning margin §3a (OutletSalesHistory), ditampilkan apa adanya di sini. */
function SalesHistoryOutletPanel({ rows }: { rows: SalesHistoryOutletRow[] | null }) {
  const empty = <LoadingOrEmpty rows={rows} emptyText="Belum ada histori sales untuk outlet ini." />;
  if (!rows || rows.length === 0) return empty;
  return (
    <div className="space-y-1.5">
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {rows.length} produk punya histori sales tercatat di outlet ini (12 bulan terakhir).
      </p>
      {rows.map((r) => (
        <div key={r.kodeProduk} className="rounded-lg border px-3 py-2" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{r.namaProduk}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {r.totalSales12Bln.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
            {formatPeriodeYyyymm(r.periodeFrom)} – {formatPeriodeYyyymm(r.periodeTo)}
          </div>
        </div>
      ))}
    </div>
  );
}
