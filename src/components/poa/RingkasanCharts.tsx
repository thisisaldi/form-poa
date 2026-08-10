"use client";

// Chart components for the Ringkasan tab (docs/summary-ringkasan). Rewritten
// 2026-08-05 after three rounds of feedback on the Recharts-based version
// ("bar chartnya jelek", "too far apart", "masih jelek banget... pikirkan
// apakah perlu framework tambahan") — traced the actual root cause via this
// project's `dataviz` skill (`references/choosing-a-form.md`): every
// comparison in this tab is Rencana vs Aktif for the SAME metric, which is a
// "before → after per item" job. The skill's own form table answers that
// explicitly: **dumbbell**, not a grouped bar chart. Bars forced two skinny,
// separately-axis-banded columns per comparison — that's the actual reason
// they read as "too far apart," and fixed-width-plus-left-align was a
// band-aid on the wrong chart type, not a fix.
//
// Recharts has no first-class dumbbell primitive (you'd fight
// ComposedChart/Scatter to fake one), and `references/components.md` frames
// charts as "parts assembled in plain HTML/SVG" — both forms needed here
// (dumbbell, meter) are simple enough that hand-rolled SVG gives MORE
// control than bending a Cartesian-chart library toward a shape it isn't
// built for, and each row can be `width: 100%` of its own container instead
// of a fixed-pixel chart island with dead trailing space. So: Recharts was
// removed from this project entirely (`npm uninstall recharts react-is`) —
// nothing else in the codebase depended on it.
//
// Colors follow this app's own status vocabulary rather than inventing a new
// one: Rencana = --color-blue (this app's "planned/pending" hue, same as
// PoaStatus SUBMITTED_TO_* badges), Aktif = --color-green (this app's
// "approved/realized" hue, same as PoaStatus APPROVED_BY_NSM badges).
// Validated as a categorical pair: `node scripts/validate_palette.js
// "#0063a0,#008f42" --mode light --surface "#FFFFFF"` (dataviz skill) — all
// checks PASS (worst adjacent CVD ΔE 21.3, well above the 8 floor).

import { useState, type ReactNode, type CSSProperties } from "react";

const RENCANA_COLOR = "#0063a0"; // var(--color-blue)
const AKTIF_COLOR = "#008f42";   // var(--color-green)
// Aktif Sebelumnya (2026-08-08) — a historical snapshot of the SAME Aktif
// metric, one shade removed from the "live now" green above; orange matches
// this app's existing "attention/secondary" hue (e.g. Retensi badges
// elsewhere) without colliding with Rencana/Aktif's own identity.
const AKTIF_SEBELUMNYA_COLOR = "#ea580c"; // var(--color-orange)
const INK = "#2B2822";           // var(--color-text) — headline numbers stay ink, never the status/series hue
const MUTED = "#9C948A";         // var(--color-text-faint)

// Minimal shared hover tooltip — plain React state + an absolutely
// positioned div, same visual spec the old Recharts tooltips used (white
// bg, hairline border, 8px radius, 12px text) so the rest of the app's
// tooltip language doesn't shift. No library needed for this.
//
// IMPORTANT: the wrapper's own position/layout is caller-controlled via
// `wrapperStyle`/`wrapperClassName` (not hardcoded `relative inline-flex`
// here) — an earlier version hardcoded `position: relative` on this
// wrapper, which meant a dot positioned `absolute; left: N%` INSIDE it
// measured N% of the wrapper's own tiny size, not the outer track. That
// collapsed every dot toward the left edge regardless of its real value
// (screenshot feedback 2026-08-05: dots bunched at 0%, overlapping the
// label text, while the connector line — a sibling, not wrapped in this
// component — rendered at the correct proportion). Fix: this wrapper is now
// exactly what the caller asks for (`absolute` + explicit left/top for a
// dot anchored to the track; `relative w-full` for a full-width target like
// the meter) — the caller owns outer positioning, this component only owns
// the tooltip popup itself.
function HoverTarget({
  label, value, wrapperClassName, wrapperStyle, children,
}: {
  label: string; value: string;
  wrapperClassName: string; wrapperStyle?: CSSProperties;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <div
      className={wrapperClassName}
      style={wrapperStyle}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className="absolute z-10 px-2 py-1 whitespace-nowrap pointer-events-none"
          style={{
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#FFFFFF",
            border: "1px solid #E8E3D8",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <span style={{ color: MUTED }}>{label}: </span>
          <span style={{ color: INK, fontWeight: 600 }}>{value}</span>
        </div>
      )}
    </div>
  );
}

// Shared identity channel for a section's bar-pairs — per marks-and-
// anatomy.md "a legend is always present for two or more series." Rendered
// ONCE by the caller (Card header), not per row. Small filled squares —
// matplotlib/seaborn legend marker convention, not a dot (no longer a
// dumbbell) and not a line-swatch (these are bars).
export function RingkasanCompareLegend({ showSebelumnya = false, sebelumnyaQuarterLabel = "Q-Seb" }: { showSebelumnya?: boolean; sebelumnyaQuarterLabel?: string }) {
  return (
    <div className="flex items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
      {showSebelumnya && (
        <span className="flex items-center gap-1.5">
          <span style={{ width: 9, height: 9, background: AKTIF_SEBELUMNYA_COLOR, display: "inline-block" }} />
          PSSP Aktif {sebelumnyaQuarterLabel}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span style={{ width: 9, height: 9, background: RENCANA_COLOR, display: "inline-block" }} />
        PSSP Rencana
      </span>
      <span className="flex items-center gap-1.5">
        <span style={{ width: 9, height: 9, background: AKTIF_COLOR, display: "inline-block" }} />
        PSSP Aktif
      </span>
    </div>
  );
}

interface BarPairProps {
  rencanaVal: number;
  rencanaLabel: string;
  aktifVal: number;
  aktifLabel: string;
  // When the Aktif side genuinely has no data source (e.g. §5 Biaya's
  // DPL/DPF/DP/Entertain — PsspKontrak has no per-component % fields, see
  // docs/summary-ringkasan/01-business-rules.md §5e) — no Aktif bar at all,
  // not a misleading zero-height bar.
  aktifUnavailable?: boolean;
  // §2's two side-by-side panels get the roomier size with "Rencana"/"Aktif"
  // axis tick labels; §5's 14 stacked rows and §4's per-product list use the
  // compact size with no axis labels (the shared legend above already
  // establishes color = identity, repeating it under every row would be the
  // same "too much chart chrome" complaint from earlier rounds).
  compact?: boolean;
  // Optional 3rd bar (2026-08-08) — Aktif Q-Sebelumnya, a historical snapshot
  // of the same Aktif metric. Omitted entirely (2-bar layout, unchanged) on
  // rows that don't have this dimension (Manajemen Risiko, Biaya).
  sebelumnyaVal?: number;
  sebelumnyaLabel?: string;
  /** Kuartal aktual untuk bar ke-3, mis. "Q-2" (2026-08-10: tampilkan
   * kuartal langsung, bukan istilah relatif "Q-Seb"/"Q-Sebelumnya"). */
  sebelumnyaQuarterLabel?: string;
}

// Rencana vs Aktif (vs optionally Aktif Q-Sebelumnya), as a grouped bar
// chart — matplotlib/seaborn "whitegrid" styling: light horizontal
// gridlines behind flat (unrounded) bars, a thin bottom axis line, muted
// gray tick/label text. Built in raw SVG with an explicit viewBox coordinate
// system (not nested CSS `position: relative`/`absolute`, which is what
// caused the previous version's dots to collapse to the wrong position —
// SVG coordinates can't have that bug class, every mark's position is
// computed directly from the same x/y space). Values are direct-labeled
// above each bar (the actual figure is always visible without hovering); a
// native SVG `<title>` on each bar adds a hover tooltip with zero
// custom-positioning code, since the earlier custom HTML tooltip's
// positioning logic is exactly what broke twice.
export function RingkasanBarPair({ rencanaVal, rencanaLabel, aktifVal, aktifLabel, aktifUnavailable, compact, sebelumnyaVal, sebelumnyaLabel, sebelumnyaQuarterLabel = "Q-Seb" }: BarPairProps) {
  const hasSebelumnya = sebelumnyaVal != null && sebelumnyaLabel != null;
  // 3-bar rows get a wider canvas so bars stay a readable width instead of
  // shrinking the whole chart — same H/margins either way.
  const W = compact ? (hasSebelumnya ? 190 : 150) : (hasSebelumnya ? 270 : 220);
  const H = compact ? 74 : 110;
  const marginTop = compact ? 14 : 20;
  const marginBottom = compact ? 16 : 20;
  const plotTop = marginTop;
  const plotBottom = H - marginBottom;
  const plotH = plotBottom - plotTop;

  const max = Math.max(rencanaVal, aktifUnavailable ? 0 : aktifVal, hasSebelumnya ? sebelumnyaVal! : 0, 1);
  const rencanaH = (rencanaVal / max) * plotH;
  const aktifH = aktifUnavailable ? 0 : (aktifVal / max) * plotH;
  const sebelumnyaH = hasSebelumnya ? (sebelumnyaVal! / max) * plotH : 0;

  const barW = compact ? 34 : 40;
  const gap = compact ? 14 : 18;
  const centerX = W / 2;
  // Order left→right: Q-Sebelumnya, Rencana, Aktif when the 3rd bar is
  // present (2026-08-08 follow-up — was Rencana/Aktif/Sebelumnya, moved
  // Sebelumnya to lead since it's the earliest point in time of the three).
  // 2-bar layout (no Sebelumnya) is unchanged: Rencana, Aktif.
  const sebelumnyaX = centerX - barW * 1.5 - gap;
  const rencanaX = hasSebelumnya ? centerX - barW / 2 : centerX - barW - gap / 2;
  const aktifX = hasSebelumnya ? centerX + barW / 2 + gap : centerX + gap / 2;

  // 3 evenly-spaced horizontal gridlines — seaborn "whitegrid" convention,
  // hairline, one step off the surface, drawn BEHIND the bars.
  const gridlines = [0.25, 0.5, 0.75].map((f) => plotTop + plotH * f);

  return (
    // Fixed pixel width, NOT `width="100%"` — the SVG's default
    // `preserveAspectRatio="xMidYMid meet"` scales content to FIT a
    // container instead of stretching to fill it, so a small viewBox inside
    // a much wider card was rendering tiny and centered with huge dead
    // space on both sides (screenshot feedback 2026-08-05: "span nya lebar
    // banget... ga enak liatnya"). A fixed width matching the viewBox 1:1
    // means no scaling ambiguity at all — the chart is exactly as wide as
    // its content needs, and the caller's layout (flex row, not a
    // full-width block) controls how it sits next to its label.
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block shrink-0 mx-auto">
      {gridlines.map((y) => (
        <line key={y} x1={4} x2={W - 4} y1={y} y2={y} stroke="#E8E3D8" strokeWidth={1} />
      ))}
      {/* Bottom axis line — matplotlib's bottom spine */}
      <line x1={4} x2={W - 4} y1={plotBottom} y2={plotBottom} stroke="#C8C0B0" strokeWidth={1} />

      {/* Aktif Q-Sebelumnya bar — 3rd bar, leftmost, only when this metric
          carries the dimension. */}
      {hasSebelumnya && (
        <>
          <rect x={sebelumnyaX} y={plotBottom - sebelumnyaH} width={barW} height={sebelumnyaH} fill={AKTIF_SEBELUMNYA_COLOR}>
            <title>{`PSSP Aktif ${sebelumnyaQuarterLabel}: ${sebelumnyaLabel}`}</title>
          </rect>
          <text x={sebelumnyaX + barW / 2} y={plotBottom - sebelumnyaH - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
            {sebelumnyaLabel}
          </text>
        </>
      )}

      {/* Rencana bar — flat rectangle, no corner rounding (matplotlib default) */}
      <rect x={rencanaX} y={plotBottom - rencanaH} width={barW} height={rencanaH} fill={RENCANA_COLOR}>
        <title>{`PSSP Rencana: ${rencanaLabel}`}</title>
      </rect>
      <text x={rencanaX + barW / 2} y={plotBottom - rencanaH - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
        {rencanaLabel}
      </text>

      {/* Aktif bar, or a muted "Tidak tersedia" note at the baseline */}
      {aktifUnavailable ? (
        <text x={aktifX + barW / 2} y={plotBottom - 5} textAnchor="middle" fontSize={10} fill={MUTED}>
          Tidak tersedia
        </text>
      ) : (
        <>
          <rect x={aktifX} y={plotBottom - aktifH} width={barW} height={aktifH} fill={AKTIF_COLOR}>
            <title>{`PSSP Aktif: ${aktifLabel}`}</title>
          </rect>
          <text x={aktifX + barW / 2} y={plotBottom - aktifH - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
            {aktifLabel}
          </text>
        </>
      )}

      {/* Category tick labels — always shown now (2026-08-05 follow-up:
          "ada keterangannya") so every chart is self-explanatory on its
          own, not dependent on scrolling back up to the shared legend. */}
      {hasSebelumnya && (
        <text x={sebelumnyaX + barW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill={MUTED}>{sebelumnyaQuarterLabel}</text>
      )}
      <text x={rencanaX + barW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill={MUTED}>Rencana</text>
      <text x={aktifX + barW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill={MUTED}>Aktif</text>
    </svg>
  );
}

interface BarPart { subLabel: string; value: number; display: string }
interface SplitBarPairProps {
  rencanaParts: BarPart[];
  // null = genuinely unavailable (e.g. §5b "Breakdown User/KPDM" Aktif side
  // — PsspKontrak has no pihakPssp field at all, see docs/summary-ringkasan
  // /01-business-rules.md §5b) — shows "Tidak tersedia", not fabricated
  // zero-value bars.
  aktifParts: BarPart[] | null;
  // Optional 3rd cluster (2026-08-08) — Aktif Q-Sebelumnya. Omitted entirely
  // on rows that don't carry this dimension.
  sebelumnyaParts?: BarPart[] | null;
  /** Kuartal aktual untuk cluster ke-3, mis. "Q-2" (2026-08-10: tampilkan
   * kuartal langsung, bukan istilah relatif "Q-Seb"/"Q-Sebelumnya"). */
  sebelumnyaQuarterLabel?: string;
}

// §5b's two composite rows (Breakdown User/KPDM, Jumlah Customer Baru vs
// Retensi) as a real chart (2026-08-05 follow-up: "buat chartnya juga jadi
// rencana ada dua bar, yang aktif ada dua bar") — two bar clusters
// (Rencana, Aktif), each cluster made of N sub-category bars (User/KPDM, or
// Baru/Retensi) sharing one scale so cluster totals and sub-category splits
// are both readable at once. Same matplotlib/seaborn styling as
// `RingkasanBarPair` (gridlines, flat bars, muted axis) — this is that same
// visual language generalized from 1 bar per side to N.
export function RingkasanSplitBarPair({ rencanaParts, aktifParts, sebelumnyaParts, sebelumnyaQuarterLabel = "Q-Seb" }: SplitBarPairProps) {
  const hasSebelumnya = sebelumnyaParts !== undefined;
  const W = hasSebelumnya ? 300 : 220;
  const H = 86;
  const marginTop = 16;
  const marginBottom = 34;
  const plotBottom = H - marginBottom;
  const plotH = plotBottom - marginTop;

  const allVals = [...rencanaParts.map((p) => p.value), ...(aktifParts?.map((p) => p.value) ?? []), ...(sebelumnyaParts?.map((p) => p.value) ?? [])];
  const max = Math.max(...allVals, 1);
  const barW = 20;
  const innerGap = 6;
  const clusterGap = hasSebelumnya ? 16 : 20;

  const rencanaClusterW = rencanaParts.length * barW + (rencanaParts.length - 1) * innerGap;
  const aktifCount = aktifParts?.length ?? rencanaParts.length;
  const aktifClusterW = aktifCount * barW + (aktifCount - 1) * innerGap;
  const sebelumnyaCount = sebelumnyaParts?.length ?? rencanaParts.length;
  const sebelumnyaClusterW = sebelumnyaCount * barW + (sebelumnyaCount - 1) * innerGap;
  const totalW = rencanaClusterW + clusterGap + aktifClusterW + (hasSebelumnya ? clusterGap + sebelumnyaClusterW : 0);
  // Order left→right: Q-Sebelumnya, Rencana, Aktif when present (2026-08-08
  // follow-up, same reordering as RingkasanBarPair).
  const leftMostW = (W - totalW) / 2;
  const sebelumnyaStartX = leftMostW;
  const startX = hasSebelumnya ? sebelumnyaStartX + sebelumnyaClusterW + clusterGap : leftMostW;
  const aktifStartX = startX + rencanaClusterW + clusterGap;

  const gridlines = [0.25, 0.5, 0.75].map((f) => marginTop + plotH * f);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block shrink-0 mx-auto">
      {gridlines.map((y) => (
        <line key={y} x1={4} x2={W - 4} y1={y} y2={y} stroke="#E8E3D8" strokeWidth={1} />
      ))}
      <line x1={4} x2={W - 4} y1={plotBottom} y2={plotBottom} stroke="#C8C0B0" strokeWidth={1} />

      {hasSebelumnya && (
        sebelumnyaParts == null ? (
          <text x={sebelumnyaStartX + sebelumnyaClusterW / 2} y={plotBottom - 5} textAnchor="middle" fontSize={9} fill={MUTED}>
            Tidak tersedia
          </text>
        ) : (
          sebelumnyaParts.map((p, i) => {
            const x = sebelumnyaStartX + i * (barW + innerGap);
            const h = (p.value / max) * plotH;
            return (
              <g key={p.subLabel}>
                <rect x={x} y={plotBottom - h} width={barW} height={h} fill={AKTIF_SEBELUMNYA_COLOR}>
                  <title>{`PSSP Aktif ${sebelumnyaQuarterLabel} ${p.subLabel}: ${p.display}`}</title>
                </rect>
                <text x={x + barW / 2} y={plotBottom - h - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>{p.display}</text>
                <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill={MUTED}>{p.subLabel}</text>
              </g>
            );
          })
        )
      )}

      {rencanaParts.map((p, i) => {
        const x = startX + i * (barW + innerGap);
        const h = (p.value / max) * plotH;
        return (
          <g key={p.subLabel}>
            <rect x={x} y={plotBottom - h} width={barW} height={h} fill={RENCANA_COLOR}>
              <title>{`PSSP Rencana ${p.subLabel}: ${p.display}`}</title>
            </rect>
            <text x={x + barW / 2} y={plotBottom - h - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>{p.display}</text>
            <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill={MUTED}>{p.subLabel}</text>
          </g>
        );
      })}

      {aktifParts == null ? (
        <text x={aktifStartX + aktifClusterW / 2} y={plotBottom - 5} textAnchor="middle" fontSize={9} fill={MUTED}>
          Tidak tersedia
        </text>
      ) : (
        aktifParts.map((p, i) => {
          const x = aktifStartX + i * (barW + innerGap);
          const h = (p.value / max) * plotH;
          return (
            <g key={p.subLabel}>
              <rect x={x} y={plotBottom - h} width={barW} height={h} fill={AKTIF_COLOR}>
                <title>{`PSSP Aktif ${p.subLabel}: ${p.display}`}</title>
              </rect>
              <text x={x + barW / 2} y={plotBottom - h - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>{p.display}</text>
              <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill={MUTED}>{p.subLabel}</text>
            </g>
          );
        })
      )}

      {hasSebelumnya && (
        <text x={sebelumnyaStartX + sebelumnyaClusterW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={MUTED}>{sebelumnyaQuarterLabel}</text>
      )}
      <text x={startX + rencanaClusterW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={MUTED}>Rencana</text>
      <text x={aktifStartX + aktifClusterW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={MUTED}>Aktif</text>
    </svg>
  );
}

interface TargetStackedBarProps {
  // Target is always the 100% baseline. Rencana/Aktif are each expressed as
  // a % of Target (may individually or combined exceed 100%) and stacked
  // end-to-end in one horizontal bar, same Rencana=blue/Aktif=green identity
  // as every other chart in this tab, rather than two separately-scaled bars
  // — this is "how much of Target is covered, broken down by source"; a
  // single stacked bar is the direct answer, a grouped bar isn't (2026-08-06
  // follow-up: "horizontal stacked bar chart... target itu 100%, PSSP
  // rencananya kontribusi ke target berapa persen, dan PSSP Aktifnya
  // kontribusi ke target berapa persen").
  rencanaPct: number | null;
  aktifPct: number | null;
  rencanaLabel: string;
  aktifLabel: string;
}

// §3 Pencapaian Target — stacked contribution toward Target=100%. Track
// width scales to whichever is larger, 100 or the actual combined total, so
// the Target reference line always lands inside the visible bar even when
// Rencana+Aktif together exceed 100% of Target.
export function RingkasanTargetStackedBar({ rencanaPct, aktifPct, rencanaLabel, aktifLabel }: TargetStackedBarProps) {
  const r = Math.max(rencanaPct ?? 0, 0);
  const a = Math.max(aktifPct ?? 0, 0);
  const total = r + a;
  const scale = Math.max(100, total, 1);
  const rWidth = (r / scale) * 100;
  const aWidth = (a / scale) * 100;
  const targetLeft = (100 / scale) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-2xl font-extrabold" style={{ color: INK }}>
          {rencanaPct != null || aktifPct != null ? `${total.toFixed(0)}%` : "-"}
        </span>
        <span className="text-xs" style={{ color: MUTED }}>dari Target</span>
      </div>
      <HoverTarget
        label="Total dari Target"
        value={`${total.toFixed(0)}%`}
        wrapperClassName="relative w-full h-4 rounded overflow-hidden cursor-default"
        wrapperStyle={{ background: "#EAE6DE" }}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${rWidth}%`, background: RENCANA_COLOR }} />
        <div className="absolute inset-y-0" style={{ left: `${rWidth}%`, width: `${aWidth}%`, background: AKTIF_COLOR }} />
        {/* Target reference line — dashed, ink-colored, at the 100% mark */}
        <div
          className="absolute inset-y-0"
          style={{ left: `${targetLeft}%`, width: 2, background: INK, opacity: 0.6 }}
        />
      </HoverTarget>
      <div className="flex items-center justify-between mt-1.5 text-[11px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-1">
          <span style={{ width: 7, height: 7, borderRadius: 2, background: RENCANA_COLOR, display: "inline-block" }} />
          PSSP Rencana {rencanaLabel}
        </span>
        <span className="flex items-center gap-1">
          <span style={{ width: 7, height: 7, borderRadius: 2, background: AKTIF_COLOR, display: "inline-block" }} />
          PSSP Aktif {aktifLabel}
        </span>
      </div>
    </div>
  );
}

