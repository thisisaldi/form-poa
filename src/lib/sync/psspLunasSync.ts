/**
 * Rebuilds PsspKontrak from Exodus for every PSSP contract Exodus knows
 * (docs/pssp-live/01-business-rules.md §5b, decisions D1–D3, user 2026-10-20):
 * per product per month estimate (monthly_estimated_value) and settlement
 * (settlement_value), uncapped, including products that were never estimated.
 * Contracts Exodus doesn't return keep their Excel rows (importPsspKontrak.ts).
 *
 * 1. List every settlement visible to EXODUS_PSSP_LIST_NIP (only way to get pssp_id).
 * 2. Per "P…" contract: /settlements/details → one row per product.
 * 3. Replace that contract's rows (upsert per product, delete products Exodus
 *    no longer lists). Fields Exodus doesn't have (nmSpc, nipUsul, …) are kept.
 *
 * Runs daily via src/lib/sync/jobs.ts (~30-45 min, mostly the listing's deep
 * pages). Manual / dry run: scripts/syncPsspLunasFromExodus.ts.
 */
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  getAccessToken, listExodusPsspSettlements, getExodusPsspSettlementDetails,
  type ExodusPsspSettlementDetailRow,
} from "@/lib/exodusApi";

const DETAIL_CONCURRENCY = 5;
const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "Jun 2026" → "202606"; null if unrecognised. */
export function periodeToYm(periode: string): string | null {
  const m = periode.trim().match(/^([A-Za-z]{3})\w*\s+(\d{4})$/);
  const mm = m && MONTHS[m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  return mm ? `${m![2]}${mm}` : null;
}

const isoToYm = (iso: string) => iso.slice(0, 7).replace("-", "");
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface KontrakProductRow {
  kdProduk: string;
  nmProduk: string;
  estByPeriod: Record<string, number>;
  lunasByPeriod: Record<string, number>;
  estBaris: number;
  totalLunas: number;
}

/** Groups /settlements/details rows (one per product per month) into one row per product. */
export function detailsToProductRows(details: ExodusPsspSettlementDetailRow[]): KontrakProductRow[] {
  const byCode = new Map<string, KontrakProductRow>();
  for (const d of details) {
    const ym = periodeToYm(d.periode);
    if (!d.product_code || !ym) continue;
    const row = byCode.get(d.product_code) ?? { kdProduk: d.product_code, nmProduk: d.product_name, estByPeriod: {}, lunasByPeriod: {}, estBaris: 0, totalLunas: 0 };
    const est = Number(d.monthly_estimated_value) || 0;
    const lunas = Number(d.settlement_value) || 0;
    row.estByPeriod[ym] = round2((row.estByPeriod[ym] ?? 0) + est);
    row.lunasByPeriod[ym] = round2((row.lunasByPeriod[ym] ?? 0) + lunas);
    row.estBaris = round2(row.estBaris + est);
    row.totalLunas = round2(row.totalLunas + lunas);
    byCode.set(d.product_code, row);
  }
  // A product listed with neither estimate nor settlement carries no information.
  return [...byCode.values()].filter((r) => r.estBaris > 0 || r.totalLunas > 0);
}

export async function runPsspLunasSync({ apply, onProgress }: { apply: boolean; onProgress?: (stage: string, done: number, total: number) => void }) {
  if (!(await getAccessToken())) throw new Error("Exodus auth failed or EXODUS_* not configured");

  const listing = await listExodusPsspSettlements(env.EXODUS_PSSP_LIST_NIP, { onPage: (d, t) => onProgress?.("listing", d, t) });
  if (!listing) throw new Error(`Exodus settlements listing failed for nip ${env.EXODUS_PSSP_LIST_NIP}`);
  const contracts = [...new Map(listing.rows.filter((r) => r.pssp_number?.startsWith("P")).map((r) => [r.pssp_number, r])).values()];

  // Σ per existing contract, to report what changed (one grouped query, not one per contract).
  const before = new Map(
    ((await prisma.psspKontrak.groupBy({ by: ["cUrut"], _sum: { estBaris: true, totalLunas: true } })) as { cUrut: string; _sum: { estBaris: unknown; totalLunas: unknown } }[])
      .map((g) => [g.cUrut, { est: Number(g._sum.estBaris ?? 0), lunas: Number(g._sum.totalLunas ?? 0) }]),
  );

  const stats = { listedSettlements: listing.rows.length, failedPages: listing.failedPages.length, psspContracts: contracts.length, written: 0, newContracts: 0, changedContracts: 0, productRows: 0, failedDetails: 0, emptyContracts: 0 };
  const now = new Date();
  const queue = [...contracts];
  let done = 0;

  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const details = await getExodusPsspSettlementDetails(c.pssp_id);
      onProgress?.("details", ++done, contracts.length);
      if (!details) { stats.failedDetails++; continue; }
      const products = detailsToProductRows(details);
      if (products.length === 0) { stats.emptyContracts++; continue; }

      const cUrut = c.pssp_number.slice(1); // PsspKontrak.cUrut drops Exodus' leading "P"
      const old = before.get(cUrut);
      const est = products.reduce((s, p) => s + p.estBaris, 0);
      const lunas = products.reduce((s, p) => s + p.totalLunas, 0);
      if (!old) stats.newContracts++;
      else if (Math.abs(old.est - est) >= 1 || Math.abs(old.lunas - lunas) >= 1) stats.changedContracts++;
      stats.productRows += products.length;
      stats.written++;
      if (!apply) continue;

      const contractFields = {
        kdCust: c.customer_code, nmCust: c.customer_name,
        kdOutlet: c.outlet_code || null, nmOutlet: c.outlet_name || null,
        prdAwal: isoToYm(c.start_date), prdAkhir: isoToYm(c.end_date),
        biaya: Number(details[0]?.pssp_total_value) || 0,
      };
      await prisma.$transaction([
        prisma.psspKontrak.deleteMany({ where: { cUrut, kdProduk: { notIn: products.map((p) => p.kdProduk) } } }),
        ...products.map((p) => {
          const data = {
            ...contractFields, nmProduk: p.nmProduk,
            estBaris: p.estBaris, totalEst: p.estBaris, totalLunas: p.totalLunas,
            estByPeriod: p.estByPeriod, lunasByPeriod: p.lunasByPeriod, lunasSyncedAt: now,
          };
          return prisma.psspKontrak.upsert({
            where: { cUrut_kdProduk: { cUrut, kdProduk: p.kdProduk } },
            create: { cUrut, kdProduk: p.kdProduk, ...data },
            update: data,
          });
        }),
      ]);
    }
  }));

  return stats;
}
