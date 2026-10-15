/**
 * Sensor nama dokter untuk tampilan/export. Gelar dibuang dulu (cuma nama
 * orangnya yang ditampilkan), lalu tiap kata hanya VISIBLE_LETTERS huruf depan
 * + 4 bintang TETAP supaya panjang nama asli tidak terbaca.
 *   "dr. Lina Kartika, SpPD" -> "LI**** KA****"
 *
 * Pola gelar dari data Customer (18k nama, 2026-10-15):
 *   depan   : DR / dr. / Dr. / drg / DRG / Prof / H. / Hj.
 *   belakang: setelah koma ("NAMA, SpPD", "NAMA, Sp.OG", "NAMA, M.Kes") atau
 *             tanpa koma ("NAMA Sp.A"), plus "(K)" / "(PD)".
 * "M." / "S." yang berdiri sendiri adalah inisial nama (Muhammad, dst), bukan gelar.
 */

// Gelar depan: dr / drg / dra / prof / ir / h / hj (+ titik opsional).
const TITLE_ONLY = /^(?:dr|drg|dra|prof|ir|h|hj)\.?$/i; // "dr", "DR.", "Prof"
const TITLE_GLUED = /^(?:(?:dr|drg|dra|prof|ir|h|hj)\.)+(?=\S)/i; // "dr.Fakhri", "Dr.dr.Adrian"
// Sp (SpPD, Sp.OG, spog, "sp"), gelar magister (M.Kes, MKes, S.Ked, MKed(...)), FICS/FINASIM, "(K)".
const TRAILING_TITLE =
  /^(?:sp(?:\.|[a-z]{0,4}$)|m\.?kes\b|m\.[a-z]{2,}|s\.[a-z]{2,}|subsp|fics$|finasim$)|\(/i;

const onlyTitles = (words: string[]) => words.every((w) => TITLE_ONLY.test(w));

/** Nama tanpa gelar (spasi dirapikan); kalau semuanya gelar, balik ke nama asli. */
export function stripTitles(name: string): string {
  const original = name.trim().split(/\s+/).filter(Boolean);
  // Gelar belakang umumnya setelah koma ("NAMA, SpPD" / "NAMA SpOG, DR"); kalau
  // bagian pertama cuma gelar ("dr, arif nur widodo, Sp.PD"), pakai bagian berikutnya.
  const parts = name.split(",").map((p) => p.trim().split(/\s+/).filter(Boolean)).filter((p) => p.length);
  const words = [...(parts.find((p) => !onlyTitles(p)) ?? original)];

  // Gelar depan, termasuk yang menempel ke nama ("dr.Fakhri", "Dr.dr.Adrian").
  while (words.length) {
    if (words.length > 1 && TITLE_ONLY.test(words[0])) {
      words.shift();
      continue;
    }
    const glued = words[0].replace(TITLE_GLUED, "");
    if (glued !== words[0]) {
      words[0] = glued;
      continue;
    }
    break;
  }

  // Gelar belakang tanpa koma ("NAMA Sp.PD", "NAMA DR"): potong di kata gelar pertama.
  const cut = words.findIndex((w, i) => i > 0 && TRAILING_TITLE.test(w));
  let kept = cut > 0 ? words.slice(0, cut) : words;
  while (kept.length > 1 && TITLE_ONLY.test(kept[kept.length - 1])) kept = kept.slice(0, -1); // "NAMA DR"
  kept = kept.map((w) => w.replace(/\.(?:dr|drg|dra)$/i, "")); // "NAMA.DR"
  return (kept.length ? kept : original).join(" ");
}

/**
 * Jumlah huruf depan yang tetap terlihat per kata. UJI COBA 2026-10-15: 2 huruf
 * (sebelumnya 1) supaya lebih terbaca; kalau tim sales memilih 1, cukup ganti
 * angka ini. Jumlah bintang tetap (tidak mengikuti panjang nama).
 */
export const VISIBLE_LETTERS = 2;
const STARS = "****";

export function censorName(name: string | null | undefined): string {
  return stripTitles(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].filter((c) => /[\p{L}\p{N}]/u.test(c)).slice(0, VISIBLE_LETTERS).join("")) // huruf/angka saja, titik "M." tidak ikut
    .filter(Boolean)
    .map((w) => `${w.toUpperCase()}${STARS}`)
    .join(" ");
}
