/**
 * Import TargetHospitalValue (202608, 202609) from "Target Hospital (in Value)
 * (4).xlsx", sheet "Compile Target MR" — one row per MR/SPV slot per periode,
 * cols: A MR, B NIP MR, C SPV, D NIP SPV, ..., M AREA, N PERIODE, O TARGET.
 * The sheet has NO GT column, so namaGT is resolved against the LIVE structure
 * (business owner 2026-09-21: "sesuaikan dengan gt yang struktur, sehingga
 * kalau gt itu diisi orang lain atau yang awalnya vacant jadi diisi gampang
 * ketrack"), in order:
 *   1. NIP MR / NIP SPV -> MrOutletAssignment -> Outlet.namaGT (exactly 1 GT)
 *   2. name fallback: "(VACANT) X" / "DUMMY X" / "VACANT MR X" in the MR or SPV
 *      cell, matched to a live Outlet.namaGT via normalizeGTName
 *   3. vacant MR nip "VMN<n>" -> Outlet.kodeGT n
 * Rows with a target but no live match are still imported under the sheet's
 * own name (listed in output); zero-target unmatched rows are skipped. Targets of rows
 * resolving to the same (namaGT, periode) are summed.
 *
 * Only upserts (namaGT, periode) — other periodes untouched.
 * Run: npx tsx scripts/importTargetHospitalValueCompileMR.ts [--apply] [path]
 * Default is a dry run.
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import sql from "mssql";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";
import { getCurrentGTsForMrNips, normalizeGTName } from "../src/lib/targetHospitalValue";

const apply = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "internal/Target Hospital (in Value) (4).xlsx";

const val = (c: ExcelJS.Cell) => {
  const v = c.value as unknown;
  return v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
};
const str = (c: ExcelJS.Cell) => String(val(c) ?? "").trim();
const esc = (s: string) => s.replace(/'/g, "''");

function nameCandidate(s: string): string | null {
  const m = s.match(/^\s*(?:\(VACANT\)|VACANT\s+(?:MR|SPV)|DUMMY\s+(?:MR|SPV)?)\s*(?:MR\s+|SPV\s+)?(.+)$/i);
  return m ? m[1].trim() : null;
}

// kodeGT source: MSSQL Struktur_Marketing_PI KD_GT/NM_GT (Divisi KAM1, periode 202609) —
// Outlet.kodeGT is populated for only ~64 of 578 GTs right now, see the doc
// comment on TargetHospitalValue.kodeGT in schema.prisma.
async function fetchKodeGT(): Promise<{ n: string; kode: string }[]> {
  const cs = process.env.MSSQL_CONNECTION_STRING;
  if (!cs) { console.warn("MSSQL_CONNECTION_STRING not set — kodeGT from Outlet/VMN only"); return []; }
  const m: Record<string, string> = {};
  for (const part of cs.split(";").filter(Boolean)) { const eq = part.indexOf("="); if (eq > 0) m[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim(); }
  const pool = await sql.connect({
    server: m["server"] ?? "", database: m["database"] ?? "mkt_insight", user: m["user id"] ?? m["user"] ?? "", password: m["password"] ?? "",
    requestTimeout: 60000,
    options: { encrypt: m["encrypt"]?.toLowerCase() !== "false", trustServerCertificate: m["trustservercertificate"]?.toLowerCase() === "true" },
  });
  try {
    const { recordset } = await pool.request().query<{ KD_GT: string; NM_GT: string }>(
      "SELECT DISTINCT KD_GT, NM_GT FROM Struktur_Marketing_PI WHERE Periode = 202609 AND Divisi = 'KAM1' AND KD_GT IS NOT NULL AND NM_GT IS NOT NULL");
    return recordset.map((r) => ({ n: r.NM_GT.trim(), kode: r.KD_GT.trim() }));
  } finally { await pool.close(); }
}

const STOP = new Set(["VACANT", "PROJECT", "OUTLET", "SM", "MR", "AREA", "DUMMY", "KAB", "KOTA"]);
const normTokens = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));
  const ws = wb.getWorksheet("Compile Target MR");
  if (!ws) { console.error('Sheet "Compile Target MR" not found'); process.exit(1); }

  const outlets = await prisma.outlet.findMany({ where: { namaGT: { not: null } }, select: { namaGT: true, kodeGT: true }, distinct: ["namaGT"] });
  const liveByNorm = new Map<string, { namaGT: string; kodeGT: string | null }>();
  for (const o of outlets) if (o.namaGT && !liveByNorm.has(normalizeGTName(o.namaGT))) liveByNorm.set(normalizeGTName(o.namaGT), { namaGT: o.namaGT, kodeGT: o.kodeGT });

  // "PROJECT"/"PROJECT MR" prefix is treated as the same GT (business owner 2026-09-21)
  const loose = (n: string) => normalizeGTName(n.replace(/PROJECT(\s+MR)?/gi, ""));
  const liveByLoose = new Map<string, { namaGT: string; kodeGT: string | null }>();
  for (const o of outlets) if (o.namaGT && !liveByLoose.has(loose(o.namaGT))) liveByLoose.set(loose(o.namaGT), { namaGT: o.namaGT, kodeGT: o.kodeGT });
  const findLive = (n: string) => liveByNorm.get(normalizeGTName(n)) ?? liveByLoose.get(loose(n));

  const mssql = await fetchKodeGT();
  const kodeByNorm = new Map<string, string>(), kodeByLoose = new Map<string, string>();
  for (const r of mssql) { if (!kodeByNorm.has(normalizeGTName(r.n))) kodeByNorm.set(normalizeGTName(r.n), r.kode); if (!kodeByLoose.has(loose(r.n))) kodeByLoose.set(loose(r.n), r.kode); }
  // kode confirmed 2026-09-14 in importTargetHospitalValue.ts (merged GT, Outlet not resynced)
  const KODE_OVERRIDES: Record<string, string> = {
    "MUNTILAN+MAGELANG": "2057",
    // KAM1 202608 kode 2011; merged into 2010 in 202609 but the target sheet still lists it separately
    "PADANG BARAT DAYA + PARIAMAN": "2011",
  };
  const findKode = (n: string, vmn?: string) => KODE_OVERRIDES[n.toUpperCase()] ?? kodeByNorm.get(normalizeGTName(n)) ?? kodeByLoose.get(loose(n)) ?? findLive(n)?.kodeGT ?? vmn ?? null;

  const liveByCode = new Map<string, { namaGT: string }>();
  for (const o of outlets) if (o.namaGT && o.kodeGT && !liveByCode.has(o.kodeGT)) liveByCode.set(o.kodeGT, { namaGT: o.namaGT });

  const agg = new Map<string, { namaGT: string; kodeGT: string | null; periode: string; target: number }>();
  const unresolved: string[] = [];
  const via = { nip: 0, name: 0 };
  let rows = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const periode = str(row.getCell(14));
    const target = Number(val(row.getCell(15)));
    if (!/^\d{6}$/.test(periode) || !isFinite(target)) continue;
    rows++;
    const mr = str(row.getCell(1)), nipMr = str(row.getCell(2)), spv = str(row.getCell(3)), nipSpv = str(row.getCell(4));

    let namaGT: string | null = null;
    for (const nip of [nipMr, nipSpv]) {
      if (!nip) continue;
      const gts = await getCurrentGTsForMrNips([nip], periode);
      if (gts.length === 1) { namaGT = gts[0]; via.nip++; break; }
    }
    if (!namaGT) {
      for (const cell of [mr, spv]) {
        const cand = nameCandidate(cell) ?? cell;
        const live = cand && findLive(cand);
        if (live) { namaGT = live.namaGT; via.name++; break; }
      }
    }
    if (!namaGT) {
      // 3. vacant MR slot nip "VMN<kodeGT>" carries the GT code (e.g. VMN1943 = kodeGT 1943)
      const code = nipMr.match(/^VMN(\d+)$/)?.[1];
      const live = code ? liveByCode.get(code) : undefined;
      if (live) { namaGT = live.namaGT; via.name++; }
    }
    let matched = true;
    if (!namaGT) {
      // No live match: still import (business owner 2026-09-21: "apapun yang ada
      // targetnya, buat juga") under the sheet's own name; zero targets skipped.
      matched = false;
      if (target <= 0) continue;
      const raw = nameCandidate(mr) ?? nameCandidate(spv) ?? (mr || spv);
      namaGT = raw.toUpperCase();
      const words = new Set(normTokens(raw));
      const sugg = outlets
        .filter((o) => o.namaGT)
        .map((o) => ({ n: o.namaGT as string, k: o.kodeGT, sc: normTokens(o.namaGT as string).filter((w) => words.has(w)).length }))
        .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3);
      if (!unresolved.some((u) => u.startsWith(`${namaGT} |`))) unresolved.push(`${namaGT} | ${mr} (${nipMr}) / ${spv} (${nipSpv}) | possible: ${sugg.map((x) => `${x.n} [${x.k}]`).join("; ") || "-"}`);
    }

    const kodeGT = findKode(namaGT, nipMr.match(/^VMN(\d+)$/)?.[1]);
    const key = `${namaGT}|${periode}`;
    const e = agg.get(key);
    if (e) { e.target += target; e.kodeGT ??= kodeGT; } else agg.set(key, { namaGT, kodeGT, periode, target });
  }

  const flat = [...agg.values()];
  const noKode = [...new Set(flat.filter((f) => !f.kodeGT).map((f) => f.namaGT))];
  console.log(`kodeGT filled: ${new Set(flat.filter((f) => f.kodeGT).map((f) => f.namaGT)).size} GT, still null: ${noKode.length}${noKode.length ? " -> " + noKode.join("; ") : ""}`);
  console.log(`rows=${rows} resolved via nip=${via.nip} name=${via.name} unresolved=${unresolved.length} -> ${flat.length} (GT,periode) rows`);
  for (const p of ["202608", "202609"]) console.log(p, "sum:", flat.filter((f) => f.periode === p).reduce((s, f) => s + f.target, 0));
  if (unresolved.length) console.log("NO LIVE MATCH (imported under sheet name):\n  " + unresolved.join("\n  "));

  // Rows already in the table for these periodes that this sheet does NOT produce
  // (left by earlier imports under other spellings) — listed, deleted only with --prune.
  const periodes = [...new Set(flat.map((f) => f.periode))];
  const existing = await prisma.targetHospitalValue.findMany({ where: { periode: { in: periodes } }, select: { id: true, namaGT: true, periode: true, target: true } });
  const keep = new Set(flat.map((f) => `${f.namaGT}|${f.periode}`));
  const notInSheet = existing.filter((e) => !keep.has(`${e.namaGT}|${e.periode}`));
  // Same periode + same (rounded) target or same normalized name as a row we import = old spelling of the same GT
  // (e.g. "DUMMY MEDAN PETISAH" vs "MEDAN PETISAH") -> safe duplicate. The rest are
  // orphans: kept, only reported.
  const sameTarget = new Set(flat.map((f) => `${f.periode}|${Math.round(Number(f.target))}`));
  const sameName = new Set(flat.map((f) => `${f.periode}|${normalizeGTName(f.namaGT)}`));
  const dups = notInSheet.filter((e) => sameTarget.has(`${e.periode}|${Math.round(Number(e.target))}`) || sameName.has(`${e.periode}|${normalizeGTName(e.namaGT)}`));
  const orphans = notInSheet.filter((e) => !dups.includes(e));
  console.log(`
OLD-SPELLING DUPLICATES (in DB, same periode+target as an imported row): ${dups.length}`);
  for (const e of dups) console.log(`  ${e.periode} ${e.namaGT} = ${e.target}`);
  console.log(`ORPHANS (in DB, not in this sheet, kept): ${orphans.length}`);
  for (const e of orphans) console.log(`  ${e.periode} ${e.namaGT} = ${e.target}`);
  if (apply && process.argv.includes("--prune") && dups.length) {
    const r = await prisma.targetHospitalValue.deleteMany({ where: { id: { in: dups.map((e) => e.id) } } });
    console.log(`🗑 pruned ${r.count} duplicate rows.`);
  }

  if (!apply) { console.log("\nDry run. Re-run with --apply to upsert."); await prisma.$disconnect(); return; }

  const now = new Date().toISOString();
  for (let i = 0; i < flat.length; i += 300) {
    const values = flat.slice(i, i + 300).map((f) => `('${randomUUID()}','${esc(f.namaGT)}',${f.kodeGT ? `'${esc(f.kodeGT)}'` : "NULL"},'${f.periode}',${f.target},'${now}','${now}')`).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "TargetHospitalValue" ("id","namaGT","kodeGT","periode","target","syncedAt","updatedAt")
      VALUES ${values}
      ON CONFLICT ("namaGT","periode") DO UPDATE SET
        "kodeGT" = EXCLUDED."kodeGT", "target" = EXCLUDED."target",
        "syncedAt" = EXCLUDED."syncedAt", "updatedAt" = EXCLUDED."updatedAt"`);
  }
  console.log(`✅ upserted ${flat.length} rows.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
