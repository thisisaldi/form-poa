import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const total = await prisma.outlet.count({ where: { kodeGT: { not: null } } });
  const totalAll = await prisma.outlet.count();
  console.log(`Outlet rows: ${totalAll}, dengan kodeGT terisi: ${total}`);

  const distinctPairs = await prisma.outlet.findMany({
    where: { kodeGT: { not: null } },
    select: { kodeGT: true, namaGT: true },
    distinct: ["kodeGT", "namaGT"],
  });
  const byKode = new Map<string, Set<string>>();
  for (const p of distinctPairs) {
    const set = byKode.get(p.kodeGT!) ?? new Set();
    if (p.namaGT) set.add(p.namaGT);
    byKode.set(p.kodeGT!, set);
  }
  const collisions = [...byKode.entries()].filter(([, names]) => names.size > 1);
  console.log(`Distinct kodeGT: ${byKode.size}, yang punya >1 namaGT beda (collision): ${collisions.length}`);
  console.log(collisions.slice(0, 10));

  const sample = await prisma.outlet.findMany({ where: { kodeGT: { not: null } }, select: { kodeGT: true, namaGT: true }, take: 5 });
  console.log("Sample:", sample);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
