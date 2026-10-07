/**
 * Import grup Hospital Key Account (docs/poa-standarisasi-pusat/02-data-model.md §4).
 *
 *   npx tsx scripts/importHkaGroups.ts [path.xlsx]           # dry-run
 *   npx tsx scripts/importHkaGroups.ts [path.xlsx] --apply   # tulis ke DB
 *
 * Default file: internal/Grouping Hospital Key Account (1).xlsx — kolom
 * No | Kode Outlet | Nama Outlet | Outlet Grup. Set Outlet.hkaGroup per kodePI
 * (outlet yang tidak ada di tabel Outlet dilaporkan, tidak dibuat) dan
 * User tim HKA di-upsert (dibuat kalau belum ada, diaktifkan, isHka = true).
 * Idempotent. Tidak menghapus hkaGroup outlet yang tidak ada di file —
 * melepas outlet dari grup dilakukan manual.
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

// Tim HKA. Ahsanul = role GM (level ASD di DB), label jabatan "DIR". Dibuat kalau belum ada di User; org sync tidak menonaktifkan isHka.
const HKA_USERS = [
  { nip: "972977", name: "AHSANUL CHALID", role: "GM", jabatan: "DIR", nipAtasan: "P200134", namaAtasan: "BRIAN LEMBONG" },
  { nip: "P240249", name: "WIDODO", role: "NSM", jabatan: null, nipAtasan: "972977", namaAtasan: "AHSANUL CHALID" },
  { nip: "P240245", name: "MASRIL", role: "NSM", jabatan: null, nipAtasan: "972977", namaAtasan: "AHSANUL CHALID" },
] as const;
const HKA_NIPS: string[] = HKA_USERS.map((u) => u.nip);

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = args.find((a) => !a.startsWith("--")) ?? path.join("internal", "Grouping Hospital Key Account (1).xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const byKode = new Map<string, string>();
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const kode = String(row.getCell(2).value ?? "").trim();
    const grup = String(row.getCell(4).value ?? "").trim();
    if (kode && grup) byKode.set(kode, grup);
  });
  console.log(`${byKode.size} outlet di file.`);

  const outlets = await prisma.outlet.findMany({ where: { kodePI: { in: [...byKode.keys()] } }, select: { kodePI: true, hkaGroup: true } });
  const found = new Map(outlets.map((o) => [o.kodePI, o.hkaGroup]));
  const missing = [...byKode.keys()].filter((k) => !found.has(k));
  const toChange = [...byKode].filter(([k, g]) => found.has(k) && found.get(k) !== g);
  console.log(`Ditemukan di DB: ${found.size}. Tidak ditemukan: ${missing.length}${missing.length ? " -> " + missing.join(", ") : ""}. Berubah: ${toChange.length}.`);

  const users = await prisma.user.findMany({ where: { nip: { in: HKA_NIPS } }, select: { nip: true, name: true, role: true, isHka: true, isActive: true } });
  for (const nip of HKA_NIPS) {
    const u = users.find((x) => x.nip === nip);
    console.log(u ? `User ${nip} ${u.name} (${u.role}) isHka=${u.isHka} isActive=${u.isActive}` : `User ${nip} belum ada -> akan DIBUAT.`);
  }

  if (!apply) return console.log("Dry-run. Tambah --apply untuk menulis.");

  for (const [kode, grup] of toChange) await prisma.outlet.update({ where: { kodePI: kode }, data: { hkaGroup: grup } });
  for (const u of HKA_USERS) {
    await prisma.user.upsert({
      where: { nip: u.nip },
      create: { nip: u.nip, name: u.name, role: u.role, jabatan: u.jabatan, nipAtasan: u.nipAtasan, namaAtasan: u.namaAtasan, isActive: true, isHka: true },
      update: { isActive: true, isHka: true, ...(u.nipAtasan ? { nipAtasan: u.nipAtasan, namaAtasan: u.namaAtasan } : {}) },
    });
  }
  console.log(`Selesai: ${toChange.length} outlet diupdate, ${HKA_USERS.length} user HKA dibuat/diaktifkan.`);
}

main().finally(() => prisma.$disconnect());
