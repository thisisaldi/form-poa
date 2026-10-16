/**
 * Ganti NIP satu user (orang yang sama, NIP baru) + aktifkan lagi.
 *
 * Kasus: karyawan pindah NIP (mis. P230208 -> L260540) sementara Nexus belum
 * diperbarui, jadi org sync menonaktifkan NIP lama dan NIP baru belum ada.
 *
 *   npx tsx scripts/renameUserNip.ts P230208 L260540            # SIMULASI, tidak menulis
 *   npx tsx scripts/renameUserNip.ts P230208 L260540 --apply    # tulis (satu transaksi)
 *
 * DB yang dituju = DATABASE_URL (default .env = staging). Untuk production set
 * DATABASE_URL ke .env.production secara eksplisit.
 *
 * - User.nip adalah PK; seluruh FK ke User sudah ON UPDATE CASCADE (dicek dari
 *   pg_constraint, kalau ada yang bukan CASCADE skrip berhenti), jadi satu UPDATE
 *   di "User" ikut menggeser POA, approval, audit log, dst.
 * - Kolom NIP TANPA FK (updatedByNip, OutletStrukturBaru.*Nip, Outlet.coveredByNip,
 *   dst) dicari dari information_schema dan di-UPDATE juga.
 * - syncedAt diisi sekarang supaya masa tenggang org sync (36 jam) berlaku. Kalau
 *   NIP baru belum muncul di Nexus sampai itu lewat, sync akan menonaktifkannya
 *   lagi: Nexus tetap harus diperbarui.
 * - nipAtasan / namaAtasan / role user TIDAK diubah.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const [oldNip, newNip] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

// Kolom bertipe teks yang menyimpan NIP orang lain/aksi, tapi bukan relasi ke User.
// sipp_employees = data mentah SIPP (bukan milik app), jangan disentuh.
const SKIP = new Set(["User.nip", "sipp_employees.nip"]);

async function main() {
  if (!oldNip || !newNip) throw new Error("Pakai: npx tsx scripts/renameUserNip.ts <NIP_LAMA> <NIP_BARU> [--apply]");
  const db: { db: string; host: string | null }[] = await prisma.$queryRawUnsafe(`select current_database() db, inet_server_addr()::text host`);
  console.log(`DB: ${db[0].db} @ ${db[0].host}  |  mode: ${apply ? "APPLY (menulis)" : "SIMULASI"}`);

  const [oldUser, newUser] = await Promise.all([
    prisma.user.findUnique({ where: { nip: oldNip } }),
    prisma.user.findUnique({ where: { nip: newNip } }),
  ]);
  if (!oldUser) throw new Error(`NIP lama ${oldNip} tidak ada.`);
  if (newUser) throw new Error(`NIP baru ${newNip} SUDAH ada (${newUser.name}); gabungkan manual, skrip ini tidak menimpa.`);
  console.log(`Lama: ${oldUser.nip} ${oldUser.name} [${oldUser.role}] aktif=${oldUser.isActive} atasan=${oldUser.nipAtasan}`);

  const fks: { tbl: string; col: string; upd: string }[] = await prisma.$queryRawUnsafe(`
    select conrelid::regclass::text tbl, a.attname col, confupdtype::text upd
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey)
    where c.contype='f' and c.confrelid='"User"'::regclass`);
  const notCascade = fks.filter((f) => f.upd !== "c");
  if (notCascade.length) throw new Error(`FK bukan ON UPDATE CASCADE: ${notCascade.map((f) => `${f.tbl}.${f.col}`).join(", ")}`);
  const fkSet = new Set(fks.map((f) => `${f.tbl.replace(/"/g, "")}.${f.col}`));

  const cols: { tbl: string; col: string }[] = await prisma.$queryRawUnsafe(`
    select table_name tbl, column_name col from information_schema.columns
    where table_schema='public' and data_type in ('text','character varying')
      and (column_name ilike '%nip%' or column_name in ('currentHolderId','ownerId','actorId'))`);
  const loose = cols.filter((c) => !fkSet.has(`${c.tbl}.${c.col}`) && !SKIP.has(`${c.tbl}.${c.col}`));

  // Hitung dulu apa yang akan berubah.
  const plan: { target: string; rows: number }[] = [];
  const viaFk = fks.length;
  for (const c of loose) {
    const r: { n: bigint }[] = await prisma.$queryRawUnsafe(`select count(*)::bigint n from ${q(c.tbl)} where ${q(c.col)} = $1`, oldNip);
    if (Number(r[0].n) > 0) plan.push({ target: `${c.tbl}.${c.col}`, rows: Number(r[0].n) });
  }
  const fkCounts: { target: string; rows: number }[] = [];
  for (const f of fks) {
    const r: { n: bigint }[] = await prisma.$queryRawUnsafe(`select count(*)::bigint n from ${f.tbl} where ${q(f.col)} = $1`, oldNip);
    if (Number(r[0].n) > 0) fkCounts.push({ target: `${f.tbl.replace(/"/g, "")}.${f.col}`, rows: Number(r[0].n) });
  }
  console.log(`\nIkut otomatis (FK CASCADE, dari ${viaFk} FK):`);
  console.table(fkCounts);
  console.log("Di-UPDATE manual (kolom NIP tanpa FK):");
  console.table(plan);

  if (!apply) {
    console.log(`\nSIMULASI selesai. ${oldNip} -> ${newNip}, isActive=true. Tambah --apply untuk menulis.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`update "User" set "nip" = $1, "isActive" = true, "syncedAt" = now(), "updatedAt" = now() where "nip" = $2`, newNip, oldNip);
    for (const c of loose) {
      await tx.$executeRawUnsafe(`update ${q(c.tbl)} set ${q(c.col)} = $1 where ${q(c.col)} = $2`, newNip, oldNip);
    }
    const left = await tx.user.count({ where: { nip: oldNip } });
    if (left !== 0) throw new Error("NIP lama masih ada setelah update; rollback.");
  });
  const after = await prisma.user.findUnique({ where: { nip: newNip }, select: { nip: true, name: true, role: true, isActive: true, nipAtasan: true } });
  console.log("\nSELESAI:", after);
}

main()
  .catch((e) => {
    console.error("GAGAL:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
