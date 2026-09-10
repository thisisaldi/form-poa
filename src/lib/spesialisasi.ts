import { SPESIALISASI_TO_PAKET } from "./paketProduk";

/** Maps raw database spesialisasi strings to PM-standard display labels. */
export const SPESIALISASI_PM_LABEL: Record<string, string> = {
  "ANAK (PEDIATRIC)":           "PEDIATRIC",
  "ANESTESI":                   "ANESTESI",
  "BEDAH":                      "BEDAH UMUM",
  "BEDAH DIGESTIF":             "BEDAH DIGESTIF",
  "BEDAH KANKER (ONKOLOGI)":    "BEDAH ONKOLOGI",
  "BEDAH TULANG (ORTHOPEDI)":   "BEDAH ORTHOPEDI",
  "BEDAH TORAK / JANTUNG":      "BEDAH THORAKS & KARDIO VASKULAR (BTKV)",
  "KANDUNGAN (OBSGYN)":         "OBSGYN",
  "PARU (PULMONOLOGI)":         "PULMONOLOGI",
  "INTERNIST UMUM":             "INTERNIST UMUM",
  "INTERNIST GASTRO":           "INTERNIST GASTRO",
  "INTERNIST ENDOKRIN":         "INTERNIST ENDOKRIN",
  "INTERNIST PARU":             "INTERNIST PARU",
  "SYARAF (NEUROLOGI)":         "NEUROLOGI",
  "JIWA (PSIKIATER)":           "PSIKIATRI",
  "HEMATOLOGI":                 "HEMATOLOGI",
  // "Dokter Umum" (2026-07-21) — the source data spells this "UMUM (GP)", and
  // one row has a stray-space variant "UMUM ( GP)"; shown per our own naming.
  "UMUM (GP)":                  "DOKTER UMUM",
  "UMUM ( GP)":                 "DOKTER UMUM",
  // Near-duplicate raw values (2026-07-22) — same specialty, different wording
  // across whatever source systems fed Rekomendasi Paket Produk Per
  // Spesialisasi.xlsx Sheet2 (the source ALL_SPESIALISASI_OPTIONS is built
  // from). Left as distinct SPESIALISASI_TO_PAKET keys (so existing Customer
  // rows already stored under any of these spellings still match a paket),
  // but mapped to one shared label here so the dropdown shows a single entry
  // instead of near-identical duplicates.
  "INTERNIST":                     "INTERNIST UMUM",
  "PENYAKIT DALAM (INTERNIST)":    "INTERNIST UMUM",
  // Exodus's customers-databases/outlets-customers spesialisasi spelling
  // (2026-09-10 bug report: dokter ada di response API tapi ga muncul di
  // dropdown) — same specialty as "PENYAKIT DALAM (INTERNIST)" above, just a
  // different raw string from that source, so it was falling back to itself
  // as an unmapped label and landing in its own bucket instead of joining
  // "INTERNIST UMUM" where the MR actually looks.
  "SPESIALIS PENYAKIT DALAM":      "INTERNIST UMUM",
  "BEDAH (SURGEON)":               "BEDAH UMUM",
  "BEDAH (UROLOGIS)":              "BEDAH UROLOGIS",
  "PENATA ANASTESI":               "PENATA ANESTESI",
  "KESEHATAN JIWA":                "PSIKIATRI",
  "T H T (ENT)":                   "THT (ENT)",
  "CARDIO":                        "JANTUNG (KARDIOLOGI)",
};

/** Returns the PM display label for a spesialisasi string, falling back to the original. */
export function spesLabel(dbValue: string | null | undefined): string {
  if (!dbValue) return "—";
  return SPESIALISASI_PM_LABEL[dbValue.toUpperCase()] ?? dbValue;
}

/**
 * Full static spesialisasi list for dropdowns — every raw spesialisasi value
 * the system knows about (source: internal/Rekomendasi Paket Produk Per
 * Spesialisasi.xlsx, Sheet2 — the same list SPESIALISASI_TO_PAKET in
 * paketProduk.ts is keyed by), not just the 16 with a curated PM_LABEL.
 * Each shows its PM label when one exists, else the raw value as-is; entries
 * that end up sharing the same displayed label (e.g. "UMUM (GP)" / "UMUM ( GP)"
 * → both "DOKTER UMUM") collapse to a single option instead of showing twice.
 * Always all of them, independent of any one outlet's actual doctor roster.
 */
export const ALL_SPESIALISASI_OPTIONS = (() => {
  const byLabel = new Map<string, string>(); // label → first raw value seen
  for (const value of Object.keys(SPESIALISASI_TO_PAKET)) {
    const label = spesLabel(value);
    if (!byLabel.has(label)) byLabel.set(label, value);
  }
  return [...byLabel.entries()]
    .map(([label, value]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "id"));
})();
