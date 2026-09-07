/**
 * Self-check for exodusApi.ts's walkZoneHierarchy — the chain-walk-by-
 * zone_type logic behind outletSync.ts's Exodus territory/subarea/area/region
 * join. Run: npx tsx scripts/testExodusZoneHierarchy.ts
 */
import assert from "node:assert";
import { walkZoneHierarchy, type ExodusZoneNode } from "../src/lib/exodusApi";

// Field Force: own zone = territory, full chain up through the unmapped "district" top rung.
const fieldForceChain: ExodusZoneNode = {
  zone_code: "22",
  zone_name: "JAKARTA TIMUR 11",
  zone_type: "territory",
  parent: [
    {
      zone_code: "5-SA",
      zone_name: "JAKARTA TIMUR 03",
      zone_type: "subarea",
      parent: [
        {
          zone_code: "5",
          zone_name: "JAKARTA TIMUR 02",
          zone_type: "area",
          parent: [
            {
              zone_code: "3",
              zone_name: "INDONESIA 06",
              zone_type: "region",
              parent: [
                { zone_code: "L250342", zone_name: "DISTRICT LUBIS MANURUNG", zone_type: "district", parent: null },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const ff = walkZoneHierarchy(fieldForceChain);
assert.deepStrictEqual(ff.territory, { code: "22", name: "JAKARTA TIMUR 11" });
assert.deepStrictEqual(ff.subarea, { code: "5-SA", name: "JAKARTA TIMUR 03" });
assert.deepStrictEqual(ff.area, { code: "5", name: "JAKARTA TIMUR 02" });
assert.deepStrictEqual(ff.region, { code: "3", name: "INDONESIA 06" });

// Supervisor acting as MR: own zone = subarea, no territory of their own.
const supervisorChain: ExodusZoneNode = {
  zone_code: "104",
  zone_name: "JAKARTA TIMUR 04",
  zone_type: "subarea",
  parent: [
    { zone_code: "157", zone_name: "JAKARTA TIMUR 02B", zone_type: "area", parent: null },
  ],
};

const spv = walkZoneHierarchy(supervisorChain);
assert.strictEqual(spv.territory, null);
assert.deepStrictEqual(spv.subarea, { code: "104", name: "JAKARTA TIMUR 04" });
assert.deepStrictEqual(spv.area, { code: "157", name: "JAKARTA TIMUR 02B" });
assert.strictEqual(spv.region, null);

// Blank/whitespace code or name must not count as resolved.
const blankNode: ExodusZoneNode = { zone_code: "  ", zone_name: "X", zone_type: "territory", parent: null };
assert.strictEqual(walkZoneHierarchy(blankNode).territory, null);

console.log("walkZoneHierarchy: all assertions passed");
