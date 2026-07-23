/**
 * Import "internal/17062026 Data Rekomendasi Final.xlsx" — per (doctor,
 * outlet, recommended product) survey row into SurveyRekomendasi.
 *
 * Source shape (Sheet1, one header row, columns A-O): Kode RS, Nama RS, Kode
 * Dokter, Nama Dokter, Kode Produk, Produk Rekomendasi, Zat Aktif, Dosage
 * Form, Kode Spesialis, Spesialis, Potensi / Bulan, History Produk, Status
 * Sales, Status PSSP, Metode Pemilihan.
 *
 * "Kode Dokter" is the same CDB code namespace as Customer.kodeCustomer,
 * "Kode RS" the same as Outlet.kodePI — confirmed by direct sampling against
 * the DB — but this table does NOT FK either of them: the row should still
 * exist even for a doctor not yet in our Customer table (matched by string
 * at query time, like PoaLineItem.kodeCust already is).
 *
 * "History Produk" is a raw "PRODUCT NAME (XX.X%); PRODUCT NAME (YY.Y%)"
 * string covering whatever brand-level products this doctor has actually
 * used for this zat aktif/bentuk sediaan category (ours and competitors'
 * mixed) — parsed downstream by getKompetitorHistory() in customer.ts, not
 * here; stored as-is.
 *
 * Effects: one SurveyRekomendasi row per (kodePI, kodeCustomer, kodeProduk),
 * upserted (source has no true row id). Rows skipped (and counted) when:
 * kodeOutlet blank or doesn't resolve to an existing Outlet, kodeDokter
 * blank, or kodeProduk blank.
 *
 * Run: npx tsx scripts/importSurveyRekomendasi.ts [path-to-excel]
 * Default: "internal/17062026 Data Rekomendasi Final.xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";

const BATCH = 500;

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

interface SourceRow {
  kodePI: string;
  kodeCustomer: string;
  namaCustomer: string;
  kodeProduk: string;
  namaProdukRekomendasi: string;
  zatAktif: string | null;
  dosageForm: string | null;
  kodeSpesialis: string | null;
  spesialis: string | null;
  potensiBulan: number | null;
  historyProduk: string;
  statusSales: string | null;
  statusPssp: string | null;
  metodePemilihan: string | null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/17062026 Data Rekomendasi Final.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) { console.error('Sheet "Sheet1" not found'); process.exit(1); }

  const now = new Date();
  const rows: SourceRow[] = [];
  let skippedBlankOutlet = 0, skippedBlankDokter = 0, skippedBlankProduk = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const kodePI = String(row.getCell(1).value ?? "").trim();
    const namaRS = String(row.getCell(2).value ?? "").trim();
    const kodeCustomer = String(row.getCell(3).value ?? "").trim();
    const namaCustomer = String(row.getCell(4).value ?? "").trim();
    const kodeProduk = String(row.getCell(5).value ?? "").trim();
    const namaProdukRekomendasi = String(row.getCell(6).value ?? "").trim();
    const zatAktif = String(row.getCell(7).value ?? "").trim() || null;
    const dosageForm = String(row.getCell(8).value ?? "").trim() || null;
    const kodeSpesialis = String(row.getCell(9).value ?? "").trim() || null;
    const spesialis = String(row.getCell(10).value ?? "").trim() || null;
    const potensiRaw = row.getCell(11).value;
    const historyProduk = String(row.getCell(12).value ?? "").trim();
    const statusSales = String(row.getCell(13).value ?? "").trim() || null;
    const statusPssp = String(row.getCell(14).value ?? "").trim() || null;
    const metodePemilihan = String(row.getCell(15).value ?? "").trim() || null;
    void namaRS;

    if (!kodePI) { skippedBlankOutlet++; continue; }
    if (!kodeCustomer) { skippedBlankDokter++; continue; }
    if (!kodeProduk) { skippedBlankProduk++; continue; }

    const potensiBulan = typeof potensiRaw === "number" ? potensiRaw
      : parseFloat(String(potensiRaw ?? "")) || null;

    rows.push({
      kodePI, kodeCustomer, namaCustomer, kodeProduk, namaProdukRekomendasi,
      zatAktif, dosageForm, kodeSpesialis, spesialis, potensiBulan,
      historyProduk, statusSales, statusPssp, metodePemilihan,
    });
  }

  console.log(`Parsed ${rows.length} usable rows (skipped ${skippedBlankOutlet} blank kodePI, ${skippedBlankDokter} blank kodeDokter, ${skippedBlankProduk} blank kodeProduk).\n`);

  // ── Filter to outlets that actually exist ─────────────────────────────────
  const outletRows = await prisma.outlet.findMany({ select: { kodePI: true } });
  const validOutlets = new Set(outletRows.map((o: { kodePI: string }) => o.kodePI));
  const beforeOutletFilter = rows.length;
  const filteredRows = rows.filter((r) => validOutlets.has(r.kodePI));
  console.log(`${filteredRows.length}/${beforeOutletFilter} rows have a kodePI that exists in our Outlet table (rest skipped — outlet genuinely missing).\n`);

  // ── Dedupe exact (kodePI, kodeCustomer, kodeProduk) duplicates — keep last ──
  const dedupedMap = new Map<string, SourceRow>();
  for (const r of filteredRows) dedupedMap.set(`${r.kodePI}|${r.kodeCustomer}|${r.kodeProduk}`, r);
  const deduped = [...dedupedMap.values()];
  console.log(`${deduped.length} rows after deduping exact (kodePI, kodeCustomer, kodeProduk) duplicates.\n`);

  console.log(`Upserting ${deduped.length} SurveyRekomendasi rows...`);
  for (let i = 0; i < deduped.length; i += BATCH) {
    const chunk = deduped.slice(i, i + BATCH);
    const values = chunk.map((r) => `(
      '${randomUUID()}',
      '${esc(r.kodePI)}',
      '${esc(r.kodeCustomer)}',
      '${esc(r.namaCustomer)}',
      '${esc(r.kodeProduk)}',
      '${esc(r.namaProdukRekomendasi)}',
      ${sqlNullableStr(r.zatAktif)},
      ${sqlNullableStr(r.dosageForm)},
      ${sqlNullableStr(r.kodeSpesialis)},
      ${sqlNullableStr(r.spesialis)},
      ${r.potensiBulan ?? "NULL"},
      '${esc(r.historyProduk)}',
      ${sqlNullableStr(r.statusSales)},
      ${sqlNullableStr(r.statusPssp)},
      ${sqlNullableStr(r.metodePemilihan)},
      '${now.toISOString()}'
    )`).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SurveyRekomendasi" (
        "id", "kodePI", "kodeCustomer", "namaCustomer", "kodeProduk", "namaProdukRekomendasi",
        "zatAktif", "dosageForm", "kodeSpesialis", "spesialis", "potensiBulan",
        "historyProduk", "statusSales", "statusPssp", "metodePemilihan", "syncedAt"
      )
      VALUES ${values}
      ON CONFLICT ("kodePI", "kodeCustomer", "kodeProduk") DO UPDATE SET
        "namaCustomer" = EXCLUDED."namaCustomer",
        "namaProdukRekomendasi" = EXCLUDED."namaProdukRekomendasi",
        "zatAktif" = EXCLUDED."zatAktif",
        "dosageForm" = EXCLUDED."dosageForm",
        "kodeSpesialis" = EXCLUDED."kodeSpesialis",
        "spesialis" = EXCLUDED."spesialis",
        "potensiBulan" = EXCLUDED."potensiBulan",
        "historyProduk" = EXCLUDED."historyProduk",
        "statusSales" = EXCLUDED."statusSales",
        "statusPssp" = EXCLUDED."statusPssp",
        "metodePemilihan" = EXCLUDED."metodePemilihan",
        "syncedAt" = EXCLUDED."syncedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, deduped.length)}/${deduped.length}\r`);
  }
  console.log(`\n✅ SurveyRekomendasi upserted: ${deduped.length} rows.\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
