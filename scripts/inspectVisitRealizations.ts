/** Read-only check of kpiCallActivitySync's query + scoring. Run: npx tsx scripts/inspectVisitRealizations.ts */
import "dotenv/config";
import assert from "node:assert";
import { queryDailyAvgsByNip } from "../src/lib/sync/kpiCallActivitySync";
import { callActivityRealisasiFromDailyAvgs, CALL_ACTIVITY_STANDARD_BY_ROLE } from "../src/lib/kpiScoring";

assert.deepStrictEqual(CALL_ACTIVITY_STANDARD_BY_ROLE, { MR: 10, ASM: 5, SM: 3 });
assert.strictEqual(callActivityRealisasiFromDailyAvgs("MR", 7.5, 2.7), 6.7); // surplus in window 1 can't offset window 2
assert.strictEqual(callActivityRealisasiFromDailyAvgs("MR", 9, 9), 10);
assert.strictEqual(callActivityRealisasiFromDailyAvgs("SM", 1.3, 2.2), 3);
assert.strictEqual(callActivityRealisasiFromDailyAvgs("NSM", 1, 1), null);

async function main() {
  const m = await queryDailyAvgsByNip("2026-08", ["P250305", "P080841", "L240080"]);
  console.log(m);
  for (const [nip, a] of m) console.log(nip, callActivityRealisasiFromDailyAvgs("MR", a.avgDay, a.avgOff), "/ 10");
}
main().catch((e) => { console.error(e.message); process.exit(1); }).then(() => process.exit(0));
