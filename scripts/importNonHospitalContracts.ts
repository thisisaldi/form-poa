/**
 * Imports Non-Hospital contract data (docs/evaluasi-kontrak-non-hospital/,
 * OQ-5: the HR master file has no contract end date, so ADMIN supplies it).
 * Reads the first sheet of an xlsx with a header row containing (case-insensitive,
 * any order): NIP, Jabatan, Cabang, Periode Kontrak (bulan), Awal Kontrak, Akhir Kontrak.
 * Dates may be real Excel dates, "YYYY-MM-DD" or "DD-MM-YYYY". Upserts by (NIP, Akhir Kontrak).
 * NIPs not found in User are REPORTED, not skipped silently.
 *
 * Run: npx tsx scripts/importNonHospitalContracts.ts <path-to-xlsx>
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

function toDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/importNonHospitalContracts.ts <path-to-xlsx>");
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const c = { nip: col("nip"), jabatan: col("jabatan"), cabang: col("cabang"), periode: col("periode"), awal: col("awal"), akhir: col("akhir") };
  if (c.nip < 0 || c.awal < 0 || c.akhir < 0) {
    console.error("Header wajib: NIP, Awal Kontrak, Akhir Kontrak", header);
    process.exit(1);
  }

  const badDate: string[] = [];
  let total = 0;
  const rows: { nip: string; jabatan: string | null; cabang: string | null; periodeBulan: number | null; awal: Date; akhir: Date }[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    total++;
    const nip = String(row.getCell(c.nip).value ?? "").trim().toUpperCase();
    if (!nip) return;
    const awal = toDate(row.getCell(c.awal).value);
    const akhir = toDate(row.getCell(c.akhir).value);
    if (!awal || !akhir) {
      badDate.push(nip);
      return;
    }
    const per = c.periode >= 0 ? Number(row.getCell(c.periode).value) : NaN;
    rows.push({
      nip, awal, akhir,
      jabatan: c.jabatan >= 0 ? String(row.getCell(c.jabatan).value ?? "").trim() || null : null,
      cabang: c.cabang >= 0 ? String(row.getCell(c.cabang).value ?? "").trim() || null : null,
      periodeBulan: Number.isFinite(per) ? per : null,
    });
  });

  const users = (await prisma.user.findMany({ where: { nip: { in: rows.map((r) => r.nip) } }, select: { nip: true } })) as { nip: string }[];
  const realNip = new Map(users.map((u) => [u.nip.toUpperCase(), u.nip]));
  const unknownNip: string[] = [];
  let upserted = 0;
  for (const r of rows) {
    const nip = realNip.get(r.nip);
    if (!nip) {
      unknownNip.push(r.nip);
      continue;
    }
    await prisma.nonHospitalContract.upsert({
      where: { nip_akhirKontrak: { nip, akhirKontrak: r.akhir } },
      create: { nip, jabatan: r.jabatan, cabang: r.cabang, periodeBulan: r.periodeBulan, awalKontrak: r.awal, akhirKontrak: r.akhir },
      update: { jabatan: r.jabatan, cabang: r.cabang, periodeBulan: r.periodeBulan, awalKontrak: r.awal },
    });
    upserted++;
  }
  console.log({ rows: total, upserted, unknownNip: unknownNip.length, badDate: badDate.length });
  if (unknownNip.length) console.log("NIP tidak ada di User:", unknownNip.join(", "));
  if (badDate.length) console.log("Tanggal tidak valid:", badDate.join(", "));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
