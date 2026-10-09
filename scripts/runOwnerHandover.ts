/**
 * Handover POA milik user nonaktif ke pemegang outlet baru (docs/poa-gt-handover/).
 * Dry-run default; --apply untuk menulis. Run: npx tsx --env-file=.env scripts/runOwnerHandover.ts [--apply]
 */
import { prisma } from "../src/lib/prisma";
import { runOwnerHandoverSync } from "../src/lib/sync/ownerHandoverSync";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY" : "DRY-RUN (tambah --apply untuk menulis)", JSON.stringify(await runOwnerHandoverSync({ dryRun: !apply }), null, 2));
}
main().finally(() => prisma.$disconnect());
