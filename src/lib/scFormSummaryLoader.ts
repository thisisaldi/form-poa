import { prisma } from "@/lib/prisma";
import { getLiveProductPricing } from "@/lib/exodusApi";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { getSalesCounterProduct } from "@/app/(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScCashbackPoaStrict } from "@/app/(app)/sc/[id]/_services/getScCashbackPoa";
import {
  postHistorySalesStrict,
  type PostHistorySalesResponse,
} from "@/app/(app)/sc/[id]/_services/postHistorySales";
import { parseScHistorySales, scHistoryCodeSet, scProCodes, type ScSummaryInputs } from "@/lib/scFormSummary";

/**
 * Server-side fetching for computeScFormSummary. Every function here throws
 * when an external API genuinely fails (as opposed to "not found / no data"),
 * so callers can leave summaryVersion null instead of freezing wrong numbers.
 */

/** Names the failing source in the error, so a log line says which API timed out. */
async function named<T>(source: string, call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    throw new Error(`${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** B-3 months used for history sales of a form period, e.g. "2026-Q4" → [202609, 202608, 202607]. */
export function historyPeriodsFor(period: string): number[] {
  return getB3RollingPeriodInfo(period).targetPeriods;
}

/**
 * HNA per kodeProduk the way the editor resolves it: Exodus sell_price
 * (getLiveProductPricing, 5-min cache), else Product.hna. Exodus being down
 * is not an error — the editor falls back to the DB the same way.
 */
export async function loadHnaAndKonversi(productCodes: string[]): Promise<{
  hnaByKode: Map<string, number>;
  konversiByKode: Map<string, number | null>;
}> {
  const codes = Array.from(new Set(productCodes.filter(Boolean)));
  const [live, rows] = await Promise.all([
    getLiveProductPricing(),
    codes.length > 0
      ? (prisma.product.findMany({
          where: { kodeProduk: { in: codes } },
          select: { kodeProduk: true, hna: true, konversiPembagi: true },
        }) as Promise<{ kodeProduk: string; hna: { toString(): string }; konversiPembagi: { toString(): string } | null }[]>)
      : Promise.resolve([]),
  ]);

  const hnaByKode = new Map<string, number>();
  const konversiByKode = new Map<string, number | null>();
  for (const r of rows) {
    hnaByKode.set(r.kodeProduk, Number(r.hna.toString()) || 0);
    konversiByKode.set(r.kodeProduk, r.konversiPembagi != null ? Number(r.konversiPembagi.toString()) : null);
  }
  if (live) {
    for (const code of codes) {
      const p = live.get(code);
      if (p) hnaByKode.set(code, p.hna);
    }
  }
  return { hnaByKode, konversiByKode };
}

/** One post-history-sales call (agg) for many outlets sharing the same B-3 months. */
export async function loadHistoryBatch(kodePIs: string[], periods: number[]): Promise<PostHistorySalesResponse | null> {
  const codes = Array.from(new Set(kodePIs.filter(Boolean)));
  if (codes.length === 0) return null;
  return postHistorySalesStrict({ piCodes: codes, period: periods, agg: true });
}

/**
 * Everything computeScFormSummary needs for one outlet. Pass `historyResponse`
 * (from loadHistoryBatch with historyPeriodsFor(period)) to reuse a batched
 * history call; otherwise this outlet's history is fetched on its own.
 */
export async function loadScSummaryInputs({
  kodePI,
  period,
  productCodes,
  historyResponse,
}: {
  kodePI: string;
  period: string;
  productCodes: string[];
  historyResponse?: PostHistorySalesResponse | null;
}): Promise<ScSummaryInputs> {
  const b3 = getB3RollingPeriodInfo(period);
  const [scRes, cashbackData, pricing, history] = await Promise.all([
    getSalesCounterProduct(kodePI, period),
    named("get-cashback-poa", getScCashbackPoaStrict(kodePI)),
    named("product pricing", loadHnaAndKonversi(productCodes)),
    historyResponse !== undefined
      ? Promise.resolve(historyResponse)
      : named("post-history-sales", postHistorySalesStrict({ piCodes: [kodePI], period: b3.targetPeriods, agg: true })),
  ]);

  // getSalesCounterProduct only returns null when every attempt failed.
  if (!scRes) throw new Error(`get-sales-counter-product failed for ${kodePI}`);
  const scProducts = Array.isArray(scRes.data) ? scRes.data : [];

  return {
    scProducts,
    scProductPeriod: scRes.resolvedPeriod ?? String(b3.period),
    hnaByKode: pricing.hnaByKode,
    konversiByKode: pricing.konversiByKode,
    cashbackData,
    history: parseScHistorySales(history, kodePI, scHistoryCodeSet(scProCodes(scProducts))),
    historyPeriodEnd: b3.period,
  };
}
