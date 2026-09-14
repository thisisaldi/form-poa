/**
 * One-time backfill: Outlet.kodeGT from MSSQL Struktur_Marketing_PI's
 * KD_GT/NM_GT columns (Divisi 'KAM1', latest Periode) — 2026-09-14, user
 * request ("kode GT nya tolong populate juga ke db, ambil dari data struktur
 * marketing pi").
 *
 * This is a DIFFERENT source than what outletSync.ts (Nexus, only resolves
 * kodeGT for Field Force nips, mostly null) or importStrukturVerifiedKAM.ts
 * (Excel export of Struktur_Marketing_PI that just never included a GT-code
 * column) currently populate Outlet.kodeGT from. The RAW MSSQL table itself
 * has always had KD_GT — confirmed 2026-09-14: at Periode 202609/Divisi
 * KAM1, 298 distinct (KD_GT, NM_GT) pairs, ZERO collisions either direction
 * (1 code = 1 name always). Matched against Outlet.namaGT via
 * normalizeGTName (same matching used everywhere else in this table's
 * territory-name reconciliation) — 274/578 distinct Outlet namaGT values
 * matched (rest are GTs not in KAM1's current active set — inactive/other
 * divisions/stale spellings, left untouched).
 *
 * Doing this at the Outlet level (not just TargetHospitalValue directly)
 * matters for persistence: importTargetHospitalValue.ts's canonicalizeGT
 * reads kodeGT FROM Outlet at import time — patching TargetHospitalValue
 * alone would get silently wiped back to null on the next monthly
 * re-import. Run scripts/cleanTargetHospitalValueGT.ts right after this to
 * propagate the now-improved Outlet.kodeGT into the already-imported
 * TargetHospitalValue rows.
 *
 * Run: npx tsx scripts/backfillOutletKodeGTFromStrukturMarketingPI.ts
 */

import "dotenv/config";
import sql from "mssql";
import { prisma } from "../src/lib/prisma";
import { normalizeGTName } from "../src/lib/targetHospitalValue";

const PERIODE = 202609;
const DIVISI = "KAM1";

async function main() {
  const cs = process.env.MSSQL_CONNECTION_STRING;
  if (!cs) { console.error("MSSQL_CONNECTION_STRING not set"); process.exit(1); }
  const csMap: Record<string, string> = {};
  for (const part of cs.split(";").filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) csMap[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }

  console.log(`Connecting to MSSQL, reading Struktur_Marketing_PI (Periode=${PERIODE}, Divisi=${DIVISI})...`);
  const pool = await sql.connect({
    server: csMap["server"] ?? "",
    database: csMap["database"] ?? "mkt_insight",
    user: csMap["user id"] ?? csMap["user"] ?? "",
    password: csMap["password"] ?? "",
    requestTimeout: 60000,
    options: {
      encrypt: csMap["encrypt"]?.toLowerCase() !== "false",
      trustServerCertificate: csMap["trustservercertificate"]?.toLowerCase() === "true",
    },
  });

  let recordset: { KD_GT: string; NM_GT: string }[];
  try {
    ({ recordset } = await pool.request().query<{ KD_GT: string; NM_GT: string }>(`
      SELECT DISTINCT KD_GT, NM_GT FROM Struktur_Marketing_PI
      WHERE Periode = ${PERIODE} AND Divisi = '${DIVISI}' AND KD_GT IS NOT NULL AND NM_GT IS NOT NULL
    `));
  } finally {
    await pool.close();
  }
  console.log(`Fetched ${recordset.length} distinct (KD_GT, NM_GT) rows from MSSQL.`);

  const kodeByNorm = new Map<string, string>();
  for (const r of recordset) {
    const n = normalizeGTName(r.NM_GT.trim());
    if (!kodeByNorm.has(n)) kodeByNorm.set(n, r.KD_GT.trim());
  }

  const outletGTs = await prisma.outlet.findMany({ where: { namaGT: { not: null } }, select: { namaGT: true }, distinct: ["namaGT"] });
  let matched = 0, updatedRows = 0;
  for (const o of outletGTs) {
    if (!o.namaGT) continue;
    const kode = kodeByNorm.get(normalizeGTName(o.namaGT));
    if (!kode) continue;
    matched++;
    const res = await prisma.outlet.updateMany({ where: { namaGT: o.namaGT }, data: { kodeGT: kode } });
    updatedRows += res.count;
  }

  console.log(`\n✅ ${matched}/${outletGTs.length} distinct namaGT matched — updated ${updatedRows} Outlet rows.`);
  console.log(`   Next: rerun scripts/cleanTargetHospitalValueGT.ts to propagate into TargetHospitalValue.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
