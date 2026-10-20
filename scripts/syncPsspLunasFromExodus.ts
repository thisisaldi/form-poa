/**
 * Overwrite PsspKontrak.totalLunas with Exodus's settlement percentage for
 * every contract Exodus also knows about (user decision 2026-10-20: Exodus is
 * the up-to-date source; contracts Exodus doesn't return keep their Excel value).
 *
 * getPsspHistory already applies this live for the POA panel; this script
 * persists it so the company-wide readers (exports, summary) that query
 * PsspKontrak directly see the same numbers. Same split rule:
 * applySettlementPct in src/lib/exodusApi.ts.
 *
 * importPsspKontrak.ts rewrites totalLunas from Excel — rerun this after it.
 *
 * Run: npx tsx scripts/syncPsspLunasFromExodus.ts           (dry run)
 *      npx tsx scripts/syncPsspLunasFromExodus.ts --apply   (write)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getExodusPsspSettlementPctByNip, applySettlementPct } from "../src/lib/exodusApi";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const CONCURRENCY = 5;

async function main() {
  const nips = (await prisma.psspKontrak.findMany({ where: { nipUsul: { not: null } }, select: { nipUsul: true }, distinct: ["nipUsul"] }))
    .map((r) => r.nipUsul!);

  const pctByCUrut = new Map<string, number>();
  let failedNips = 0;
  for (let i = 0; i < nips.length; i += CONCURRENCY) {
    const maps = await Promise.all(nips.slice(i, i + CONCURRENCY).map(getExodusPsspSettlementPctByNip));
    for (const m of maps) {
      if (!m) { failedNips++; continue; } // 500 "user projects not found" for MRs Exodus no longer has
      for (const [k, v] of m) pctByCUrut.set(k, v);
    }
    process.stdout.write(`\rnip ${Math.min(i + CONCURRENCY, nips.length)}/${nips.length}`);
  }
  console.log(`\n${nips.length - failedNips}/${nips.length} nips answered, ${pctByCUrut.size} PSSP contracts from Exodus`);

  const rows = (await prisma.psspKontrak.findMany({
    where: { cUrut: { in: [...pctByCUrut.keys()] } },
    select: { id: true, cUrut: true, estBaris: true, totalLunas: true },
  })).map((r) => ({ id: r.id, cUrut: r.cUrut, estBaris: Number(r.estBaris ?? 0), totalLunas: Number(r.totalLunas ?? 0) }));

  const updated = applySettlementPct(rows, pctByCUrut);
  const changes = updated.filter((u, i) => Math.abs(u.totalLunas - rows[i].totalLunas) >= 1);
  console.log(`${new Set(rows.map((r) => r.cUrut)).size} contracts matched in PsspKontrak, ${new Set(changes.map((c) => c.cUrut)).size} changed, ${changes.length} rows to update`);

  if (!apply) return console.log("dry run — pass --apply to write");
  for (let i = 0; i < changes.length; i += 500) {
    await prisma.$transaction(changes.slice(i, i + 500).map((u) => prisma.psspKontrak.update({ where: { id: u.id }, data: { totalLunas: u.totalLunas } })));
  }
  console.log(`updated ${changes.length} rows`);
}

main().finally(() => prisma.$disconnect());
