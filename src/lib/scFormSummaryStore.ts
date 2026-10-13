import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { mapWithConcurrency } from "@/lib/mapWithConcurrency";
import {
  computeScFormSummary,
  computeScGrowth,
  parseScHistorySales,
  scHistoryCodeSet,
  type ScFormSummaryResult,
  type ScSummaryForm,
} from "@/lib/scFormSummary";
import { historyPeriodsFor, loadHistoryBatch, loadScSummaryInputs } from "@/lib/scFormSummaryLoader";
import type { PostHistorySalesResponse } from "@/app/(app)/sc/[id]/_services/postHistorySales";

/**
 * Reads SC forms from the DB, computes their summary (scFormSummary.ts) and
 * writes it back to PoaScForm / PoaScProductItem. Nothing here throws: a form
 * whose external data could not be fetched keeps summaryVersion null and is
 * picked up by the backfill (docs/sc-form-summary).
 */

/** Outlets per post-history-sales call. */
const HISTORY_BATCH_SIZE = 50;
/** Outlets fetched from Canvasser (SC products + cashback) at a time. */
const OUTLET_CONCURRENCY = 5;

interface StoredScForm {
  id: string;
  version: number;
  updatedAt: Date;
  form: ScSummaryForm;
  /** PoaScProductItem ids, in the same order as form.products. */
  rowIds: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadStoredForms(formIds: string[]): Promise<StoredScForm[]> {
  const forms = await prisma.poaScForm.findMany({
    where: { id: { in: formIds } },
    select: {
      id: true,
      version: true,
      updatedAt: true,
      kodePI: true,
      period: true,
      periodeAwal: true,
      lamaPeriode: true,
      products: {
        select: {
          id: true,
          kodeProduk: true,
          periodeMonth: true,
          qtyPerBulan: true,
          persenMatriksSc: true,
          persenDiskon: true,
          persenCashback: true,
        },
      },
      persons: { select: { id: true, outletPersonId: true } },
      entertainItems: { select: { biayaEntertain: true } },
    },
  });

  return forms.map((f: any) => ({
    id: f.id,
    version: f.version,
    updatedAt: f.updatedAt,
    rowIds: f.products.map((p: any) => p.id),
    form: {
      kodePI: f.kodePI,
      period: f.period,
      periodeAwal: f.periodeAwal,
      lamaPeriode: f.lamaPeriode,
      products: f.products.map((p: any) => ({
        kodeProduk: p.kodeProduk,
        periodeMonth: p.periodeMonth,
        qtyPerBulan: p.qtyPerBulan,
        persenMatriksSc: Number(p.persenMatriksSc.toString()),
        persenDiskon: Number(p.persenDiskon.toString()),
        persenCashback: Number(p.persenCashback.toString()),
      })),
      persons: f.persons,
      entertainItems: f.entertainItems.map((e: any) => ({ biayaEntertain: Number(e.biayaEntertain.toString()) })),
    },
  }));
}

const productListIds = new Map<string, string>();

/**
 * Id of the PoaScProductList row holding the list of that month, created on
 * first use. Canvasser gives every outlet the same list for a month, so this
 * is one row per month; a differing list for the same month becomes its own
 * row instead of being mixed up with the first.
 */
async function ensureScProductList({ period, proCodes }: ScFormSummaryResult["scProductList"]): Promise<string | null> {
  if (proCodes.length === 0) return null;
  const hash = createHash("md5").update(proCodes.join(",")).digest("hex");
  const key = `${period}|${hash}`;
  const cached = productListIds.get(key);
  if (cached) return cached;

  const where = { period_hash: { period, hash } };
  let row = await prisma.poaScProductList.findUnique({ where, select: { id: true } });
  if (!row) {
    // skipDuplicates: forms computed side by side all want the same new row.
    await prisma.poaScProductList.createMany({ data: [{ period, hash, proCodes }], skipDuplicates: true });
    row = await prisma.poaScProductList.findUnique({ where, select: { id: true } });
  }
  if (!row) throw new Error(`could not store SC product list for ${period}`);
  productListIds.set(key, row.id);
  return row.id;
}

/**
 * Writes one computed summary. Skipped (returns false) when the form was saved
 * again or moved to another period since it was read, so a slow computation
 * never overwrites a newer one. updatedAt is kept: this is not an edit.
 */
async function writeSummary(stored: StoredScForm, result: ScFormSummaryResult): Promise<boolean> {
  const rows = result.products.map((p, i) => ({
    id: stored.rowIds[i],
    salesCounterValue: p.salesCounterValue,
    salesCounterMinimum: p.salesCounterMinimum,
    hnaSnapshot: p.hnaSnapshot,
    historySalesB3: p.historySalesB3,
    cashbackSnapshot: p.cashbackSnapshot,
  }));

  const scProductListId = await ensureScProductList(result.scProductList);

  return prisma.$transaction(async (tx: any) => {
    const { count } = await tx.poaScForm.updateMany({
      where: { id: stored.id, version: stored.version, period: stored.form.period },
      data: { ...result.summary, scProductListId, summaryComputedAt: new Date(), updatedAt: stored.updatedAt },
    });
    if (count === 0) return false;

    if (rows.length > 0) {
      await tx.$executeRaw`
        UPDATE "PoaScProductItem" AS p
        SET "salesCounterValue" = v."salesCounterValue",
            "salesCounterMinimum" = v."salesCounterMinimum",
            "hnaSnapshot" = v."hnaSnapshot",
            "historySalesB3" = v."historySalesB3",
            "cashbackSnapshot" = v."cashbackSnapshot"
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(
          "id" text,
          "salesCounterValue" numeric,
          "salesCounterMinimum" integer,
          "hnaSnapshot" numeric,
          "historySalesB3" numeric,
          "cashbackSnapshot" numeric
        )
        WHERE p."id" = v."id" AND p."poaScId" = ${stored.id}
      `;
    }
    return true;
  });
}

export type ScSummaryOutcome = { id: string; kodePI: string; period: string } & (
  | { ok: true; result: ScFormSummaryResult }
  | { ok: false; error: string }
);

export interface RefreshScSummaryOptions {
  /** false = compute only, write nothing (backfill --dry-run). */
  write?: boolean;
  /** Outlets fetched from Canvasser at a time. */
  concurrency?: number;
  /** Called once per form with what was computed, or why it could not be. */
  onForm?: (outcome: ScSummaryOutcome) => void;
}

/**
 * Computes and stores the summary of the given forms. History sales is fetched
 * once per 50 outlets of the same period; SC products and cashback per outlet,
 * a few at a time. Used after a save / period change and by the backfill.
 */
export async function refreshScFormSummaries(
  formIds: string[],
  { write = true, concurrency = OUTLET_CONCURRENCY, onForm }: RefreshScSummaryOptions = {}
): Promise<{ computed: number; failed: number }> {
  const stats = { computed: 0, failed: 0 };
  if (formIds.length === 0) return stats;
  const fail = (s: StoredScForm, err: unknown) => {
    stats.failed++;
    onForm?.({ id: s.id, kodePI: s.form.kodePI, period: s.form.period, ok: false, error: err instanceof Error ? err.message : String(err) });
  };

  let stored: StoredScForm[];
  try {
    stored = await loadStoredForms(formIds);
  } catch (err) {
    console.error("[scFormSummary] failed to load forms:", err);
    return { computed: 0, failed: formIds.length };
  }

  const byPeriod = new Map<string, StoredScForm[]>();
  for (const s of stored) {
    const list = byPeriod.get(s.form.period);
    if (list) list.push(s);
    else byPeriod.set(s.form.period, [s]);
  }

  for (const [period, forms] of byPeriod) {
    for (const batch of chunk(forms, HISTORY_BATCH_SIZE)) {
      let history: PostHistorySalesResponse | null;
      try {
        history = await loadHistoryBatch(batch.map((s) => s.form.kodePI), historyPeriodsFor(period));
      } catch (err) {
        console.error(`[scFormSummary] history sales failed for ${batch.length} form(s) of ${period}:`, err);
        for (const s of batch) fail(s, err);
        continue;
      }

      await mapWithConcurrency(batch, concurrency, async (s) => {
        try {
          const inputs = await loadScSummaryInputs({
            kodePI: s.form.kodePI,
            period,
            productCodes: s.form.products.map((p) => p.kodeProduk),
            historyResponse: history,
          });
          const result = computeScFormSummary(s.form, inputs);
          if (write) await writeSummary(s, result);
          stats.computed++;
          onForm?.({ id: s.id, kodePI: s.form.kodePI, period, ok: true, result });
        } catch (err) {
          console.error(`[scFormSummary] summary failed for form ${s.id} (${s.form.kodePI}):`, err);
          fail(s, err);
        }
      });
    }
  }
  return stats;
}

/**
 * Before an MR submits: forms whose stored history sales was taken from an
 * older B-3 window than today's get their history refreshed (per-product
 * history, growth category counts, form total). Everything else stays as
 * saved. Needs only post-history-sales, batched per 50 outlets — the SC
 * product list (PoaScProductList) and HNA come from what the save stored.
 * Forms without a summary are left to the backfill.
 */
export async function refreshScHistoryForSubmit(formIds: string[], ownerId: string): Promise<void> {
  if (formIds.length === 0) return;
  try {
    const forms: any[] = await prisma.poaScForm.findMany({
      where: {
        id: { in: formIds },
        ownerId,
        status: { in: ["DRAFT", "REVISI"] },
        summaryVersion: { not: null },
        scProductListId: { not: null },
      },
      select: {
        id: true,
        kodePI: true,
        period: true,
        periodeAwal: true,
        lamaPeriode: true,
        historyPeriodEnd: true,
        scProductListId: true,
      },
    });
    const stale = forms.filter((f) => f.historyPeriodEnd !== getB3RollingPeriodInfo(f.period).period);
    if (stale.length === 0) return;

    const lists: any[] = await prisma.poaScProductList.findMany({
      where: { id: { in: Array.from(new Set(stale.map((f) => f.scProductListId))) } },
      select: { id: true, proCodes: true },
    });
    const scCodesByList = new Map<string, Set<string>>(lists.map((l) => [l.id, scHistoryCodeSet(l.proCodes)]));

    const rows: any[] = await prisma.poaScProductItem.findMany({
      where: { poaScId: { in: stale.map((f) => f.id) }, salesCounterValue: { not: null } },
      select: { poaScId: true, kodeProduk: true, periodeMonth: true, qtyPerBulan: true, hnaSnapshot: true },
    });
    const rowsByForm = new Map<string, any[]>();
    for (const r of rows) {
      const list = rowsByForm.get(r.poaScId);
      if (list) list.push(r);
      else rowsByForm.set(r.poaScId, [r]);
    }

    const byPeriod = new Map<string, any[]>();
    for (const f of stale) {
      const list = byPeriod.get(f.period);
      if (list) list.push(f);
      else byPeriod.set(f.period, [f]);
    }

    const formUpdates: Record<string, unknown>[] = [];
    const rowUpdates: Record<string, unknown>[] = [];

    await Promise.all(
      Array.from(byPeriod.entries()).flatMap(([period, periodForms]) => {
        const b3 = getB3RollingPeriodInfo(period);
        return chunk(periodForms, HISTORY_BATCH_SIZE).map(async (batch) => {
          let response: PostHistorySalesResponse | null;
          try {
            response = await loadHistoryBatch(batch.map((f) => f.kodePI), b3.targetPeriods);
          } catch (err) {
            console.error(`[scFormSummary] history refresh failed for ${batch.length} form(s) of ${period}:`, err);
            return;
          }

          for (const f of batch) {
            const history = parseScHistorySales(response, f.kodePI, scCodesByList.get(f.scProductListId) ?? new Set());
            const growth = computeScGrowth(
              f,
              (rowsByForm.get(f.id) ?? []).map((r) => ({
                kodeProduk: r.kodeProduk,
                periodeMonth: r.periodeMonth,
                qtyPerBulan: r.qtyPerBulan,
                hnaSJ: r.hnaSnapshot != null ? Number(r.hnaSnapshot.toString()) : 0,
              })),
              history
            );
            formUpdates.push({ id: f.id, historySalesQuarter: history.total, historyPeriodEnd: b3.period, ...growth.counts });
            for (const [kodeProduk, historySalesB3] of growth.historyByKode) {
              rowUpdates.push({ poaScId: f.id, kodeProduk, historySalesB3 });
            }
          }
        });
      })
    );
    if (formUpdates.length === 0) return;

    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`
        UPDATE "PoaScForm" AS f
        SET "historySalesQuarter" = v."historySalesQuarter",
            "historyPeriodEnd" = v."historyPeriodEnd",
            "countIntensifikasi" = v."countIntensifikasi",
            "countEkstensifikasi" = v."countEkstensifikasi",
            "countPenurunan" = v."countPenurunan",
            "countTetap" = v."countTetap",
            "summaryComputedAt" = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(formUpdates)}::jsonb) AS v(
          "id" text,
          "historySalesQuarter" numeric,
          "historyPeriodEnd" integer,
          "countIntensifikasi" integer,
          "countEkstensifikasi" integer,
          "countPenurunan" integer,
          "countTetap" integer
        )
        WHERE f."id" = v."id"
      `;
      if (rowUpdates.length > 0) {
        await tx.$executeRaw`
          UPDATE "PoaScProductItem" AS p
          SET "historySalesB3" = v."historySalesB3"
          FROM jsonb_to_recordset(${JSON.stringify(rowUpdates)}::jsonb) AS v(
            "poaScId" text,
            "kodeProduk" text,
            "historySalesB3" numeric
          )
          WHERE p."poaScId" = v."poaScId"
            AND p."kodeProduk" = v."kodeProduk"
            AND p."salesCounterValue" IS NOT NULL
        `;
      }
    });
  } catch (err) {
    console.error("[scFormSummary] history refresh before submit failed:", err);
  }
}
