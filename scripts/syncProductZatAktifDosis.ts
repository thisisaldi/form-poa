/**
 * Enriches Product with Zat Aktif + dosis reference data from
 * "List Product pharos.xlsx" (sheets "Oral Product" / "Injeksi Product").
 *
 * That file's "PROCOD" column despite the name matches Product.kodeProduk
 * (Kd Item) directly — verified 07-20 against the live DB (191/192 codes
 * matched exactly, only 1 not found). No bridge/mapping file needed.
 *
 * Layout (header row 3, data from row 4):
 *   Col 2:  PROCOD                                              → kodeProduk
 *   Col 4:  ZAT AKTIF                                            → zatAktif
 *   Col 5:  DOSIS/KEKUATAN SEDIAAN                                → dosisKekuatanSediaan
 *   Col 6:  Berapa banyak per Rx per Pasien (Satuan Terkecil)     → qtyPerRxPasien
 *   Col 7:  Lama pemberian Per Pasien (Hari)                     → lamaPemberianHari
 *   Col 8:  Jumlah pemberian Per hari (Satuan Terkecil)           → jumlahPemberianPerHari
 *   Col 9:  BENTUK SEDIAAN                                        → bentukSediaan
 *   Col 10: PACKING                                               → packing
 *   Col 11: INDIKASI                                              → indikasi
 *
 * Rows without a PROCOD value are category header rows — skipped.
 *
 * PACKING → satuanTerkecil/konversiPembagi (07-20, per user request): PACKING text
 * like "Box, 3 Strip @ 10 kapsul" means 1 SJ (box) = 3×10 = 30 of the innermost
 * discrete dosage unit (here CAPSUL). Only parsed for a small, unambiguous
 * vocabulary of countable dosage forms (tablet/kapsul/kaplet/supp/ovula/sachet) —
 * liquid/weight units (mL, g, mg) and ampul/vial/botol-only mentions are left
 * alone since the "true" satuanTerkecil for those depends on business pricing
 * convention, not just packaging grammar. Only APPLIED when a product's
 * satuanTerkecil is currently null — never overrides the authoritative values
 * already synced from Kebutuhan Satuan Terkecil.xlsx (syncSatuanTerkecil.ts).
 *
 * Run: npx tsx scripts/syncProductZatAktifDosis.ts [path-to-excel]
 * Default: internal/List Product pharos.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const DATA_START = 4;
const SHEETS = ["Oral Product", "Injeksi Product"];

function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
}

const DISCRETE_UNIT_MAP: Record<string, string> = {
  tablet: "TABLET", tab: "TABLET",
  kapsul: "CAPSUL", capsul: "CAPSUL", kap: "CAPSUL",
  kaplet: "CAPLET", caplet: "CAPLET",
  supp: "SUPPOSITOR", suppositoria: "SUPPOSITOR",
  ovula: "OVULA",
  sachet: "SACHET",
};

function normalizeDiscreteUnit(raw: string): string | null {
  const firstWord = raw.trim().match(/^[A-Za-z]+/)?.[0]?.toLowerCase() ?? "";
  return DISCRETE_UNIT_MAP[firstWord] ?? null;
}

/**
 * "Box, 3 Strip @ 10 kapsul" -> { satuanTerkecil: "CAPSUL", konversi: 30 }.
 * Returns null for liquid/weight units or anything not matching a known
 * discrete dosage form — those are left alone, not guessed at.
 */
function parsePackingToST(packing: string): { satuanTerkecil: string; konversi: number } | null {
  const s = packing.trim();

  // "N1 <container>? [@x×*] N2 <unit...>" — e.g. "Box, 3 Strip @ 10 kapsul"
  const m = s.match(/(\d+)\s*[A-Za-z]*\s*[@x×*]\s*(\d+)\s*([A-Za-z' `]+)/i);
  if (m) {
    const unit = normalizeDiscreteUnit(m[3]);
    if (unit) return { satuanTerkecil: unit, konversi: parseInt(m[1], 10) * parseInt(m[2], 10) };
  }

  // "isi N unit" — e.g. "1 Box isi 25 sachet"
  const m2 = s.match(/isi\s*(\d+)\s*([A-Za-z]+)/i);
  if (m2) {
    const unit = normalizeDiscreteUnit(m2[2]);
    if (unit) return { satuanTerkecil: unit, konversi: parseInt(m2[1], 10) };
  }

  // trailing "N unit" with no leading multiplier — e.g. a bare "5 tablet"
  const m3 = s.match(/(\d+)\s*([A-Za-z]+)\s*$/);
  if (m3) {
    const unit = normalizeDiscreteUnit(m3[2]);
    if (unit) return { satuanTerkecil: unit, konversi: parseInt(m3[1], 10) };
  }

  return null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/List Product pharos.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  let updated = 0, notFound = 0, skipped = 0, stFilled = 0, stSkippedAmbiguous = 0;
  const notFoundCodes: string[] = [];

  for (const sheetName of SHEETS) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) { console.error(`Sheet '${sheetName}' not found — skipping.`); continue; }

    for (let r = DATA_START; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const kodeProduk = str(row.getCell(2).value);
      if (!kodeProduk) { skipped++; continue; } // category header row

      const zatAktif = str(row.getCell(4).value);
      const dosisKekuatanSediaan = str(row.getCell(5).value);
      const qtyPerRxPasien = num(row.getCell(6).value);
      const lamaPemberianHari = num(row.getCell(7).value);
      const jumlahPemberianPerHari = num(row.getCell(8).value);
      const bentukSediaan = str(row.getCell(9).value);
      const packing = str(row.getCell(10).value);
      const indikasi = str(row.getCell(11).value);

      const existing = await prisma.product.findUnique({ where: { kodeProduk }, select: { satuanTerkecil: true } });
      if (!existing) { notFound++; notFoundCodes.push(`${kodeProduk} (${sheetName})`); continue; }

      let stFromPacking: { satuanTerkecil: string; konversi: number } | null = null;
      if (existing.satuanTerkecil == null && packing) {
        stFromPacking = parsePackingToST(packing);
        if (stFromPacking) stFilled++; else stSkippedAmbiguous++;
      }

      await prisma.product.update({
        where: { kodeProduk },
        data: {
          zatAktif,
          dosisKekuatanSediaan,
          qtyPerRxPasien: qtyPerRxPasien != null ? new Prisma.Decimal(qtyPerRxPasien) : null,
          lamaPemberianHari: lamaPemberianHari != null ? Math.round(lamaPemberianHari) : null,
          jumlahPemberianPerHari: jumlahPemberianPerHari != null ? new Prisma.Decimal(jumlahPemberianPerHari) : null,
          bentukSediaan,
          packing,
          indikasi,
          ...(stFromPacking && {
            satuanTerkecil: stFromPacking.satuanTerkecil,
            konversiPembagi: new Prisma.Decimal(stFromPacking.konversi),
          }),
        },
      });
      updated++;
    }
  }

  console.log(`✅ Done.`);
  console.log(`   Updated       : ${updated}`);
  console.log(`   Not found in Product table: ${notFound}`);
  console.log(`   Skipped (category header rows): ${skipped}`);
  console.log(`   Satuan Terkecil filled from PACKING (was null): ${stFilled}`);
  console.log(`   Satuan Terkecil left null (PACKING ambiguous/liquid, was null): ${stSkippedAmbiguous}`);
  if (notFoundCodes.length > 0) console.log(`   Missing codes: ${notFoundCodes.join(", ")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
