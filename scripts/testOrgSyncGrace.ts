/**
 * Self-check for the org-sync deactivate grace window (orgStructureSync.ts,
 * 2026-10-15 L260395 incident): a user missing from ONE daily Nexus run must
 * stay active; missing from two consecutive daily runs gets deactivated.
 *
 * Run: npx tsx scripts/testOrgSyncGrace.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { isWithinDeactivateGrace } from "../src/lib/sync/orgStructureSync";

const H = 60 * 60 * 1000;
const now = new Date("2026-10-16T17:00:00Z"); // daily run, 00:00 WIB
const ago = (h: number) => new Date(now.getTime() - h * H);

assert.strictEqual(isWithinDeactivateGrace(ago(24), now), true, "first missed daily run: keep");
assert.strictEqual(isWithinDeactivateGrace(ago(12), now), true, "seen in a manual mid-day sync: keep");
assert.strictEqual(isWithinDeactivateGrace(ago(48), now), false, "second consecutive missed run: deactivate");
assert.strictEqual(isWithinDeactivateGrace(null, now), false, "never synced from Nexus: no grace (old behavior)");

console.log("testOrgSyncGrace: ok");
