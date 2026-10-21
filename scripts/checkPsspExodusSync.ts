/** Self-check for the Exodus â†’ PsspKontrak row mapping. Run: npx tsx scripts/checkPsspExodusSync.ts */
import assert from "node:assert";
import { periodeToYm, detailsToProductRows } from "../src/lib/sync/psspLunasSync";

assert.strictEqual(periodeToYm("Jun 2026"), "202606");
assert.strictEqual(periodeToYm("Dec 2025"), "202512");
assert.strictEqual(periodeToYm("garbage"), null);

const d = (product_code: string, periode: string, est: number, settle: number) => ({
  product_code, product_name: product_code, periode, monthly_estimated_value: est, settlement_value: settle, is_estimated: est > 0, pssp_total_value: 10_000_000,
});
// Shape of PCJ43624 (probe 2026-10-20): one estimated product over several months + one non-estimated product with settlement only.
const rows = detailsToProductRows([
  d("005338", "Jun 2026", 9_380_000, 11_785_300),
  d("005338", "Jul 2026", 9_380_000, 9_803_780.695),
  d("005338", "Sep 2026", 9_380_000, 0),
  d("024962", "Aug 2026", 0, 930_000),
  d("010959", "Aug 2026", 0, 0), // nothing â†’ dropped
]);
assert.deepStrictEqual(rows.map((r) => r.kdProduk), ["005338", "024962"]);
assert.strictEqual(rows[0].estBaris, 28_140_000);
assert.strictEqual(rows[0].totalLunas, 21_589_080.7); // uncapped (D1)
assert.deepStrictEqual(rows[0].lunasByPeriod, { "202606": 11_785_300, "202607": 9_803_780.7, "202609": 0 });
assert.strictEqual(rows[1].estBaris, 0); // non-estimated product kept (D2)
assert.strictEqual(rows[1].totalLunas, 930_000);
console.log("pssp exodus mapping ok");
