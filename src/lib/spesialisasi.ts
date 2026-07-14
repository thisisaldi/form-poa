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
};

/** Returns the PM display label for a spesialisasi string, falling back to the original. */
export function spesLabel(dbValue: string | null | undefined): string {
  if (!dbValue) return "—";
  return SPESIALISASI_PM_LABEL[dbValue.toUpperCase()] ?? dbValue;
}
