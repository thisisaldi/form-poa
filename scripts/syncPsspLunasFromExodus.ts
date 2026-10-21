/**
 * Manual trigger for the PsspKontrak ← Exodus sync — see
 * src/lib/sync/psspLunasSync.ts. Also runs daily in-process
 * (src/lib/sync/jobs.ts); this is for a dry run or a catch-up right after
 * importPsspKontrak.ts.
 *
 * Run: npx tsx scripts/syncPsspLunasFromExodus.ts           (dry run)
 *      npx tsx scripts/syncPsspLunasFromExodus.ts --apply   (write)
 */
import "dotenv/config";
import { runPsspLunasSync } from "../src/lib/sync/psspLunasSync";

const apply = process.argv.includes("--apply");
runPsspLunasSync({ apply, onProgress: (stage, d, t) => process.stdout.write(`\r${stage} ${d}/${t}   `) })
  .then((r) => {
    console.log(`\n${JSON.stringify(r, null, 2)}`);
    console.log(apply ? "written" : "dry run — pass --apply to write");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nSync failed:", err);
    process.exit(1);
  });
