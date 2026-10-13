/**
 * Backfill for docs/sc-form-summary/ (2026-10-13): fills the summary columns
 * of PoaScForm / PoaScProductItem for forms saved before the summary existed,
 * and for forms whose summary could not be computed at save time (Canvasser
 * down → summaryVersion stays null).
 *
 * The numbers come from Canvasser/Exodus as they are when this runs, not as
 * they were when the MR saved — for old forms that is the best available.
 *
 * Resumable: without --force only forms with summaryVersion null or older than
 * SUMMARY_VERSION are processed, so a second run picks up where the first
 * stopped (and retries the ones that failed).
 *
 * Run: npm run backfill:sc-summary -- [flags]
 *   --dry-run          compute only, write nothing; results go to a CSV
 *   --out=<path>       CSV path for --dry-run (default: OS temp dir)
 *   --force            also recompute forms that already have a summary
 *   --period=2026-Q4   only this period
 *   --form-id=<id>     only this form
 *   --outlet=<kodePI>  only forms of this outlet (all its periods, unless --period is given)
 *   --concurrency=5    outlets fetched from Canvasser at a time
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { SUMMARY_VERSION } from "../src/lib/scFormSummary";
import { refreshScFormSummaries, type ScSummaryOutcome } from "../src/lib/scFormSummaryStore";

const BATCH_SIZE = 50;

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
}

const CSV_COLUMNS = [
  "formId",
  "kodePI",
  "period",
  "status",
  "sumEstimasiSales",
  "sumNilaiSc",
  "sumDiskon",
  "sumCashback",
  "sumEntertain",
  "sumBudgetSc",
  "tercacahEstimasiSales",
  "tercacahNilaiSc",
  "historySalesQuarter",
  "historyPeriodEnd",
  "totalScProducts",
  "countIntensifikasi",
  "countEkstensifikasi",
  "countPenurunan",
  "countTetap",
  "error",
] as const;

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const dryRun = flag("dry-run") !== undefined;
  const force = flag("force") !== undefined;
  const period = flag("period");
  const formId = flag("form-id");
  const outlet = flag("outlet");
  const concurrency = Math.max(1, Number(flag("concurrency")) || 5);

  const where: Record<string, unknown> = {};
  if (formId) where.id = formId;
  if (period) where.period = period;
  if (outlet) where.kodePI = outlet;
  if (!force) where.OR = [{ summaryVersion: null }, { summaryVersion: { lt: SUMMARY_VERSION } }];

  const forms: { id: string; status: string }[] = await prisma.poaScForm.findMany({
    where,
    select: { id: true, status: true },
    orderBy: [{ period: "asc" }, { id: "asc" }],
  });
  const statusById = new Map(forms.map((f) => [f.id, f.status]));

  console.log(
    `${dryRun ? "[dry-run] " : ""}${forms.length} form(s) to process` +
      `${period ? `, period ${period}` : ""}${formId ? `, form ${formId}` : ""}${outlet ? `, outlet ${outlet}` : ""}${force ? ", --force" : ""}, concurrency ${concurrency}`
  );

  const csvRows: string[] = [CSV_COLUMNS.join(",")];
  const onForm = (o: ScSummaryOutcome) => {
    if (!dryRun) return;
    const values: Record<string, unknown> = o.ok ? { ...o.result.summary } : { error: o.error };
    values.formId = o.id;
    values.kodePI = o.kodePI;
    values.period = o.period;
    values.status = statusById.get(o.id);
    csvRows.push(CSV_COLUMNS.map((c) => csvCell(values[c])).join(","));
  };

  const started = Date.now();
  let computed = 0;
  let failed = 0;
  for (let i = 0; i < forms.length; i += BATCH_SIZE) {
    const ids = forms.slice(i, i + BATCH_SIZE).map((f) => f.id);
    const stats = await refreshScFormSummaries(ids, { write: !dryRun, concurrency, onForm });
    computed += stats.computed;
    failed += stats.failed;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ${Math.min(i + BATCH_SIZE, forms.length)}/${forms.length}  computed ${computed}, failed ${failed}  (${seconds}s)`);
  }

  if (dryRun) {
    const out = flag("out") || join(tmpdir(), `sc-summary-dry-run-${Date.now()}.csv`);
    writeFileSync(out, csvRows.join("\n") + "\n", "utf8");
    console.log(`Dry run: nothing written to the database. Results: ${out}`);
  } else {
    const remaining = await prisma.poaScForm.count({
      where: { OR: [{ summaryVersion: null }, { summaryVersion: { lt: SUMMARY_VERSION } }] },
    });
    console.log(`Done. Forms still without a current summary (all periods): ${remaining}`);
  }
  if (failed > 0) console.log(`${failed} form(s) failed — see the errors above, then re-run to retry them.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
