/**
 * Versi CLI dari export absensi Hospital (logika di src/lib/absensiHospitalExport.ts,
 * versi web: /absensi-hospital buat SFE/ADMIN).
 *
 * Run: npx tsx --env-file=.env.local scripts/exportAbsensiHospital.ts [start YYYY-MM-DD] [end YYYY-MM-DD] [output-path]
 * (--env-file wajib: kredensial SIPP ada di .env.local, dotenv/config cuma baca .env)
 * Default: 2026-09-01 s/d hari ini, internal/absensi_hospital_<start>_<end>.xlsx
 */

import "dotenv/config";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { buildAbsensiHospitalWorkbook } from "../src/lib/absensiHospitalExport";

async function main() {
  const startDate = process.argv[2] ?? "2026-09-01";
  const endDate = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const outPath = process.argv[4] ?? path.join("internal", `absensi_hospital_${startDate}_${endDate}.xlsx`);

  const t0 = Date.now();
  const { workbook, people, mergedAliasPeople, problems } = await buildAbsensiHospitalWorkbook(startDate, endDate);
  await workbook.xlsx.writeFile(outPath);
  console.log(`${people} orang, ${startDate} s/d ${endDate}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`Orang dengan NIP lama beririsan periode (di-merge): ${mergedAliasPeople}`);
  console.log(`Ditulis: ${outPath}`);
  if (problems.length) console.log(`Bermasalah (${problems.length}):\n  ${problems.join("\n  ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
