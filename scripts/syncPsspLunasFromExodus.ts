/**
 * Manual trigger for the PsspKontrak.totalLunas ← Exodus settlements sync —
 * see src/lib/sync/psspLunasSync.ts. Also runs daily in-process
 * (psspLunasScheduler.ts); this is for a dry run or a catch-up right after
 * importPsspKontrak.ts.
 *
 * Run: npx tsx scripts/syncPsspLunasFromExodus.ts           (dry run)
 *      npx tsx scripts/syncPsspLunasFromExodus.ts --apply   (write)
 */
import "dotenv/config";
import { runPsspLunasSync } from "../src/lib/sync/psspLunasSync";

const apply = process.argv.includes("--apply");
runPsspLunasSync({ apply, onProgress: (d, t) => process.stdout.write(`\rnip ${d}/${t}`) })
  .then((r) => {
    console.log(`\n${r.nips - r.failedNips}/${r.nips} nips answered, ${r.exodusContracts} PSSP contracts from Exodus`);
    console.log(`${r.matchedContracts} contracts matched in PsspKontrak, ${r.changedContracts} changed, ${r.changedRows} rows ${apply ? "updated" : "to update — dry run, pass --apply to write"}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
