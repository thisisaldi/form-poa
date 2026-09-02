// Shared currency formatter (docs/label-currency-format-updates/01-business-rules.md
// §1, item #3 dari daftar 13 task 2026-08-10): nilai asli dibagi 1.000.000, tanpa
// suffix apapun (bukan "Rp", bukan "Rb", bukan "Jt"). Dibulatkan ke bilangan bulat,
// tanpa desimal (2026-08-21: resolusi OQ-1 — pengguna laporan "value ga sync sampai
// desimal", jawaban: hilangkan desimal Rupiah sama sekali daripada kejar presisi
// yang toh tidak terlihat konsisten di layar berbeda). Contoh: 1.000.000 -> "1",
// 1.250.000 -> "1", 1.750.000 -> "2".
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
    if (absN >= 1_000_000_000) {
      const valMil = n / 1_000_000_000;
      const formatted = Number.isInteger(valMil)
        ? valMil.toLocaleString("id-ID")
        : valMil.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
      return formatted + " M";
    } else if (absN >= 1_000_000) {
      const valJt = n / 1_000_000;
      const formatted = Number.isInteger(valJt)
        ? valJt.toLocaleString("id-ID")
        : valJt.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
      return formatted + " Jt";
    } else if (absN >= 1_000) {
      return Math.round(n / 1_000).toLocaleString("id-ID") + " Rb";
    } else {
      return Math.round(n).toLocaleString("id-ID");
    }
  }

  return Math.round(n / 1_000_000).toLocaleString("id-ID");
}
