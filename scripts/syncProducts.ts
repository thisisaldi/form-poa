/**
 * Sync products from the (password-protected) LAPORAN HNA SARUASUBUR Excel
 * into the Product table. This is the sole source of product master data —
 * LIST PRODUK PI is NOT used, because its "Procode" is a different code
 * system than the "Kd Item" code that Nilai R.xlsx and Kebutuhan Satuan
 * Terkecil.xlsx (and OutletProductKriteria's KonversiProduk sheet) already
 * key by natively. Using Kd Item as kodeProduk means those syncs need no
 * bridge/mapping file at all.
 *
 * Source layout (sheet "Sheet1", header row 8, data from row 9):
 *   Col 3:  Kd Item     → kodeProduk (primary key)
 *   Col 4:  Nama Item   → namaProduk
 *   Col 11: Group Brand → namaGroupBrand ("—" if blank)
 *   Col 12: HNA         → hna
 *   Col 15: Sellpack    → satuan ("—" if blank — not every row has one)
 *
 * Usage:
 *   npx tsx scripts/syncProducts.ts [path-to-excel]
 * Default: excel/TKT202607020007 - LAPORAN HNA SARUASUBUR.xlsx
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import officeCrypto from "officecrypto-tool";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const HNA_DATA_START = 9;
const PASSWORD = "reporting1122";

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" || s.toUpperCase() === "NULL" ? null : s;
}

async function main() {
  const filePath = path.resolve(
    process.argv[2] ?? "excel/TKT202607020007 - LAPORAN HNA SARUASUBUR.xlsx"
  );
  console.log(`Reading: ${filePath}\n`);

  const encrypted = fs.readFileSync(filePath);
  const decrypted = await officeCrypto.decrypt(encrypted, { password: PASSWORD });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duplicate/mismatched @types/node
  // Buffer typings between top-level and nested deps make this cross-package call untypeable cleanly.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(decrypted as any);

  const ws = wb.worksheets[0];
  if (!ws) { console.error("No worksheet found."); process.exit(1); }

  const now = new Date();
  let upserted = 0, skipped = 0, dupes = 0;
  const seen = new Set<string>();

  for (let r = HNA_DATA_START; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const no = row.getCell(1).value;
    if (!no) break; // end of data

    const kodeProduk = clean(row.getCell(3).value);
    const namaProduk = clean(row.getCell(4).value);
    const namaGroupBrand = clean(row.getCell(11).value) ?? "—";
    const hnaRaw = row.getCell(12).value;
    const hna = typeof hnaRaw === "number" ? hnaRaw : parseFloat(String(hnaRaw ?? "0")) || 0;
    const satuan = clean(row.getCell(15).value) ?? "—";

    if (!kodeProduk || !namaProduk) { skipped++; continue; }
    if (seen.has(kodeProduk)) { dupes++; continue; }
    seen.add(kodeProduk);

    await prisma.product.upsert({
      where: { kodeProduk },
      update: { namaGroupBrand, namaProduk, satuan, hna, syncedAt: now, updatedAt: now },
      create: { kodeProduk, namaGroupBrand, namaProduk, zatAktif: null, satuan, hna, syncedAt: now },
    });
    upserted++;
  }

  console.log(`\nDone. Upserted: ${upserted} | Skipped (no Kd Item/Nama Item): ${skipped} | Duplicate Kd Item: ${dupes}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
