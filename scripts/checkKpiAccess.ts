/** Self-check: KPI Personil is ADMIN-only. Run: npx tsx scripts/checkKpiAccess.ts */
import assert from "node:assert";
import { canUseKpiPersonil } from "../src/lib/kpiAccess";

assert.strictEqual(canUseKpiPersonil("ADMIN"), true);
for (const r of ["MR", "ASM", "SM", "NSM", "SD", "GM", "SFE", "VIEWER", "SALES_SUPPORT", "", undefined, null]) {
  assert.strictEqual(canUseKpiPersonil(r as string | undefined | null), false, String(r));
}
console.log("kpi access ok");
