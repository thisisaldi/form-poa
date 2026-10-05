/** Smallest check for nonHospitalScoring.ts vs the prototype's sample numbers. Run: npx tsx scripts/checkNonHospitalScoring.ts */
import assert from "node:assert";
import { average, buildIndicators, visitAchievement, windowMonths } from "../src/lib/nonHospitalScoring";

const salesAch = [0.7413, 0.9444, 0.8197, 0.9823, 0.7827, 0.7953];
const visit = [213, 245, 204, 247, 214, 228], days = [21, 21, 20, 21, 22, 20];
assert.strictEqual(Math.round(average(salesAch)! * 1000) / 10, 84.4);
const kunj = visit.map((v, i) => visitAchievement(v, days[i]));
assert.strictEqual(Math.round(average(kunj)! * 1000) / 10, 90.1);
const ind = buildIndicators({ salesAch, kunjunganAch: kunj, sc: [5, 11], telat: [3, 4, 2, 5, 6, 0] });
assert.strictEqual(ind[0].nilai, 55); // 84.4% -> 55
assert.strictEqual(ind[1].nilai, 85); // 90.1% -> 85
assert.strictEqual(ind[2].real, 8);
assert.strictEqual(Math.round(ind[3].real! * 100) / 100, 3.33);
// contract ends 2026-10-01 -> window Mar..Aug 2026
assert.deepStrictEqual(windowMonths(new Date("2025-01-02"), new Date("2026-10-01")), ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
// short contract: never before its start month
assert.deepStrictEqual(windowMonths(new Date("2026-06-02"), new Date("2026-10-01")), ["2026-06", "2026-07", "2026-08"]);
console.log("ok");
