/**
 * Normalisasi + skor kemiripan nama dokter untuk MCL (docs/mcl-rekomendasi-dokter/).
 * Pure — dipakai script import dan lookup per dokter di POA Estimasi.
 *
 * Format nama beda antar sumber: Excel "Dr. Baruddin H, Sp.A, KNA" vs DB
 * "BARUDDIN H SpA, DR". Aturan: ambil segmen sebelum koma pertama (gelar & spesialis
 * ada setelahnya), buang tanda kurung, token Sp.xx/SpXX, token 1 huruf, dan gelar depan.
 */

const TITLE_TOKENS = new Set(["DR", "DRG", "DRA", "DRS", "PROF", "HJ", "IR", "NS"]);

function segmentTokens(segment: string): string[] {
  let s = segment.replace(/\(.*?\)/g, " ");
  s = s.replace(/\bSP\.?\s*[A-Z]{1,4}\b/g, " ").replace(/\bSP[A-Z]{1,4}\b/g, " ");
  s = s.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").filter((t) => t.length > 1 && !TITLE_TOKENS.has(t));
}

// Segmen pertama yang punya token nama: "Dr., dr. Yana Akhmad, Sp.PD" segmen pertamanya cuma gelar.
export function nameTokens(raw: string | null | undefined): string[] {
  const s = String(raw ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  for (const segment of s.split(",")) {
    const t = segmentTokens(segment);
    if (t.length > 0) return t;
  }
  return [];
}

export function normalizeNama(raw: string | null | undefined): string {
  return nameTokens(raw).join(" ");
}

function levenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const sameToken = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1);

export type MatchTier = "EXACT" | "SUBSET" | "FUZZY" | "NONE";

/** EXACT: semua token sama. SUBSET: >=2 token, himpunan satu sisi termuat di sisi lain. FUZZY: Dice >= 0.7 dengan >=2 token. */
export function matchTier(a: string[], b: string[]): { tier: MatchTier; score: number } {
  if (a.length === 0 || b.length === 0) return { tier: "NONE", score: 0 };
  const hit = a.filter((x) => b.some((y) => sameToken(x, y))).length;
  const score = (2 * hit) / (a.length + b.length);
  if (hit === a.length && hit === b.length) return { tier: "EXACT", score: 1 };
  if (hit === Math.min(a.length, b.length) && hit >= 2) return { tier: "SUBSET", score };
  if (score >= 0.7 && hit >= 2) return { tier: "FUZZY", score };
  return { tier: "NONE", score };
}
