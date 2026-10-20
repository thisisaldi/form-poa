/** Self-check for applySettlementPct. Run: npx tsx scripts/checkApplySettlementPct.ts [nip] */
import "dotenv/config";
import assert from "node:assert";
import { applySettlementPct, getExodusPsspSettlementPctByNip } from "../src/lib/exodusApi";

const rows = [
  { cUrut: "A", estBaris: 100, totalLunas: 30 }, { cUrut: "A", estBaris: 100, totalLunas: 10 }, // proportional to old lunas
  { cUrut: "B", estBaris: 50, totalLunas: 0 }, { cUrut: "B", estBaris: 150, totalLunas: 0 },    // no lunas yet → by estBaris
  { cUrut: "C", estBaris: 10, totalLunas: 5 },                                                   // not in Exodus → unchanged
];
assert.deepStrictEqual(applySettlementPct(rows, new Map([["A", 80], ["B", 50]])).map((r) => r.totalLunas), [120, 40, 25, 75, 5]);
console.log("applySettlementPct ok");

const nip = process.argv[2];
if (nip) (async () => {
  const t = Date.now();
  const m = await getExodusPsspSettlementPctByNip(nip);
  console.log(`settlements ${nip}: ${m?.size ?? "null"} contracts in ${Date.now() - t} ms`);
})();
