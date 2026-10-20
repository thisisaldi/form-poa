/** Self-check for the scheduler clock math in src/lib/sync/jobs.ts. Run: npx tsx scripts/checkSyncJobs.ts */
import assert from "node:assert";
import { JOBS, msUntilNextWib } from "../src/lib/sync/jobs";

const at = (iso: string) => Date.parse(iso);
const H = 60 * 60 * 1000;
// 2026-10-20 10:00 WIB = 03:00Z → next 00:00 WIB is 14h away, next 08:00 WIB is 22h away.
assert.strictEqual(msUntilNextWib(0, at("2026-10-20T03:00:00Z")), 14 * H);
assert.strictEqual(msUntilNextWib(8, at("2026-10-20T03:00:00Z")), 22 * H);
// Exactly at 00:00 WIB (17:00Z) → next one is tomorrow, never 0.
assert.strictEqual(msUntilNextWib(0, at("2026-10-20T17:00:00Z")), 24 * H);
// 06:59 WIB → 08:00 WIB same day.
assert.strictEqual(msUntilNextWib(8, at("2026-10-20T23:59:00Z")), 61 * 60 * 1000);
assert.strictEqual(new Set(JOBS.map((j) => j.key)).size, JOBS.length, "job keys must be unique");
console.log("jobs ok");
process.exit(0);
