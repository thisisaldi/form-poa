/**
 * Mapping from namaProduk (uppercase) to the paket(s) it belongs to.
 * Keys must match exact namaProduk values in the Product table (uppercased).
 * Derived from excel/ProductPMDatabase.xlsx Unpivot sheets, updated against
 * internal/Paket Produk Kontes PM.xlsx (PM's latest official list, 2026-08-06).
 */
export const PAKET_BY_PRODUK: Record<string, string[]> = {
  // NARFOZ — sirup (015942, 008870)
  "NARFOZ 4 MG/5 ML SYRUP 30 ML":              ["PAKET PENCERNAAN", "PAKET PEDIATRIC"],
  "NARFOZ 4 MG/5 ML SYRUP 60 ML":              ["PAKET PENCERNAAN", "PAKET PEDIATRIC"],
  // NARFOZ — injeksi (005327, 005338)
  "NARFOZ 4 INJEKSI":                           ["PAKET PENCERNAAN", "PAKET PEDIATRIC", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  "NARFOZ 8 INJEKSI":                           ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  // NARFOZ — tablet (003171, 003182)
  "NARFOZ 4 TABLET":                            ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  "NARFOZ 8 TABLET":                            ["PAKET PENCERNAAN", "PAKET PERNAPASAN", "PAKET ONKOLOGI"],
  // PENCERNAAN (010398)
  "ARCOLASE 20 MG EC TABLET":                   ["PAKET PENCERNAAN"],
  // GRIFOLS (015777)
  "HUMAN ALBUMIN GRIFOLS 20 % INFUSION 100":    ["PAKET PENCERNAAN", "PAKET ONKOLOGI"],
  // PRORIS (006064)
  "PRORIS SUPPOSITORIA":                        ["PAKET PEDIATRIC", "PAKET PENCERNAAN"],
  // PRAXION (007550, 007538, 007549)
  "PRAXION 100MG/ML DROPS SUSPENSI":            ["PAKET PEDIATRIC", "PAKET PENCERNAAN"],
  "PRAXION 120MG/5ML SUSPENSI":                 ["PAKET PEDIATRIC"],
  "PRAXION 250MG/5ML SUSPENSI":                 ["PAKET PEDIATRIC"],
  // PRORIS (003259, 011014, in addition to 006064 below)
  "PRORIS SUSPENSI 60 ML":                      ["PAKET PEDIATRIC"],
  "PRORIS FORTE SUSPENSION 50 ML":              ["PAKET PEDIATRIC"],
  // CALTONAL — kode produk "NEW" di internal/Paket Produk Kontes PM.xlsx,
  // belum ada di Product table; mapping disiapkan duluan supaya aktif begitu disync.
  "CALTONAL 50":                                ["PAKET PAIN"],
  "CALTONAL 100":                               ["PAKET PAIN"],
  // OZEN (006119)
  "OZEN DROPS 12 ML":                           ["PAKET PEDIATRIC"],
  // INTRIX (004865)
  "INTRIX 1 G INJEKSI":                         ["PAKET PEDIATRIC", "PAKET PERNAPASAN"],
  // AZTRIN (011290)
  "AZTRIN 500 MG DRY INJECTION":                ["PAKET PEDIATRIC", "PAKET PERNAPASAN"],
  // PAIN (013401, 013390)
  "EVIDUR 120 MG FC TABLET":                    ["PAKET PAIN"],
  "ACETRAM 37.5/325MG FC TABLET":               ["PAKET PAIN", "PAKET ONKOLOGI"],
  // PLEXION (008528)
  "PLEXION 50 MG TABLET SC":                    ["PAKET PAIN"],
  // PERNAPASAN (012818)
  "ZIGAT 400 MG FC TABLET":                     ["PAKET PERNAPASAN"],
  // PSIKIATRI (008187, 008198, 020771, 004800, 004810)
  "REMITAL 5 MG FC TABLET":                     ["PAKET PSIKIATRI"],
  "REMITAL 10 MG FC TABLET":                    ["PAKET PSIKIATRI"],
  "REMITAL 10 MG ODT":                          ["PAKET PSIKIATRI"],
  "ANTIPRESTIN 10 KAPSUL":                      ["PAKET PSIKIATRI"],
  "ANTIPRESTIN 20 KAPSUL":                      ["PAKET PSIKIATRI"],
  // ONKOLOGI (014545, 011223, 015777 see above, 012884, 010805, 014853)
  "PROSMOL 0.25 MG/5 ML INJECTION":             ["PAKET ONKOLOGI"],
  "GRAMET 3 MG/3 ML INJECTION":                 ["PAKET ONKOLOGI"],
  "APRION 75 MG CAPSULE":                       ["PAKET ONKOLOGI"],
  "APRION 150 MG CAPSULE":                      ["PAKET ONKOLOGI"],
  "IMDROS 100 MG FC TABLET":                    ["PAKET ONKOLOGI"],
};

/** Returns the primary paket label for a product name, or null if not a kontes product. */
export function getPaketLabel(namaProduk: string): string | null {
  const pakets = PAKET_BY_PRODUK[namaProduk.toUpperCase()];
  if (!pakets || pakets.length === 0) return null;
  return pakets[0];
}

/** Returns all pakets for a product name. */
export function getAllPakets(namaProduk: string): string[] {
  return PAKET_BY_PRODUK[namaProduk.toUpperCase()] ?? [];
}

/**
 * Maps DB spesialisasi (uppercased) to pakets recommended for that specialty.
 * Source: excel/Rekomendasi Paket Produk Per Spesialisasi.xlsx, Sheet2,
 * columns SPESIALISASI2 and REKOMENDASI PAKET PRODUK KONTES.
 */
export const SPESIALISASI_TO_PAKET: Record<string, string[]> = {
  // Pediatric
  "ANAK (PEDIATRIC)":                       ["PAKET PEDIATRIC"],
  "PEDIATRIC":                              ["PAKET PEDIATRIC"],
  "PULMONOLOGY ANAK":                       ["PAKET PEDIATRIC"],
  "BEDAH ANAK":                             ["PAKET PEDIATRIC", "PAKET PAIN"],

  // Internist / Gastro
  "PENYAKIT DALAM (INTERNIST)":             ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST":                              ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST UMUM":                         ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST GASTRO":                       ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST ENDOKRIN":                     ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "INTERNIST PARU":                         ["PAKET PENCERNAAN", "PAKET PERNAPASAN"],
  "GASTROENTEROLOGY-HEPATOLOGY":            ["PAKET PENCERNAAN"],
  "DIGESTIVE & ENDOSCOPY":                  ["PAKET PENCERNAAN"],

  // Bedah
  "BEDAH (SURGEON)":                        ["PAKET PAIN"],
  "BEDAH":                                  ["PAKET PAIN"],
  "BEDAH UMUM":                             ["PAKET PAIN"],
  "BEDAH DIGESTIF":                         ["PAKET PAIN"],
  "BEDAH KANKER (ONKOLOGI)":                ["PAKET ONKOLOGI", "PAKET PAIN"],
  "BEDAH ONKOLOGI":                         ["PAKET ONKOLOGI", "PAKET PAIN"],
  "BEDAH TULANG (ORTHOPEDI)":               ["PAKET PAIN"],
  "BEDAH ORTHOPEDI":                        ["PAKET PAIN"],
  "BEDAH TULANG BELAKANG (SPINAL SURGERY)": ["PAKET PAIN"],
  "BEDAH TORAK / JANTUNG":                  ["PAKET PAIN"],
  "BEDAH THORAKS & KARDIO VASKULAR (BTKV)": ["PAKET PAIN"],
  "BEDAH SYARAF":                           ["PAKET PAIN"],
  "BEDAH (UROLOGIS)":                       ["PAKET PAIN"],
  "BEDAH UROLOGIS":                         ["PAKET PAIN"],
  "BEDAH MULUT":                            ["PAKET PAIN"],
  "BEDAH PLASTIK":                          ["PAKET PAIN"],
  "BEDAH THT":                              ["PAKET PAIN"],
  "THT & BEDAH KEPALA LEHER":               ["PAKET PAIN"],

  // Pernapasan
  "PARU (PULMONOLOGI)":                     ["PAKET PERNAPASAN"],
  "PULMONOLOGI":                            ["PAKET PERNAPASAN"],

  // Anestesi & Pain
  "ANESTESI":                               ["PAKET PAIN"],
  "PENATA ANESTESI":                        ["PAKET PAIN"],
  "PENATA ANASTESI":                        ["PAKET PAIN"],

  // Psikiatri & Neurologi
  "SYARAF (NEUROLOGI)":                     ["PAKET PSIKIATRI"],
  "NEUROLOGI":                              ["PAKET PSIKIATRI"],
  "JIWA (PSIKIATER)":                       ["PAKET PSIKIATRI"],
  "KESEHATAN JIWA":                         ["PAKET PSIKIATRI"],

  // Onkologi & Hematologi
  "HAEMATOLOGY-ONCOLOGY":                   ["PAKET ONKOLOGI"],

  // Tidak ada paket kontes yang relevan
  "HEMATOLOGI":                             [],
  "KANDUNGAN (OBSGYN)":                     [],
  "OBSGYN":                                 [],
  "JANTUNG (KARDIOLOGI)":                   [],
  "CARDIO":                                 [],
  "KULIT KELAMIN (DV)":                     [],
  "THT (ENT)":                              [],
  "T H T (ENT)":                            [],
  "MATA (OPTAL)":                           [],
  "GIGI (DENTIST)":                         [],
  "REHAB MEDIK":                            [],
  "RADIOLOGI":                              [],
  "PATOLOGI KLINIK":                        [],
  "REPRODUKSI (ANDROLOG)":                  [],
  "KANDUNG KEMIH (UROLOGIST)":              [],
  "RHEUMATOLOGIST":                         [],
  "CLINICAL IMMUNOLOG & ALLERGY":           [],
  "UMUM (GP)":                              [],
  "UMUM ( GP)":                             [],
  "AHLI GIZI":                              [],
  "GIZI KLINIK":                            [],
  "KESEHATAN OLAHRAGA":                     [],
  "PSIKOLOGI":                              [],
  "KEPALA ICU":                             [],
  "CLINICAL PHARMACOLOGY":                  [],
  "ORTHODENTIST":                           [],

  // Non-dokter (stakeholder rumah sakit/apotek, bukan spesialisasi medis) —
  // ada di Customer_Database sebagai kategori tersendiri di kolom yang sama
  // dengan spesialisasi dokter, jadi ditambahkan di sini juga (2026-07-22)
  // supaya MR bisa mendaftarkan mereka sebagai baris rencana POA.
  "APOTEKER":                               [],
  "ASISTEN APOTEKER":                       [],
  "KEPALA INSTALASI FARMASI":               [],
  "PERAWAT":                                [],
  "KEPALA PERAWAT":                         [],
  "BIDAN":                                  [],
  "BAGIAN PEMBELIAN":                       [],
  "KABAG PEMBELIAN":                        [],
  "BAGIAN KEUANGAN":                        [],
  "DIREKTUR KEUANGAN":                      [],
  "DIREKSI":                                [],
  "PRESIDEN DIREKTUR":                      [],
  "PEMILIK INSTITUSI/USAHA":                [],
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

/**
 * Maps DB spesialisasi (uppercased) to the specialty column names used in
 * "internal/Rekomendasi Paket Produk Per Spesialisasi.xlsx" (sheet
 * "Recommendation" — see Product.spesialisasiRekomendasi). Source: same
 * workbook, Sheet2, columns SPESIALISASI2 and "REKOMENDASI PAKET DATA PAK
 * LEEMAN". Distinct from SPESIALISASI_TO_PAKET above — that one maps to the
 * 6 broad "Produk Kontes PM" pakets, this one to the 13 finer-grained
 * specialty columns covering the wider "Listing Corporate" product set.
 */
export const SPESIALISASI_TO_KOLOM_REKOMENDASI: Record<string, string[]> = {
  "SYARAF (NEUROLOGI)": ["NEURO"],
  "NEUROLOGI": ["NEURO"],
  "KANDUNGAN (OBSGYN)": ["OBGYN"],
  "OBSGYN": ["OBGYN"],
  "BEDAH TULANG (ORTHOPEDI)": ["BEDAH", "ANASTESI", "ORTHOPEDI"],
  "BEDAH ORTHOPEDI": ["BEDAH", "ANASTESI", "ORTHOPEDI"],
  "UMUM (GP)": ["GP &UGD"],
  "UMUM ( GP)": ["GP &UGD"],
  "GIGI (DENTIST)": ["GP &UGD"],
  "REHAB MEDIK": ["GP &UGD"],
  "KEPALA ICU": ["GP &UGD"],
  "ANAK (PEDIATRIC)": ["PEDIATRICT"],
  "PEDIATRIC": ["PEDIATRICT"],
  "PULMONOLOGY ANAK": ["PEDIATRICT"],
  "BEDAH ANAK": ["BEDAH", "ANASTESI", "PEDIATRICT"],
  "PENYAKIT DALAM (INTERNIST)": ["INTERNIST", "GASTRO", "PULMO"],
  "INTERNIST": ["INTERNIST", "GASTRO", "PULMO"],
  "INTERNIST UMUM": ["INTERNIST", "GASTRO", "PULMO"],
  "BEDAH (UROLOGIS)": ["BEDAH", "ANASTESI", "UROLOGY"],
  "BEDAH UROLOGIS": ["BEDAH", "ANASTESI", "UROLOGY"],
  "KANDUNG KEMIH (UROLOGIST)": ["UROLOGY"],
  "JANTUNG (KARDIOLOGI)": ["JANTUNG"],
  "CARDIO": ["JANTUNG"],
  "JIWA (PSIKIATER)": ["PSIKIATRI"],
  "KESEHATAN JIWA": ["PSIKIATRI"],
  "BEDAH KANKER (ONKOLOGI)": ["BEDAH", "ANASTESI"],
  "BEDAH ONKOLOGI": ["BEDAH", "ANASTESI"],
  "ANESTESI": ["ANASTESI"],
  "PENATA ANESTESI": ["ANASTESI"],
  "PENATA ANASTESI": ["ANASTESI"],
  "BEDAH (SURGEON)": ["BEDAH", "ANASTESI"],
  "BEDAH": ["BEDAH", "ANASTESI"],
  "BEDAH UMUM": ["BEDAH", "ANASTESI"],
  "BEDAH SYARAF": ["BEDAH", "ANASTESI", "NEURO"],
  "BEDAH TORAK / JANTUNG": ["BEDAH", "ANASTESI", "JANTUNG"],
  "BEDAH THORAKS & KARDIO VASKULAR (BTKV)": ["BEDAH", "ANASTESI", "JANTUNG"],
  "PARU (PULMONOLOGI)": ["PULMO"],
  "PULMONOLOGI": ["PULMO"],
  "BEDAH DIGESTIF": ["BEDAH", "ANASTESI"],
  "BEDAH PLASTIK": ["BEDAH", "ANASTESI"],
  "BEDAH MULUT": ["BEDAH", "ANASTESI"],
  "BEDAH THT": ["BEDAH", "ANASTESI"],
  "THT & BEDAH KEPALA LEHER": ["BEDAH", "ANASTESI"],
  "GASTROENTEROLOGY-HEPATOLOGY": ["GASTRO"],
  "DIGESTIVE & ENDOSCOPY": ["GASTRO"],
  "BEDAH TULANG BELAKANG (SPINAL SURGERY)": ["BEDAH", "ANASTESI", "NEURO", "ORTHOPEDI"],
};

/**
 * Returns the Recommendation-sheet specialty columns that match a given
 * spesialisasi DB value (empty array = no relevance data for this specialty).
 */
export function getKolomRekomendasiBySpesialisasi(spesialisasi: string): string[] {
  return SPESIALISASI_TO_KOLOM_REKOMENDASI[spesialisasi.toUpperCase()] ?? [];
}

/**
 * Whether a product is relevant to a doctor's spesialisasi per the
 * Recommendation-sheet mapping. Products the reference sheet doesn't cover
 * (empty spesialisasiRekomendasi) are treated as relevant to everyone —
 * absence of data isn't evidence of irrelevance — so this only narrows down
 * products the sheet explicitly scoped to other specialties.
 */
export function isRelevantToSpesialisasi(spesialisasiRekomendasi: string[], spesialisasi: string): boolean {
  if (spesialisasiRekomendasi.length === 0) return true;
  const matchedKolom = getKolomRekomendasiBySpesialisasi(spesialisasi);
  if (matchedKolom.length === 0) return false;
  return spesialisasiRekomendasi.some((k) => matchedKolom.includes(k));
}
