/**
 * Overwrite PsspKontrak.totalLunas with Exodus's settlement percentage for
 * every contract Exodus also knows about (user decision 2026-10-20: Exodus is
 * the up-to-date source; contracts Exodus doesn't return keep their Excel value).
 * Writing the column (rather than overlaying live) keeps every reader — POA
 * panel, exports, summary — on the same numbers; settlements takes 12-20s per
 * nip, too slow to call on a render path. Split rule: applySettlementPct.
 *
 * Runs daily via psspLunasScheduler.ts, so a fresh importPsspKontrak.ts
 * (which rewrites totalLunas from Excel) is corrected by the next night.
 * Manual: scripts/syncPsspLunasFromExodus.ts.
 */
import { prisma } from "@/lib/prisma";
import { getExodusPsspSettlementPctByNip, applySettlementPct } from "@/lib/exodusApi";

const CONCURRENCY = 5;

export async function runPsspLunasSync({ apply, onProgress }: { apply: boolean; onProgress?: (done: number, total: number) => void }) {
  const nips = (await prisma.psspKontrak.findMany({ where: { nipUsul: { not: null } }, select: { nipUsul: true }, distinct: ["nipUsul"] }))
    .map((r: { nipUsul: string | null }) => r.nipUsul!);

  const pctByCUrut = new Map<string, number>();
  let failedNips = 0;
  for (let i = 0; i < nips.length; i += CONCURRENCY) {
    const maps = await Promise.all(nips.slice(i, i + CONCURRENCY).map(getExodusPsspSettlementPctByNip));
    for (const m of maps) {
      if (!m) { failedNips++; continue; } // 500 "user projects not found" for MRs Exodus no longer has
      for (const [k, v] of m) pctByCUrut.set(k, v);
    }
    onProgress?.(Math.min(i + CONCURRENCY, nips.length), nips.length);
  }

  const rows: { id: string; cUrut: string; estBaris: number; totalLunas: number }[] = (await prisma.psspKontrak.findMany({
    where: { cUrut: { in: [...pctByCUrut.keys()] } },
    select: { id: true, cUrut: true, estBaris: true, totalLunas: true },
  })).map((r: { id: string; cUrut: string; estBaris: { toString(): string } | null; totalLunas: { toString(): string } | null }) => ({
    id: r.id, cUrut: r.cUrut, estBaris: Number(r.estBaris ?? 0), totalLunas: Number(r.totalLunas ?? 0),
  }));

  const changes = applySettlementPct(rows, pctByCUrut).filter((u, i) => Math.abs(u.totalLunas - rows[i].totalLunas) >= 1);
  if (apply) {
    for (let i = 0; i < changes.length; i += 500) {
      await prisma.$transaction(changes.slice(i, i + 500).map((u) => prisma.psspKontrak.update({ where: { id: u.id }, data: { totalLunas: u.totalLunas } })));
    }
  }

  return {
    nips: nips.length,
    failedNips,
    exodusContracts: pctByCUrut.size,
    matchedContracts: new Set(rows.map((r) => r.cUrut)).size,
    changedContracts: new Set(changes.map((c) => c.cUrut)).size,
    changedRows: changes.length,
  };
}
