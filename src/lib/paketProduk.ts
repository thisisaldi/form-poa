/**
 * Mapping from namaProduk (uppercase) to the paket(s) it belongs to.
 * Keys must match exact namaProduk values in the Product table (uppercased).
 * Derived from 'excel/RS GROUP - PHAROS INDONESIA.xlsx' PAKET sheets,
 * reconciled against 'excel/TKT202607020007 - LAPORAN HNA SARUASUBUR.xlsx'.
 * Products not found in DB (GRIFOLS, CALTONAL, REMITAL ODT, AMINOLYTEPERI, IMDROS) are omitted.
 */
export const PAKET_BY_PRODUK: Record<string, string[]> = {
  // NARFOZ — sirup
  "NARFOZ 4MG/5ML SYR 30ML":        ["PAKET PENCERNAAN", "PAKET PEDIATRIC"],
  "NARFOZ 4MG/5ML SYR 60ML":        ["PAKET PENCERNAAN", "PAKET PEDIATRIC"],
  // NARFOZ — injeksi
  "NARFOZ 4 INJEKSI":                ["PAKET PENCERNAAN", "PAKET PEDIATRIC", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  "NARFOZ 8 INJEKSI":                ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  // NARFOZ — tablet
  "NARFOZ 4MG TAB 12`S":            ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  "NARFOZ 8MG TAB 12`S":            ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  // PENCERNAAN
  "ARCOLASE 20MG TAB 30`S":         ["PAKET PENCERNAAN"],
  // PRORIS (semua bentuk sediaan)
  "PRORIS 125MG SUPP 10`S":         ["PAKET PEDIATRIC"],
  "PRORIS SUSP 60 ML RASA JERUK":   ["PAKET PEDIATRIC"],
  "PRORIS FORTE 200MG SUSP 50ML":   ["PAKET PEDIATRIC"],
  // PRAXION (semua bentuk sediaan)
  "PRAXION DROPS SUSPENSI 15ML":    ["PAKET PEDIATRIC"],
  "PRAXION SUSP 60ML RASA JERUK":   ["PAKET PEDIATRIC"],
  "PRAXION 250MG/5ML FORTE 60 ML":  ["PAKET PEDIATRIC"],
  // PEDIATRIC
  "OZEN DROPS 12ML":                ["PAKET PEDIATRIC"],
  "INTRIX 1GR VIAL DRY 1`S":        ["PAKET PEDIATRIC", "PAKET PERNAPASAN"],
  // PAIN
  "EVIDUR 120MG TAB 30`S":          ["PAKET PAIN"],
  "ACETRAM 37.5/325MG TAB 10`S<K>": ["PAKET PAIN", "PAKET ONKOLOGI"],
  // PERNAPASAN
  "ZIGAT 400MG TAB FC 10`S":        ["PAKET PERNAPASAN"],
  // PSIKIATRI
  "REMITAL 5MG TAB FC 30`S":        ["PAKET PSIKIATRI"],
  "REMITAL 10MG TAB FC 30`S":       ["PAKET PSIKIATRI"],
  // ONKOLOGI
  "PROSMOL 0.25MG/5ML INJ":         ["PAKET ONKOLOGI"],
  "APRION 75MG CAP 10`S":           ["PAKET ONKOLOGI"],
  "APRION 150MG CAP 20`S":          ["PAKET ONKOLOGI"],
};

/** Returns the primary paket label for a product name, or null if not a focus product. */
export function getPaketLabel(namaProduk: string): string | null {
  const pakets = PAKET_BY_PRODUK[namaProduk.toUpperCase()];
  if (!pakets || pakets.length === 0) return null;
  return pakets[0];
}

/** Returns all pakets for a product name. */
export function getAllPakets(namaProduk: string): string[] {
  return PAKET_BY_PRODUK[namaProduk.toUpperCase()] ?? [];
}

/** Maps DB spesialisasi (uppercase) to the pakets most relevant for that specialty. */
export const SPESIALISASI_TO_PAKET: Record<string, string[]> = {
  // Pediatric
  "ANAK (PEDIATRIC)":                       ["PAKET PEDIATRIC"],
  "PEDIATRIC":                              ["PAKET PEDIATRIC"],
  "PULMONOLOGY ANAK":                       ["PAKET PEDIATRIC", "PAKET PERNAPASAN"],
  "BEDAH ANAK":                             ["PAKET PEDIATRIC", "PAKET PAIN"],

  // Internist
  "PENYAKIT DALAM (INTERNIST)":             ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST":                              ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST UMUM":                         ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST GASTRO":                       ["PAKET PENCERNAAN"],
  "INTERNIST ENDOKRIN":                     [],
  "INTERNIST PARU":                         ["PAKET PERNAPASAN"],
  "GASTROENTEROLOGY-HEPATOLOGY":            ["PAKET PENCERNAAN"],
  "DIGESTIVE & ENDOSCOPY":                  ["PAKET PENCERNAAN"],

  // Bedah
  "BEDAH (SURGEON)":                        ["PAKET PAIN"],
  "BEDAH":                                  ["PAKET PAIN"],
  "BEDAH UMUM":                             ["PAKET PAIN"],
  "BEDAH DIGESTIF":                         ["PAKET PENCERNAAN", "PAKET PAIN"],
  "BEDAH KANKER (ONKOLOGI)":                ["PAKET ONKOLOGI", "PAKET PAIN"],
  "BEDAH ONKOLOGI":                         ["PAKET ONKOLOGI", "PAKET PAIN"],
  "BEDAH TULANG (ORTHOPEDI)":               ["PAKET PAIN"],
  "BEDAH ORTHOPEDI":                        ["PAKET PAIN"],
  "BEDAH TULANG BELAKANG (SPINAL SURGERY)": ["PAKET PAIN"],
  "BEDAH TORAK / JANTUNG":                  ["PAKET PAIN", "PAKET PERNAPASAN"],
  "BEDAH THORAKS & KARDIO VASKULAR (BTKV)": ["PAKET PAIN", "PAKET PERNAPASAN"],
  "BEDAH SYARAF":                           ["PAKET PAIN", "PAKET PSIKIATRI"],
  "BEDAH (UROLOGIS)":                       ["PAKET PAIN"],
  "BEDAH UROLOGIS":                         ["PAKET PAIN"],

  // Pernapasan
  "PARU (PULMONOLOGI)":                     ["PAKET PERNAPASAN"],

  // Anestesi & Pain
  "ANESTESI":                               ["PAKET PAIN"],
  "PENATA ANESTESI":                        ["PAKET PAIN"],
  "PENATA ANASTESI":                        ["PAKET PAIN"],

  // Psikiatri & Neurologi
  "SYARAF (NEUROLOGI)":                     ["PAKET PSIKIATRI"],
  "NEUROLOGI":                              ["PAKET PSIKIATRI"],
  "JIWA (PSIKIATER)":                       ["PAKET PSIKIATRI"],

  // Onkologi & Hematologi
  "HEMATOLOGI":                             ["PAKET ONKOLOGI"],
  "HAEMATOLOGY-ONCOLOGY":                   ["PAKET ONKOLOGI"],

  // Tidak ada paket fokus yang relevan
  "KANDUNGAN (OBSGYN)":                     [],
  "OBSGYN":                                 [],
  "JANTUNG (KARDIOLOGI)":                   [],
  "CARDIO":                                 [],
  "KULIT KELAMIN (DV)":                     [],
  "THT (ENT)":                              [],
  "T H T (ENT)":                            [],
  "THT & BEDAH KEPALA LEHER":               [],
  "BEDAH THT":                              [],
  "MATA (OPTAL)":                           [],
  "GIGI (DENTIST)":                         [],
  "BEDAH MULUT":                            [],
  "BEDAH PLASTIK":                          [],
  "REHAB MEDIK":                            [],
  "RADIOLOGI":                              [],
  "PATOLOGI KLINIK":                        [],
  "REPRODUKSI (ANDROLOG)":                  [],
  "KANDUNG KEMIH (UROLOGIST)":              [],
  "RHEUMATOLOGIST":                         [],
  "CLINICAL IMMUNOLOG & ALLERGY":           [],
  "UMUM (GP)":                              [],
};

/**
 * Returns the pakets that match a given spesialisasi DB value.
 * Used to prioritise focus products relevant to the doctor's specialty.
 */
export function getPaketsBySpesialisasi(spesialisasi: string): string[] {
  return SPESIALISASI_TO_PAKET[spesialisasi.toUpperCase()] ?? [];
}

/** Returns 0 = matched focus, 1 = other focus, 2 = non-focus for a product given matched pakets. */
export function getProductTier(namaProduk: string, matchedPakets: string[]): 0 | 1 | 2 {
  const pakets = PAKET_BY_PRODUK[namaProduk.toUpperCase()];
  if (!pakets || pakets.length === 0) return 2;
  if (matchedPakets.length > 0 && pakets.some((pk) => matchedPakets.includes(pk))) return 0;
  return 1;
}

/**
 * Sort products by relevance to the doctor's spesialisasi.
 * Tier 0: focus products in matched pakets · Tier 1: other focus products · Tier 2: non-focus
 */
export function sortProductsBySpesialisasi<T extends { namaProduk: string }>(
  products: T[],
  spesialisasi: string,
): T[] {
  const matchedPakets = getPaketsBySpesialisasi(spesialisasi);
  return [...products].sort((a, b) => {
    const td = getProductTier(a.namaProduk, matchedPakets) - getProductTier(b.namaProduk, matchedPakets);
    if (td !== 0) return td;
    return a.namaProduk.localeCompare(b.namaProduk, "id");
  });
}
