/**
 * Wires up NSM -> GM (ASD) -> SD reportsTo links, needed for resolveNextHolder
 * (poaWorkflow.ts) to find who approves at the ASD/SD level (docs/exodus-poa-usage/
 * 01-business-rules.md §11). Not part of orgStructureSync.ts's automatic
 * Nexus-based sync — GM is explicitly excluded from that (see
 * docs/org-nexus-migration/02-data-model.md: "GM/ADMIN/SFE/VIEWER role
 * users — tidak disentuh sync manapun (manual)"), and SD has no source at
 * all in Nexus/MSSQL.
 *
 * Source: MSSQL Struktur_Marketing_PI's GM_NIP/GM_Nama columns (same table
 * scripts/matchStrukturBaruFromMssql.ts already reads for GM/NSM/SM/ASM/SPV/
 * FF pairs) — the row's NSM_NIP -> GM_NIP pair says which GM that NSM
 * escalates to.
 *
 * Idempotent, safe to rerun:
 *   1. Upsert any GM in MSSQL that has no POA User row yet (role GM).
 *   2. Every active GM's nipAtasan -> SD (P200134, Brian Lembong) — single
 *      person at this level, confirmed 2026-09-09.
 *   3. Every POA NSM user whose nip EXACTLY matches an MSSQL NSM_NIP gets
 *      nipAtasan -> that row's GM_NIP. NSM users with a "dummy-looking" nip
 *      that doesn't appear in MSSQL at all (demo/mock data, e.g. "NSM240410")
 *      are left untouched — they're not real org data.
 *
 * Run: npx tsx scripts/syncGmSdHierarchy.ts
 */
import "dotenv/config";
import sql from "mssql";
import { prisma } from "../src/lib/prisma";

const SD_NIP = "P200134"; // Brian Lembong

async function main() {
  const pool = await sql.connect(process.env.MSSQL_CONNECTION_STRING!);
  // Periode filter added 2026-09-22 — table keeps multiple months' snapshots
  // (e.g. 202608 + 202609 both present); without this, an unfiltered DISTINCT
  // across periods can pick up a STALE NSM->GM pairing from an older month
  // alongside the current one (found via cross-check: 23 distinct pairs
  // unfiltered vs 22 for 202609 alone).
  const { recordset } = await pool.request().query<{ nsm_nip: string; gm_nip: string; gm_nama: string }>(`
    SELECT DISTINCT NSM_NIP nsm_nip, GM_NIP gm_nip, GM_Nama gm_nama
    FROM Struktur_Marketing_PI
    WHERE Periode = (SELECT MAX(Periode) FROM Struktur_Marketing_PI)
      AND NSM_NIP IS NOT NULL AND GM_NIP IS NOT NULL AND GM_Nama NOT LIKE '(VACANT)%'
  `);
  await pool.close();

  const gmByNip = new Map<string, string>(); // nip -> nama
  for (const r of recordset) gmByNip.set(r.gm_nip, r.gm_nama);

  // 1. Upsert missing GM users.
  let gmCreated = 0;
  for (const [nip, nama] of gmByNip) {
    const existing = await prisma.user.findUnique({ where: { nip } });
    if (existing) continue;
    await prisma.user.create({ data: { nip, name: nama, role: "GM", isActive: true } });
    gmCreated++;
    console.log(`created GM ${nip} (${nama})`);
  }

  // 2. Every active GM -> SD.
  const gmUpdate = await prisma.user.updateMany({
    where: { role: "GM", isActive: true, nip: { not: SD_NIP } },
    data: { nipAtasan: SD_NIP },
  });

  // 3. NSM -> GM, only for POA users whose nip exactly matches MSSQL NSM_NIP.
  let nsmLinked = 0;
  let nsmSkippedNoGmUser = 0;
  const errors: string[] = [];
  for (const r of recordset) {
    const nsmUser = await prisma.user.findUnique({ where: { nip: r.nsm_nip }, select: { nip: true, role: true, isActive: true } });
    if (!nsmUser || nsmUser.role !== "NSM" || !nsmUser.isActive) continue;
    const gmUser = await prisma.user.findUnique({ where: { nip: r.gm_nip } });
    if (!gmUser) {
      nsmSkippedNoGmUser++;
      errors.push(`NSM ${r.nsm_nip}: GM ${r.gm_nip} (${r.gm_nama}) not found as User even after upsert`);
      continue;
    }
    await prisma.user.update({ where: { nip: r.nsm_nip }, data: { nipAtasan: r.gm_nip } });
    nsmLinked++;
  }

  // 4. NSM VACANT di MSSQL (NSM_NIP mis. "VNN0001" — tidak ada User NSM-nya), struktur POA memakai NSM pengganti
  //    (mis. ADMINNSM) sebagai atasan SM. Tanpa langkah ini rantai owner mentok di NSM pengganti dan approve ASD/SD
  //    error (2026-10-12: 15 kasus di prod, 3 SM → NSM_NIP VNN0001 → GM 995338). Turunkan GM dari SM: NSM pengganti
  //    hanya di-link kalau SEMUA SM di bawahnya sepakat pada satu GM; kalau beda GM, dibiarkan (ambigu).
  const pool2 = await sql.connect(process.env.MSSQL_CONNECTION_STRING!);
  const { recordset: smRows } = await pool2.request().query<{ sm_nip: string; gm_nip: string }>(`
    SELECT DISTINCT SM_NIP sm_nip, GM_NIP gm_nip FROM Struktur_Marketing_PI
    WHERE Periode = (SELECT MAX(Periode) FROM Struktur_Marketing_PI)
      AND SM_NIP IS NOT NULL AND GM_NIP IS NOT NULL AND GM_Nama NOT LIKE '(VACANT)%'
  `);
  await pool2.close();
  const gmBySm = new Map<string, Set<string>>();
  for (const r of smRows) gmBySm.set(r.sm_nip, (gmBySm.get(r.sm_nip) ?? new Set()).add(r.gm_nip));
  const smUsers = await prisma.user.findMany({
    where: { role: "SM", isActive: true, nipAtasan: { not: null } },
    select: { nip: true, reportsTo: { select: { nip: true, role: true, isActive: true, nipAtasan: true } } },
  });
  const gmsByNsm = new Map<string, Set<string>>();
  for (const sm of smUsers) {
    const nsm = sm.reportsTo;
    if (!nsm || nsm.role !== "NSM" || !nsm.isActive || nsm.nipAtasan) continue; // sudah ter-link / bukan NSM
    const gms = gmBySm.get(sm.nip);
    if (!gms) continue;
    const set = gmsByNsm.get(nsm.nip) ?? new Set<string>();
    gms.forEach((g) => set.add(g));
    gmsByNsm.set(nsm.nip, set);
  }
  let vacantNsmLinked = 0;
  for (const [nsmNip, gms] of gmsByNsm) {
    if (gms.size !== 1) { errors.push(`NSM ${nsmNip}: SM-nya mengarah ke ${gms.size} GM (${[...gms].join(",")}), dilewati`); continue; }
    const gmNip = [...gms][0];
    if (!(await prisma.user.findUnique({ where: { nip: gmNip }, select: { nip: true } }))) { errors.push(`NSM ${nsmNip}: GM ${gmNip} tidak ada sebagai User`); continue; }
    await prisma.user.update({ where: { nip: nsmNip }, data: { nipAtasan: gmNip } });
    vacantNsmLinked++;
  }

  console.log({ gmCreated, gmUpdated: gmUpdate.count, nsmLinked, vacantNsmLinked, nsmSkippedNoGmUser, errors });
}
main().finally(() => prisma.$disconnect());
