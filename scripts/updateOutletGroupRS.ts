/**
 * Update Outlet.groupRS and Outlet.kota from "RS GROUP - PHAROS INDONESIA.xlsx"
 * sheet "MASTER-RS-ALL-CHANEL".
 *
 * Layout (header row 3, data from row 4):
 *   Col 2: KODE PI   → kodePI
 *   Col 4: GROUP/NON → groupRS  (e.g. "HERMINA GRUP", "NON CHAIN")
 *   Col 6: KOTA      → kota
 *
 * Run: npx tsx scripts/updateOutletGroupRS.ts [path-to-excel]
 * Default: excel/RS GROUP - PHAROS INDONESIA.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const DATA_START = 4;

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/RS GROUP - PHAROS INDONESIA.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet("MASTER-RS-ALL-CHANEL");
  if (!ws) { console.error("Sheet 'MASTER-RS-ALL-CHANEL' not found"); process.exit(1); }

  const outletMap = new Map<string, { groupRS: string; kota: string }>();

  for (let rn = DATA_START; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const kodePI  = String(row.getCell(2).value ?? "").trim();
    const groupRS = String(row.getCell(4).value ?? "").trim();
    const kota    = String(row.getCell(6).value ?? "").trim();
    if (kodePI && groupRS) {
      outletMap.set(kodePI, { groupRS, kota });
    }
  }

  console.log(`Collected ${outletMap.size} unique outlets from MASTER-RS-ALL-CHANEL.\n`);

  let updated = 0, skipped = 0;

  for (const [kodePI, { groupRS, kota }] of outletMap) {
    const result = await prisma.outlet.updateMany({
      where: { kodePI },
      data: { groupRS, ...(kota ? { kota } : {}) },
    });
    if (result.count > 0) updated++;
    else skipped++;
  }

  console.log(`✅ Done.`);
  console.log(`   Updated : ${updated} outlets`);
  console.log(`   Skipped : ${skipped} (kodePI not found in Outlet table)`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
