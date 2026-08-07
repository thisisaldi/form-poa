"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { SortableTh, compareSortValues, type SortDir } from "@/components/ui/SortableTh";

// Same abs-aware magnitude formatting TerritoryTable used (a negative value is
// well below the raw 1_000_000 threshold and would otherwise fall through to
// the raw-digit branch instead of "-X,X Jt").
function formatRp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return Math.round(n).toLocaleString("id-ID");
}

function fmtInt(n: number): string {
  return n.toLocaleString("id-ID");
}

function fmtNum(n: number | null, digits = 1): string {
  return n != null ? n.toFixed(digits) : "-";
}

export type RingkasanVariant = "outlet" | "customer" | "spesialisasi" | "produk" | "mr";

/**
 * Per-ROW counterpart of every metric the Ringkasan tab shows as ONE
 * company-wide number (docs/summary-ringkasan/01-business-rules.md §2/§4/§5).
 * Each field is computed in `summary/page.tsx` with the SAME formula the
 * Ringkasan tab uses, just parameterized on one group's own
 * `items`/`kesesuaianRows`/`groupActivePssp` arrays instead of the global ones.
 *
 * `null` = "not applicable to the tab this row was built for" (the applicability
 * matrix lives in the column config below, the data layer just leaves the field
 * null) OR "genuinely not available in the data model" — never a fabricated 0.
 * Same convention as `pelunasanRunningRate: number | null` used before this.
 */
export interface RingkasanRowMetrics {
  code: string;
  name: string;

  // Table 1 — every variant
  psspRencanaQBerjalan: { jumlah: number; value: number };
  psspAktifQSebelumnya: { jumlah: number; value: number };
  psspAktifQBerjalan: { jumlah: number; value: number };

  // Table 2
  target: number | null;                                   // mr only
  estimasiPsspRencana: { value: number; unit: number };     // all
  estimasiPsspAktif: { value: number; unit: number };       // all
  sales: number | null;                                     // mr, outlet
  pelunasan: { pct: number | null; actual: number } | null; // customer only

  // Table 3 — Manajemen Risiko
  avgLamaPeriodeRencana: number | null;
  avgLamaPeriodeAktif: number | null;

  // Table 3 — Customer
  jumlahCustomer: { rencana: number; aktif: number } | null;
  pihakBreakdownRencana: { user: number; kpdm: number } | null;
  avgPemberianPerCustomer: { rencana: number | null; aktif: number | null } | null;
  avgEstimasiBulananPerCustomer: { rencana: number | null; aktif: number | null } | null;
  custBaruVsRetensi: { rencana: { baru: number; retensi: number }; aktif: { baru: number; retensi: number } } | null;
  psspKeBerapa: { rencana: number | null; aktif: number | null } | null;

  // Table 3 — Produk
  avgVariasi: { rencana: number | null; aktif: number | null } | null;
  jumlahBaris: { rencana: number | null; aktif: number | null };

  // Table 3 — Produktifitas
  estimasiPsspPerMr: { rencana: number | null; aktif: number | null } | null;

  // Table 3 — Biaya (Aktif genuinely unavailable for DPL/DPF, DP, Entertain —
  // PsspKontrak has no per-component percentage fields, see business rules §5e)
  biayaPssp: { rencana: number; aktif: number } | null;
  biayaDplDpf: { rencana: number; aktif: null } | null;
  biayaDp: { rencana: number; aktif: null } | null;
  biayaListingFee: { rencana: number; aktif: number } | null;
  biayaEntertain: { rencana: number; aktif: null } | null;
}

interface ColumnDef {
  key: string;
  /** Header cell above `label` — consecutive columns sharing a group are merged into one spanning cell. */
  group: string;
  label: string;
  sortValue: (r: RingkasanRowMetrics) => number | string | null;
  render: (r: RingkasanRowMetrics) => ReactNode;
}

/** Rencana/Aktif pair in one cell — Table 3's 13 metrics each carry both
 * dimensions (docs/summary-ringkasan §5), and 26 separate columns would be
 * unreadable, so both dimensions share a cell with the same "R / A" prefixes
 * used consistently down the table. */
function PairCell({ rencana, aktif }: { rencana: string; aktif: string }) {
  return (
    <>
      <div style={{ color: "var(--color-text)" }}>
        <span className="text-[10px] mr-1" style={{ color: "var(--color-blue)" }}>R</span>{rencana}
      </div>
      <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        <span className="text-[10px] mr-1" style={{ color: "var(--color-green)" }}>A</span>{aktif}
      </div>
    </>
  );
}

const NA = "Tidak tersedia";

function MetricTable({
  title, subtitle, rows, codeLabel, columns,
}: {
  title: string;
  subtitle?: string;
  rows: RingkasanRowMetrics[];
  codeLabel: string;
  columns: ColumnDef[];
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    if (sortKey === "name") {
      return [...rows].sort((a, b) => compareSortValues(a.name, b.name, sortDir));
    }
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    return [...rows].sort((a, b) => compareSortValues(col.sortValue(a), col.sortValue(b), sortDir));
  }, [rows, columns, sortKey, sortDir]);

  // Merge consecutive columns that share a group into one spanning header cell.
  const groupSpans: { group: string; span: number }[] = [];
  for (const c of columns) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === c.group) last.span += 1;
    else groupSpans.push({ group: c.group, span: 1 });
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{title}</p>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{subtitle}</p>}
      </div>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {/* Frozen first column, same treatment TerritoryTable used
                    ("difreeze biar tetep keliatan kalau geser kanan"). */}
                <th className="py-2 px-3 sticky left-0 z-10"
                  style={{ background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }} />
                {groupSpans.map(({ group, span }, i) => (
                  <th key={`${group}|${i}`} colSpan={span}
                    className="py-1.5 px-3 font-semibold text-center whitespace-nowrap"
                    style={{ color: "var(--color-text-muted)", borderLeft: "1px solid var(--color-border)" }}>
                    {group}
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <SortableTh label={codeLabel} sortKey="name" currentKey={sortKey} currentDir={sortDir}
                  onSort={handleSort} align="left" sticky />
                {columns.map((c) => (
                  <SortableTh key={c.key} label={c.label} sortKey={c.key} currentKey={sortKey}
                    currentDir={sortDir} onSort={handleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.code} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-2 px-3 sticky left-0 z-10"
                    style={{ color: "var(--color-text)", background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" }}>
                    <p className="font-medium truncate max-w-[16rem]">{r.name}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.code}</p>
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="py-2 px-3 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * The three stacked metric tables shown on the Per Personil / Per Outlet /
 * Per Customer / Per Spesialisasi / Per Produk tabs of `/summary` — the same
 * metrics the Ringkasan tab shows as one company-wide number each, drilled
 * down per row ("tab agregat itu versi detailnya").
 *
 * Deliberately THREE separate tables, not one wide one — mirroring the three
 * requirement tables (PSSP Rencana/Aktif · Value+Unit · Breakdown Historis).
 * Which columns each table shows depends on `variant`, following the
 * applicability matrix from the requirement (see the gating below, tab by tab).
 */
export function RingkasanMetricsTables({
  rows, variant, codeLabel, quarterLabel, quarterSebelumnyaLabel,
}: {
  rows: RingkasanRowMetrics[];
  variant: RingkasanVariant;
  codeLabel: string;
  /** "YYYY-QN" of Q-Berjalan (the single quarter every tab is now scoped to). */
  quarterLabel: string;
  /** "YYYY-QN" of Q-Sebelumnya, or null when Q-Berjalan is malformed. */
  quarterSebelumnyaLabel: string | null;
}) {
  const isMr = variant === "mr";
  const isOutlet = variant === "outlet";
  const isCustomer = variant === "customer";
  const isProduk = variant === "produk";

  const qS = quarterSebelumnyaLabel ?? "Q-Sebelumnya";

  // ── Table 1 — identical for every variant (Jumlah + Value each) ───────────
  const table1: ColumnDef[] = [
    {
      key: "rencanaJumlah", group: `PSSP Rencana dari ${quarterLabel}`, label: "Jumlah",
      sortValue: (r) => r.psspRencanaQBerjalan.jumlah,
      render: (r) => fmtInt(r.psspRencanaQBerjalan.jumlah),
    },
    {
      key: "rencanaValue", group: `PSSP Rencana dari ${quarterLabel}`, label: "Value",
      sortValue: (r) => r.psspRencanaQBerjalan.value,
      render: (r) => formatRp(r.psspRencanaQBerjalan.value),
    },
    {
      key: "aktifBerJumlah", group: `PSSP Aktif dari ${quarterLabel}`, label: "Jumlah",
      sortValue: (r) => r.psspAktifQBerjalan.jumlah,
      render: (r) => fmtInt(r.psspAktifQBerjalan.jumlah),
    },
    {
      key: "aktifBerValue", group: `PSSP Aktif dari ${quarterLabel}`, label: "Value",
      sortValue: (r) => r.psspAktifQBerjalan.value,
      render: (r) => formatRp(r.psspAktifQBerjalan.value),
    },
    {
      key: "aktifSebJumlah", group: `PSSP Aktif dari ${qS}`, label: "Jumlah",
      sortValue: (r) => r.psspAktifQSebelumnya.jumlah,
      render: (r) => fmtInt(r.psspAktifQSebelumnya.jumlah),
    },
    {
      key: "aktifSebValue", group: `PSSP Aktif dari ${qS}`, label: "Value",
      sortValue: (r) => r.psspAktifQSebelumnya.value,
      render: (r) => formatRp(r.psspAktifQSebelumnya.value),
    },
  ];

  // ── Table 2 — Value + Unit pairs, columns gated per the matrix ────────────
  const table2: ColumnDef[] = [];
  if (isMr) {
    table2.push({
      key: "targetValue", group: "Target", label: "Value",
      sortValue: (r) => r.target,
      render: (r) => (r.target != null ? formatRp(r.target) : "-"),
    });
  }
  table2.push(
    {
      key: "estRencanaValue", group: "Estimasi PSSP Rencana", label: "Value",
      sortValue: (r) => r.estimasiPsspRencana.value,
      render: (r) => formatRp(r.estimasiPsspRencana.value),
    },
    {
      key: "estRencanaUnit", group: "Estimasi PSSP Rencana", label: "Unit (baris)",
      sortValue: (r) => r.estimasiPsspRencana.unit,
      render: (r) => fmtInt(r.estimasiPsspRencana.unit),
    },
    {
      key: "estAktifValue", group: "Estimasi PSSP Aktif", label: "Value",
      sortValue: (r) => r.estimasiPsspAktif.value,
      render: (r) => formatRp(r.estimasiPsspAktif.value),
    },
    {
      key: "estAktifUnit", group: "Estimasi PSSP Aktif", label: "Unit (kontrak)",
      sortValue: (r) => r.estimasiPsspAktif.unit,
      render: (r) => fmtInt(r.estimasiPsspAktif.unit),
    },
  );
  if (isMr || isOutlet) {
    table2.push({
      key: "salesValue", group: "Sales", label: "Value",
      sortValue: (r) => r.sales,
      render: (r) => (r.sales != null ? formatRp(r.sales) : "-"),
    });
  }
  if (isCustomer) {
    table2.push(
      {
        key: "pelunasanPct", group: "Pelunasan", label: "Value (%)",
        sortValue: (r) => r.pelunasan?.pct ?? null,
        render: (r) => (r.pelunasan?.pct != null ? `${r.pelunasan.pct.toFixed(1)}%` : "-"),
      },
      {
        key: "pelunasanActual", group: "Pelunasan", label: "Unit (nominal)",
        sortValue: (r) => r.pelunasan?.actual ?? null,
        render: (r) => (r.pelunasan != null ? formatRp(r.pelunasan.actual) : "-"),
      },
    );
  }

  // ── Table 3 — Breakdown Historis, grouped headers, Rencana/Aktif per cell ─
  const table3: ColumnDef[] = [];

  if (!isCustomer) {
    table3.push({
      key: "lamaPeriode", group: "Manajemen Risiko", label: "Rata-rata Lama Periode",
      sortValue: (r) => r.avgLamaPeriodeRencana,
      render: (r) => (
        <PairCell
          rencana={r.avgLamaPeriodeRencana != null ? `${fmtNum(r.avgLamaPeriodeRencana)} bln` : "-"}
          aktif={r.avgLamaPeriodeAktif != null ? `${fmtNum(r.avgLamaPeriodeAktif)} bln` : "-"}
        />
      ),
    });
  }

  if (!isCustomer) {
    table3.push(
      {
        key: "jumlahCustomer", group: "Customer", label: "Jumlah Customer",
        sortValue: (r) => r.jumlahCustomer?.rencana ?? null,
        render: (r) => (
          <PairCell
            rencana={r.jumlahCustomer != null ? fmtInt(r.jumlahCustomer.rencana) : "-"}
            aktif={r.jumlahCustomer != null ? fmtInt(r.jumlahCustomer.aktif) : "-"}
          />
        ),
      },
      {
        key: "pihak", group: "Customer", label: "Breakdown User / KPDM",
        sortValue: (r) => r.pihakBreakdownRencana?.user ?? null,
        // Aktif genuinely has no User/KPDM breakdown — PsspKontrak has no
        // pihakPssp-equivalent field at all (business rules §5b).
        render: (r) => (
          <PairCell
            rencana={r.pihakBreakdownRencana != null
              ? `User ${fmtInt(r.pihakBreakdownRencana.user)} · KPDM ${fmtInt(r.pihakBreakdownRencana.kpdm)}`
              : "-"}
            aktif={NA}
          />
        ),
      },
      {
        key: "pemberian", group: "Customer", label: "Rata-rata Pemberian per Customer",
        sortValue: (r) => r.avgPemberianPerCustomer?.rencana ?? null,
        render: (r) => (
          <PairCell
            rencana={r.avgPemberianPerCustomer?.rencana != null ? formatRp(r.avgPemberianPerCustomer.rencana) : "-"}
            aktif={r.avgPemberianPerCustomer?.aktif != null ? formatRp(r.avgPemberianPerCustomer.aktif) : "-"}
          />
        ),
      },
      {
        key: "estBulanan", group: "Customer", label: "Rata-rata Estimasi Bulanan per Customer",
        sortValue: (r) => r.avgEstimasiBulananPerCustomer?.rencana ?? null,
        render: (r) => (
          <PairCell
            rencana={r.avgEstimasiBulananPerCustomer?.rencana != null ? formatRp(r.avgEstimasiBulananPerCustomer.rencana) : "-"}
            aktif={r.avgEstimasiBulananPerCustomer?.aktif != null ? formatRp(r.avgEstimasiBulananPerCustomer.aktif) : "-"}
          />
        ),
      },
      {
        key: "baruRetensi", group: "Customer", label: "Customer Baru vs Retensi",
        sortValue: (r) => r.custBaruVsRetensi?.rencana.baru ?? null,
        render: (r) => (
          <PairCell
            rencana={r.custBaruVsRetensi != null
              ? `Baru ${fmtInt(r.custBaruVsRetensi.rencana.baru)} · Retensi ${fmtInt(r.custBaruVsRetensi.rencana.retensi)}`
              : "-"}
            aktif={r.custBaruVsRetensi != null
              ? `Baru ${fmtInt(r.custBaruVsRetensi.aktif.baru)} · Retensi ${fmtInt(r.custBaruVsRetensi.aktif.retensi)}`
              : "-"}
          />
        ),
      },
    );
  }

  // "PSSP KE BERAPA" is a DIRECT per-row ordinal on the Customer tab (that row
  // IS one customer) and the averaged variant everywhere else — same underlying
  // lookup, deliberately distinct labels so the two aren't confused.
  table3.push({
    key: "psspKeBerapa", group: "Customer",
    label: isCustomer ? "PSSP ke Berapa" : "Rata-Rata Estimasi PSSP ke Berapa",
    sortValue: (r) => r.psspKeBerapa?.rencana ?? null,
    render: (r) => (
      <PairCell
        rencana={r.psspKeBerapa?.rencana != null
          ? (isCustomer ? `ke-${r.psspKeBerapa.rencana.toFixed(0)}` : `ke-${fmtNum(r.psspKeBerapa.rencana)}`)
          : "-"}
        aktif={r.psspKeBerapa?.aktif != null
          ? (isCustomer ? `ke-${r.psspKeBerapa.aktif.toFixed(0)}` : `ke-${fmtNum(r.psspKeBerapa.aktif)}`)
          : "-"}
      />
    ),
  });

  if (!isCustomer) {
    table3.push({
      key: "variasi", group: "Produk", label: "Rata-Rata Variasi per Estimasi PSSP",
      sortValue: (r) => r.avgVariasi?.rencana ?? null,
      render: (r) => (
        <PairCell
          rencana={fmtNum(r.avgVariasi?.rencana ?? null)}
          aktif={fmtNum(r.avgVariasi?.aktif ?? null)}
        />
      ),
    });
  }
  table3.push({
    // "x" is not multiplication — the metric is the COUNT of rows per estimasi
    // PSSP (business rules §5c), named explicitly here so nobody reads it as
    // a product.
    key: "jumlahBaris", group: "Produk", label: "Jumlah Baris per Estimasi PSSP",
    sortValue: (r) => r.jumlahBaris.rencana,
    render: (r) => (
      <PairCell rencana={fmtNum(r.jumlahBaris.rencana)} aktif={fmtNum(r.jumlahBaris.aktif)} />
    ),
  });

  if (isMr) {
    table3.push({
      key: "perMr", group: "Produktifitas", label: "Estimasi PSSP per MR",
      sortValue: (r) => r.estimasiPsspPerMr?.rencana ?? null,
      render: (r) => (
        <PairCell
          rencana={r.estimasiPsspPerMr?.rencana != null ? formatRp(r.estimasiPsspPerMr.rencana) : "-"}
          aktif={r.estimasiPsspPerMr?.aktif != null ? formatRp(r.estimasiPsspPerMr.aktif) : "-"}
        />
      ),
    });
  }

  if (isMr || isOutlet || isProduk) {
    table3.push(
      {
        key: "biayaPssp", group: "Biaya", label: "PSSP",
        sortValue: (r) => r.biayaPssp?.rencana ?? null,
        render: (r) => (
          <PairCell
            rencana={r.biayaPssp != null ? formatRp(r.biayaPssp.rencana) : "-"}
            aktif={r.biayaPssp != null ? formatRp(r.biayaPssp.aktif) : "-"}
          />
        ),
      },
      {
        key: "biayaDplDpf", group: "Biaya", label: "DPL/DPF",
        sortValue: (r) => r.biayaDplDpf?.rencana ?? null,
        render: (r) => (
          <PairCell rencana={r.biayaDplDpf != null ? formatRp(r.biayaDplDpf.rencana) : "-"} aktif={NA} />
        ),
      },
    );
  }
  if (isMr || isOutlet) {
    table3.push(
      {
        key: "biayaDp", group: "Biaya", label: "DP",
        sortValue: (r) => r.biayaDp?.rencana ?? null,
        render: (r) => (
          <PairCell rencana={r.biayaDp != null ? formatRp(r.biayaDp.rencana) : "-"} aktif={NA} />
        ),
      },
      {
        key: "biayaListingFee", group: "Biaya", label: "Listing Fee",
        sortValue: (r) => r.biayaListingFee?.rencana ?? null,
        render: (r) => (
          <PairCell
            rencana={r.biayaListingFee != null ? formatRp(r.biayaListingFee.rencana) : "-"}
            aktif={r.biayaListingFee != null ? formatRp(r.biayaListingFee.aktif) : "-"}
          />
        ),
      },
      {
        key: "biayaEntertain", group: "Biaya", label: "Entertain",
        sortValue: (r) => r.biayaEntertain?.rencana ?? null,
        render: (r) => (
          <PairCell rencana={r.biayaEntertain != null ? formatRp(r.biayaEntertain.rencana) : "-"} aktif={NA} />
        ),
      },
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Belum ada data.
        </p>
      </Card>
    );
  }

  return (
    <SubTabbedTables
      tables={[
        {
          key: "pssp", label: "PSSP Rencana & Aktif",
          title: "PSSP Rencana & PSSP Aktif",
          subtitle: `Jumlah (kontrak/baris) dan Value tercacah (apportioned) untuk ${quarterLabel} dan ${qS}.`,
          columns: table1,
        },
        {
          key: "value", label: "Target / Estimasi / Sales / Pelunasan",
          title: "Target / Estimasi / Sales / Pelunasan",
          subtitle: "Value dan Unit tiap metrik, tercacah ke kuartal yang sedang difilter.",
          columns: table2,
        },
        {
          key: "historis", label: "Breakdown Historis",
          title: "Breakdown Historis",
          subtitle: "Tiap sel: R = dimensi PSSP Rencana, A = dimensi PSSP Aktif.",
          columns: table3,
        },
      ]}
      rows={rows}
      codeLabel={codeLabel}
    />
  );
}

/**
 * Sub-tab switcher for the 3 metric tables (2026-08-08 follow-up: stacking
 * all 3 made every tab page very long to scroll through — same pill-switcher
 * pattern as PsspSidebar's SidebarTabSwitcher in LineItemEditor.tsx, one
 * table visible at a time instead of all 3 stacked). Defaults to the first
 * table; switching sub-tabs doesn't reset sort state per table since each
 * `MetricTable` instance keeps mounted (just hidden), not unmounted.
 */
function SubTabbedTables({
  tables, rows, codeLabel,
}: {
  tables: { key: string; label: string; title: string; subtitle: string; columns: ColumnDef[] }[];
  rows: RingkasanRowMetrics[];
  codeLabel: string;
}) {
  const [active, setActive] = useState(tables[0].key);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {tables.map((t) => (
          <button key={t.key} type="button" onClick={() => setActive(t.key)}
            className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
            style={active === t.key
              ? { background: "var(--color-blue)", color: "#fff" }
              : { background: "var(--color-bg-subtle)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            {t.label}
          </button>
        ))}
      </div>
      {tables.map((t) => (
        <div key={t.key} style={{ display: active === t.key ? "block" : "none" }}>
          <MetricTable title={t.title} subtitle={t.subtitle} rows={rows} codeLabel={codeLabel} columns={t.columns} />
        </div>
      ))}
    </div>
  );
}
