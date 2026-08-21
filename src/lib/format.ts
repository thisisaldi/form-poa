// Shared currency formatter (docs/label-currency-format-updates/01-business-rules.md
// §1, item #3 dari daftar 13 task 2026-08-10): nilai asli dibagi 1.000.000, tanpa
// suffix apapun (bukan "Rp", bukan "Rb", bukan "Jt"), desimal pakai koma, trailing
// zero dibuang. Contoh: 1.000.000 -> "1", 500.000 -> "0,5", 1.250.000 -> "1,25".
//
// Replaces the ~14 independently-redefined formatRp/formatRpPssp functions that
// used to live in DraftChecklist.tsx, summary/page.tsx, LineItemEditor.tsx, etc.
// Every one of those now re-exports or imports this single implementation instead.
export function formatCurrency(
  val: number | string | { toString(): string } | null | undefined,
  withSuffix: boolean = true
): string {
  if (val == null) return "-";
  const n = typeof val === "number" ? val : parseFloat(val.toString());
  if (isNaN(n)) return "-";
  if (n === 0) return "0";

  if (withSuffix) {
    const absN = Math.abs(n);
    if (absN >= 1_000_000) {
      const scaled = n / 1_000_000;
      const fixed = scaled.toFixed(2);
      const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
      return trimmed.replace(".", ",") + " Jt";
    } else if (absN >= 1_000) {
      const scaled = n / 1_000;
      const fixed = scaled.toFixed(2);
      const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
      return trimmed.replace(".", ",") + " Rb";
    } else {
      return n.toLocaleString("id-ID");
    }
  }

  const scaled = n / 1_000_000;
  const fixed = scaled.toFixed(2);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed.replace(".", ",");
}
