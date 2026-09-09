import type { Product } from "@/lib/masterData";

/**
 * Find matching discount item from matrix by product code,
 * handling leading zeroes if necessary.
 */
export function findDiskonItem(list: any[] | undefined | null, targetCode: string) {
  if (!targetCode || !Array.isArray(list)) return null;
  const cleanTarget = String(targetCode).trim();
  const strippedTarget = cleanTarget.replace(/^0+/, "");

  return list.find((d: any) => {
    const codeStr = String(d.proCode || d.pro_code || d.kodeProduk || "").trim();
    if (codeStr === cleanTarget) return true;
    if (codeStr.replace(/^0+/, "") === strippedTarget) return true;
    return false;
  }) ?? null;
}

/**
 * Find matching cashback item from matrix by product code,
 * handling leading zeroes if necessary.
 */
export function findCashbackItem(matrix: any[] | undefined | null, targetCode: string) {
  if (!targetCode || !Array.isArray(matrix)) return null;
  const cleanTarget = String(targetCode).trim();
  const strippedTarget = cleanTarget.replace(/^0+/, "");

  return matrix.find((m: any) => {
    const codeStr = String(m.code || m.pro_code || m.kodeProduk || m.pro_code_raw || m.kode || "").trim();
    if (codeStr === cleanTarget) return true;
    if (codeStr.replace(/^0+/, "") === strippedTarget) return true;
    return false;
  }) ?? null;
}

/**
 * Extract product unit label (satuan), defaulting to 'SJ' if empty or dash.
 */
export function satuanLabel(product: Product | null | undefined): string {
  const s = product?.satuan?.trim();
  return s && !/^[-—–]$/.test(s) ? s : "SJ";
}

/**
 * Format HNA column label with unit, e.g. "HNA (BOX)" or "HNA (SJ)".
 */
export function formatHnaLabel(product: Product | null | undefined): string {
  const s = satuanLabel(product);
  if (s.startsWith("(") && s.endsWith(")")) return `HNA ${s}`;
  return `HNA (${s})`;
}

/**
 * Resolve product name from master products by code, with fallback.
 */
export function resolveProductName(code: string, masterProducts: any[]): string {
  if (!code) return "";
  const clean = String(code).trim();
  const stripped = clean.replace(/^0+/, "");
  const found = masterProducts.find((p: any) => {
    const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
    return pCode === clean || pCode.replace(/^0+/, "") === stripped;
  });
  if (found?.namaProduk) return found.namaProduk;

  return `Produk ${clean}`;
}

/**
 * Get numerical HNA for a product code from master products.
 */
export function getHnaForProduct(code: string, masterProducts: any[]): number {
  if (!code || !Array.isArray(masterProducts) || masterProducts.length === 0) return 0;
  const cleanCode = String(code).trim();
  const strippedCode = cleanCode.replace(/^0+/, "");

  const item = masterProducts.find((p: any) => {
    const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
    if (pCode === cleanCode) return true;
    if (pCode.replace(/^0+/, "") === strippedCode) return true;
    return false;
  });

  if (!item) return 0;
  const rawHna = item.hna;
  const num = typeof rawHna === "number" ? rawHna : parseFloat(String(rawHna || "0"));
  return isNaN(num) ? 0 : num;
}

/**
 * Check if two active ingredient (zat aktif) strings match.
 */
export function isSameZatAktif(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const cleanA = a.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  const cleanB = b.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

  const wordsA = a.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  const wordsB = b.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  return wordsA.some((wa) => wordsB.includes(wa));
}
