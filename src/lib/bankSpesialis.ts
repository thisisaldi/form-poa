import { BANK_SPESIALIS_BY_KODE, BANK_SPESIALIS_BY_NAMA_PRODUK, BANK_KETERANGAN, BANK_SPESIALIS_NAMES } from "./bankSpesialisData";

/**
 * Bank Spesialis (docs/poa-bank-spesialis/): daftar produk per spesialis dokter. Satu-satunya sumber
 * "Produk Kontes" (produk ada di Bank = kontes) dan dasar WARNING "produk tidak sesuai spesialisasi dokter".
 *
 * Spesialisasi dokter di DB/Exodus ditulis macam-macam; Bank memakai 17 nama kanonik. Alias di bawah
 * menjembatani ejaan-ejaan itu (UPPERCASE). Spesialisasi yang tidak punya padanan di Bank (GP, THT,
 * Kulit, dst.) → null: tidak ada rekomendasi, jadi TIDAK ada warning (bukan "tidak sesuai").
 */
const BANK_ALIAS: Record<string, string> = {
  "PEDIATRIC": "ANAK (PEDIATRIC)",
  "SPESIALIS ANAK": "ANAK (PEDIATRIC)",
  "ANAK (SP.A)": "ANAK (PEDIATRIC)",
  "NEUROLOGI": "SYARAF (NEUROLOGI)",
  "SARAF (NEUROLOGI)": "SYARAF (NEUROLOGI)",
  "SPESIALIS SARAF": "SYARAF (NEUROLOGI)",
  "OBSGYN": "KANDUNGAN (OBSGYN)",
  "KANDUNGAN (OBGYN)": "KANDUNGAN (OBSGYN)",
  "OBSTETRI DAN GINEKOLOGI (SP.OG)": "KANDUNGAN (OBSGYN)",
  "SPESIALIS OBSTETRI DAN GINEKOLOGI (KANDUNGAN)": "KANDUNGAN (OBSGYN)",
  "INTERNIST": "PENYAKIT DALAM (INTERNIST)",
  "INTERNIST UMUM": "PENYAKIT DALAM (INTERNIST)",
  "SPESIALIS PENYAKIT DALAM": "PENYAKIT DALAM (INTERNIST)",
  "PENYAKIT DALAM (INTERNIST) (SP.PD)": "PENYAKIT DALAM (INTERNIST)",
  "INTERNIST GASTRO": "GASTROENTEROLOGY-HEPATOLOGY",
  "HEMATOLOGI": "INTERNIST HEMATOLOGI",
  "BEDAH": "BEDAH (SURGEON)",
  "BEDAH UMUM": "BEDAH (SURGEON)",
  "SPESIALIS BEDAH UMUM": "BEDAH (SURGEON)",
  "BEDAH ORTHOPEDI": "BEDAH TULANG (ORTHOPEDI)",
  "SPESIALIS ORTOPEDI DAN TRAUMATOLOGI": "BEDAH TULANG (ORTHOPEDI)",
  "BEDAH ONKOLOGI": "BEDAH KANKER (ONKOLOGI)",
  "BEDAH THORAKS & KARDIO VASKULAR (BTKV)": "BEDAH TORAK / JANTUNG",
  "PULMONOLOGI": "PARU (PULMONOLOGI)",
  "SPESIALIS PARU": "PARU (PULMONOLOGI)",
  "KESEHATAN JIWA": "JIWA (PSIKIATER)",
  "PSIKIATER (SPKJ)": "JIWA (PSIKIATER)",
  "SPESIALIS PSIKIATRI (KESEHATAN JIWA)": "JIWA (PSIKIATER)",
  "SPESIALIS ANESTESIOLOGI DAN TERAPI INTENSIF": "ANESTESI",
};

const BANK_SET = new Set(BANK_SPESIALIS_NAMES);

/** Nama spesialis kanonik Bank untuk spesialisasi dokter (ejaan apa pun), atau null bila tidak ada padanan. */
export function canonicalBankSpesialis(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/\s+/g, " ").replace("( ", "(");
  const c = BANK_ALIAS[key] ?? key;
  return BANK_SET.has(c) ? c : null;
}

/** Spesialis yang direkomendasikan Bank untuk produk ini (cari lewat nama persis, UPPERCASE). Kosong = bukan Produk Kontes. */
export function bankSpesialisForNama(namaProduk: string): string[] {
  return BANK_SPESIALIS_BY_NAMA_PRODUK[namaProduk.toUpperCase()] ?? [];
}

/**
 * Apakah produk sesuai spesialisasi dokter menurut Bank? `null` = tidak bisa dinilai (spesialisasi
 * dokter tidak punya padanan di Bank / kosong) → pemanggil jangan menampilkan warning.
 */
export function isProdukSesuaiSpesialisasi(kodeProduk: string, namaProduk: string, spesialisasi: string | null | undefined): boolean | null {
  const spes = canonicalBankSpesialis(spesialisasi);
  if (!spes) return null;
  const list = BANK_SPESIALIS_BY_KODE[kodeProduk] ?? bankSpesialisForNama(namaProduk);
  return list.includes(spes);
}

/** Keterangan (alasan relevansi) dari Bank untuk pasangan spesialis+produk, bila ada. */
export function bankKeterangan(spesialisasi: string | null | undefined, kodeProduk: string): string | null {
  const spes = canonicalBankSpesialis(spesialisasi);
  return spes ? BANK_KETERANGAN[`${spes}|${kodeProduk}`] ?? null : null;
}
