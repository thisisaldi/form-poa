/**
 * Flag kluster diskon (label info saja, tidak memblokir submit): Normal 0–5%,
 * Sedang >5–10%, Tinggi >10–20%, Sangat Tinggi >20%. Batas sama dengan
 * discountApprovalLevel (≤5 / ≤10 / ≤20) supaya kluster & level approval konsisten.
 */
const KLUSTER = [
  { max: 5, label: "Normal", color: "var(--color-green)", bg: "var(--color-green-light)" },
  { max: 10, label: "Sedang", color: "var(--color-warning)", bg: "var(--color-warning-bg)" },
  { max: 20, label: "Tinggi", color: "#d97706", bg: "#FEF3E2" },
  { max: Infinity, label: "Sangat Tinggi", color: "var(--color-error)", bg: "var(--color-error-bg)" },
];

export function diskonKluster(pct: number) {
  return KLUSTER.find((k) => pct <= k.max)!;
}

export function DiskonKlusterBadge({ value }: { value: string | number | null | undefined }) {
  const pct = typeof value === "number" ? value : parseFloat(value ?? "");
  if (!Number.isFinite(pct) || pct < 0) return null;
  const k = diskonKluster(pct);
  return (
    <span
      className="inline-block self-start mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-tight whitespace-nowrap"
      style={{ color: k.color, background: k.bg }}
      title="Kluster diskon: Normal 0–5%, Sedang >5–10%, Tinggi >10–20%, Sangat Tinggi >20%"
    >
      Diskon {k.label}
    </span>
  );
}
