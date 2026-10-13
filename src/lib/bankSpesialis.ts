import { BANK_SPESIALIS_BY_KODE, BANK_SPESIALIS_BY_NAMA_PRODUK, BANK_KETERANGAN, BANK_SPESIALIS_NAMES } from "./bankSpesialisData";

/**
 * Bank Spesialis (docs/poa-bank-spesialis/): pasangan spesialis dokter → produk. Satu-satunya sumber
 * "Produk Kontes" (produk ada di Bank = kontes) dan dasar WARNING "produk tidak sesuai spesialisasi dokter".
 *
 * Sumber kebenaran = tabel BankSpesialis (dikelola ADMIN). Modul ini PURE (aman diimpor client): helper di
 * bawah membaca indeks modul-level yang diisi `setBankSpesialis` — server lewat loadBankSpesialis
 * (bankSpesialisStore.ts), client lewat BankSpesialisProvider. Sebelum diisi (atau bila DB gagal dibaca)
 * dipakai data seed hasil generate (bankSpesialisData.ts) supaya klasifikasi kontes tidak hilang diam-diam.
 */

export interface BankRow {
  spesialis: string;
  kodeProduk: string;
  namaProduk: string;
  keterangan: string | null;
}
/** Bentuk serializable server → client. `masterNames` = Product.namaProduk per kode (ejaan bisa beda dengan Bank). */
export interface BankPayload {
  rows: BankRow[];
  masterNames: Record<string, string>;
}

interface BankIndex {
  names: Set<string>;
  byKode: Map<string, string[]>;
  byNama: Map<string, string[]>;
  keterangan: Map<string, string>;
}

function buildIndex(p: BankPayload): BankIndex {
  const idx: BankIndex = { names: new Set(), byKode: new Map(), byNama: new Map(), keterangan: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k) ?? [];
    if (!arr.includes(v)) arr.push(v);
    m.set(k, arr);
  };
  for (const r of p.rows) {
    idx.names.add(r.spesialis);
    push(idx.byKode, r.kodeProduk, r.spesialis);
    for (const n of [r.namaProduk, p.masterNames[r.kodeProduk]]) if (n) push(idx.byNama, n.trim().toUpperCase(), r.spesialis);
    if (r.keterangan) idx.keterangan.set(`${r.spesialis}|${r.kodeProduk}`, r.keterangan);
  }
  return idx;
}

function seedIndex(): BankIndex {
  return {
    names: new Set(BANK_SPESIALIS_NAMES),
    byKode: new Map(Object.entries(BANK_SPESIALIS_BY_KODE)),
    byNama: new Map(Object.entries(BANK_SPESIALIS_BY_NAMA_PRODUK)),
    keterangan: new Map(Object.entries(BANK_KETERANGAN)),
  };
}

let current: BankIndex = seedIndex();

/** Ganti indeks aktif dengan data dari DB. */
export function setBankSpesialis(payload: BankPayload): void {
  current = buildIndex(payload);
}

/**
 * Spesialisasi dokter di DB/Exodus ditulis macam-macam; Bank memakai nama kanonik. Alias di bawah menjembatani
 * ejaan-ejaan itu (UPPERCASE). Spesialisasi tanpa padanan di Bank (GP, THT, Kulit, dst.) → null: tidak ada
 * rekomendasi, jadi TIDAK ada warning (bukan "tidak sesuai").
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

/** Nama spesialis kanonik Bank untuk spesialisasi dokter (ejaan apa pun), atau null bila tidak ada padanan. */
export function canonicalBankSpesialis(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/\s+/g, " ").replace("( ", "(");
  const c = BANK_ALIAS[key] ?? key;
  return current.names.has(c) ? c : null;
}

/** Spesialis yang direkomendasikan Bank untuk produk ini (cari lewat nama persis). Kosong = bukan Produk Kontes. */
export function bankSpesialisForNama(namaProduk: string): string[] {
  return current.byNama.get(namaProduk.trim().toUpperCase()) ?? [];
}

/**
 * Apakah produk sesuai spesialisasi dokter menurut Bank? `null` = tidak bisa dinilai (spesialisasi
 * dokter tidak punya padanan di Bank / kosong) → pemanggil jangan menampilkan warning.
 */
export function isProdukSesuaiSpesialisasi(kodeProduk: string, namaProduk: string, spesialisasi: string | null | undefined): boolean | null {
  const spes = canonicalBankSpesialis(spesialisasi);
  if (!spes) return null;
  const list = current.byKode.get(kodeProduk) ?? bankSpesialisForNama(namaProduk);
  return list.includes(spes);
}

/** Keterangan (alasan relevansi) dari Bank untuk pasangan spesialis+produk, bila ada. */
export function bankKeterangan(spesialisasi: string | null | undefined, kodeProduk: string): string | null {
  const spes = canonicalBankSpesialis(spesialisasi);
  return spes ? current.keterangan.get(`${spes}|${kodeProduk}`) ?? null : null;
}
