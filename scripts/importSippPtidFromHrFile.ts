/**
 * One-off import: seeds User.sippAbsPtId from the HR-provided master file
 * (multi-sheet xlsx, one sheet per PTID source system — NTSQL=1, PML=7,
 * Faratu=20 as of 2026-09-23; columns Kry_NIP/Kry_PTID). Ground truth from
 * HR beats the NIP-prefix guess in kpiAbsensiSync.ts (which got ~1,083
 * "P"-prefixed NIPs wrong — they're actually PTID 7, not 1). Only updates
 * users already in our DB; doesn't touch NIPs absent from the file.
 *
 * Run: npx tsx scripts/importSippPtidFromHrFile.ts <path-to-xlsx>
 * Re-run whenever HR sends a refreshed file.
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/importSippPtidFromHrFile.ts <path-to-xlsx>");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const mapping = new Map<string, number>();
  for (const ws of wb.worksheets) {
    const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
    const nipCol = header.indexOf("Kry_NIP");
    const ptidCol = header.indexOf("Kry_PTID");
    if (nipCol === -1 || ptidCol === -1) continue;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const nip = String(row.getCell(nipCol).value ?? "").trim().toUpperCase();
      const ptid = Number(row.getCell(ptidCol).value);
      if (nip && Number.isFinite(ptid)) mapping.set(nip, ptid);
    });
  }
  console.log(`Parsed ${mapping.size} NIP→PTID rows from ${wb.worksheets.length} sheet(s).`);

  const ourUsers = await prisma.user.findMany({ select: { nip: true, sippAbsPtId: true } });
  let updated = 0, unchanged = 0, notInFile = 0;
  for (const u of ourUsers) {
    const ptid = mapping.get(u.nip.toUpperCase());
    if (ptid == null) { notInFile++; continue; }
    if (u.sippAbsPtId === ptid) { unchanged++; continue; }
    await prisma.user.update({ where: { nip: u.nip }, data: { sippAbsPtId: ptid } });
    updated++;
  }
  console.log({ ourUsers: ourUsers.length, updated, unchanged, notInFile });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
