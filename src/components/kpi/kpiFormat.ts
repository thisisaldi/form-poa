/** Formatting + band helpers shared by the Detail KPI pages (docs/kpi-monitoring/04-final-layout.md). */

export const nf = (n: number | null | undefined, d = 2) =>
  n == null ? "–" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
export const rp = (n: number | null | undefined) => (n == null ? "–" : "Rp " + Math.round(n).toLocaleString("id-ID"));
export const pct = (n: number | null | undefined, d = 1) => (n == null ? "–" : `${nf(n, d)}%`);

const MOS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : `${d.getUTCDate()} ${MOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

/** Band score (40/55/70/85/100) → chip label, same scale as the memo. */
export const bandOf = (score: number | null): string | null =>
  score == null ? null : score >= 100 ? "ST" : score >= 85 ? "T" : score >= 70 ? "S" : score >= 55 ? "R" : "SR";

export const DECISION_LABEL: Record<number, string> = { 12: "12 bulan", 9: "9 bulan", 6: "6 bulan", 0: "Tidak diperpanjang" };

export const titleCase = (s: string | null | undefined) =>
  (s ?? "").trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");

export const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
