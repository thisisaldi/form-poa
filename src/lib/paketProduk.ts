import { BANK_SPESIALIS_BY_NAMA_PRODUK } from "./bankSpesialisData";
import { canonicalBankSpesialis } from "./bankSpesialis";

/**
 * Mapping namaProduk (UPPERCASE) → "paket" produk kontes. Sejak 2026-10-13 sumbernya Bank Spesialis
 * (docs/poa-bank-spesialis/, src/lib/bankSpesialisData.ts): "paket" = nama spesialis yang
 * direkomendasikan untuk produk itu, dan produk ada di Bank = Produk Kontes. Menggantikan daftar
 * "PAKET PEDIATRIC/PENCERNAAN/..." dari Paket Produk Kontes PM.xlsx (2026-08-06).
 */
export const PAKET_BY_PRODUK: Record<string, string[]> = BANK_SPESIALIS_BY_NAMA_PRODUK;

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
 * Ejaan spesialisasi dari Exodus (`core/v1/customers/specialist`) yang sama
 * dengan key paket yang sudah ada — alias (UPPERCASE) → key. Dipakai
 * getPaketsBySpesialisasi + label PM di spesialisasi.ts.
 */
export const SPESIALISASI_ALIAS: Record<string, string> = {
  "SARAF (NEUROLOGI)": "SYARAF (NEUROLOGI)",
  "SPESIALIS SARAF": "SYARAF (NEUROLOGI)",
  "KANDUNGAN (OBGYN)": "KANDUNGAN (OBSGYN)",
  "OBSTETRI DAN GINEKOLOGI (SP.OG)": "KANDUNGAN (OBSGYN)",
  "SPESIALIS OBSTETRI DAN GINEKOLOGI (KANDUNGAN)": "KANDUNGAN (OBSGYN)",
  "ANAK (SP.A)": "ANAK (PEDIATRIC)",
  "SPESIALIS ANAK": "ANAK (PEDIATRIC)",
  "SPESIALIS PENYAKIT DALAM": "PENYAKIT DALAM (INTERNIST)",
  "PENYAKIT DALAM (INTERNIST) (SP.PD)": "PENYAKIT DALAM (INTERNIST)",
  "PSIKIATER (SPKJ)": "JIWA (PSIKIATER)",
  "SPESIALIS PSIKIATRI (KESEHATAN JIWA)": "JIWA (PSIKIATER)",
  "SPESIALIS BEDAH UMUM": "BEDAH (SURGEON)",
  "SPESIALIS TELINGA HIDUNG TENGGOROK DAN BEDAH KEPALA LEHER": "THT (ENT)",
  "SPESIALIS ANESTESIOLOGI DAN TERAPI INTENSIF": "ANESTESI",
  "SPESIALIS PARU": "PARU (PULMONOLOGI)",
  "SPESIALIS KULIT DAN KELAMIN": "KULIT KELAMIN (DV)",
  "SPESIALIS ORTOPEDI DAN TRAUMATOLOGI": "BEDAH TULANG (ORTHOPEDI)",
  "SPESIALIS BEDAH MULUT DAN MAKSILOFASIAL": "BEDAH MULUT",
  "SPESIALIS PATOLOGI KLINIK": "PATOLOGI KLINIK",
  "SPESIALIS GIZI KLINIK": "GIZI KLINIK",
  "DOKTER UMUM": "UMUM (GP)",
};

/**
 * Returns the pakets that match a given spesialisasi DB value.
 * Used to prioritise focus products relevant to the doctor's specialty.
 */
export function getPaketsBySpesialisasi(spesialisasi: string): string[] {
  // "Paket" = nama spesialis kanonik Bank Spesialis; spesialisasi tanpa padanan → [] (tidak ada rekomendasi).
  const c = canonicalBankSpesialis(spesialisasi);
  return c ? [c] : [];
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
