/**
 * Seed OutletProductKriteria from ProductPMDatabase.xlsx Unpivot_* sheets.
 *
 * Logic:
 *   1. Read KonversiProduk sheet → Map<namaProdukPM + paket, kodeProduk>
 *   2. For each Unpivot_[PAKET] sheet, for each data row:
 *        kodePI, namaProdukPM, kategori, statusTransaksi, kriteriaBaru
 *      → look up kodeProduk via step 1
 *      → upsert OutletProductKriteria(kodePI, kodeProduk, paket, ...)
 *
 * Run: npx tsx scripts/seedOutletProductKriteria.ts [path-to-excel]
 * Default: excel/ProductPMDatabase.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/ProductPMDatabase.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // ── 1. Build namaProdukPM → kodeProduk lookup ────────────────────────────
  // Primary: "Kode Item" sheet (kode without leading zeros → pad to 6 digits)
  // Fallback: "KonversiProduk" sheet (kode already 6-digit padded)
  const pad6 = (s: string) => s.padStart(6, "0");

  const produkMap = new Map<string, string>(); // namaPM.toUpperCase() → kodeProduk (6-digit)

  const kodeItemSheet = wb.getWorksheet("Kode Item");
  if (!kodeItemSheet) { console.error("Sheet 'Kode Item' not found"); process.exit(1); }
  kodeItemSheet.eachRow((row, rn) => {
    if (rn === 1) return;
    const raw  = String(row.getCell(2).value ?? "").trim();
    const namaPM = String(row.getCell(3).value ?? "").trim().toUpperCase();
    if (namaPM && raw) produkMap.set(namaPM, pad6(raw));
  });

  // Supplement with KonversiProduk for any names not yet mapped (e.g. IMDROS)
  const konversiSheet = wb.getWorksheet("KonversiProduk");
  if (konversiSheet) {
    konversiSheet.eachRow((row, rn) => {
      if (rn === 1) return;
      const namaPM = String(row.getCell(1).value ?? "").trim().toUpperCase();
      const raw    = String(row.getCell(3).value ?? "").trim();
      if (namaPM && raw && !produkMap.has(namaPM)) {
        produkMap.set(namaPM, pad6(raw));
      }
    });
  }

  console.log(`Produk map: ${produkMap.size} entries loaded.`);

  // ── 2. Process each Unpivot sheet ────────────────────────────────────────
  const unpivotSheets = wb.worksheets.filter(ws => ws.name.startsWith("Unpivot_"));
  console.log(`Found ${unpivotSheets.length} Unpivot sheets.\n`);

  let upserted = 0, skipped = 0, noKode = 0;

  for (const ws of unpivotSheets) {
    const paketName = "PAKET " + ws.name.replace("Unpivot_", ""); // e.g. PAKET PENCERNAAN
    let sheetCount = 0;

    ws.eachRow((row, rn) => {
      if (rn === 1) return; // skip header

      const kodePI         = String(row.getCell(2).value ?? "").trim();
      const namaProdukPM   = String(row.getCell(8).value ?? "").trim();
      const kategori       = String(row.getCell(9).value ?? "").trim();
      const statusRaw      = row.getCell(10).value;
      const statusTransaksi = typeof statusRaw === "number" ? statusRaw : parseInt(String(statusRaw ?? "0")) || 0;
      // Col 12: Kriteria Baru (formula result)
      const kriteriaBaru   = (() => {
        const cell = row.getCell(12);
        const v = cell.value;
        if (v && typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
        return String(v ?? "").trim();
      })();

      if (!kodePI || !namaProdukPM || !kategori) { skipped++; return; }

      const kodeProduk = produkMap.get(namaProdukPM.toUpperCase());
      if (!kodeProduk) { noKode++; return; }

      sheetCount++;
    });

    console.log(`  ${ws.name}: ${sheetCount} valid rows`);
  }

  // ── 3. Actual upsert pass ─────────────────────────────────────────────────
  console.log("\nUpserting to DB...");

  for (const ws of unpivotSheets) {
    const paketName = "PAKET " + ws.name.replace("Unpivot_", "");

    const rows: {
      kodePI: string; kodeProduk: string; paket: string;
      kategori: string; kriteriaBaru: string; statusTransaksi: number;
    }[] = [];

    ws.eachRow((row, rn) => {
      if (rn === 1) return;
      const kodePI       = String(row.getCell(2).value ?? "").trim();
      const namaProdukPM = String(row.getCell(8).value ?? "").trim();
      const kategori     = String(row.getCell(9).value ?? "").trim();
      const statusRaw    = row.getCell(10).value;
      const statusTransaksi = typeof statusRaw === "number" ? statusRaw : parseInt(String(statusRaw ?? "0")) || 0;
      const kriteriaCell = row.getCell(12);
      const kriteriaVal  = kriteriaCell.value;
      const kriteriaBaru = (() => {
        if (kriteriaVal && typeof kriteriaVal === "object" && "result" in kriteriaVal)
          return String((kriteriaVal as { result: unknown }).result ?? "").trim();
        return String(kriteriaVal ?? "").trim();
      })();

      if (!kodePI || !namaProdukPM || !kategori) return;
      const kodeProduk = produkMap.get(namaProdukPM.toUpperCase());
      if (!kodeProduk) return;

      rows.push({ kodePI, kodeProduk, paket: paketName, kategori, kriteriaBaru, statusTransaksi });
    });

    // Batch upsert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await prisma.$transaction(
        chunk.map(r =>
          prisma.outletProductKriteria.upsert({
            where: { kodePI_kodeProduk_paket: { kodePI: r.kodePI, kodeProduk: r.kodeProduk, paket: r.paket } },
            update: { kategori: r.kategori, kriteriaBaru: r.kriteriaBaru, statusTransaksi: r.statusTransaksi },
            create: r,
          })
        )
      );
      upserted += chunk.length;
    }
  }

  console.log(`\n✅ Done.`);
  console.log(`   Upserted : ${upserted}`);
  console.log(`   Skipped  : ${skipped} (missing kodePI/nama/kategori)`);
  console.log(`   No kode  : ${noKode} (namaProdukPM not in Kode Item sheet)`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
