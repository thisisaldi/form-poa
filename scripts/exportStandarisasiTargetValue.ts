/**
 * Export data buat tim eksternal, format sama kayak
 * "internal/standarisasi & target value.xlsx" (sheet "standarisasi" +
 * "target_value" — template itu cuma header, kosong).
 *
 * Kolom yang TIDAK ada sumbernya di sistem sengaja dikosongin (bukan di-skip
 * dari output), sesuai keputusan diskusi sama tim:
 * - competitor_name / competitor_discount_pct / competitor_net_sell_price /
 *   competitor_avg_sales — gak ada model kompetitor sama sekali di POA
 *   Standarisasi (beda dari `produkKompetitor` teks bebas di POA Estimasi,
 *   modul lain).
 * - memo_count — gak ada konsep ini di manapun di schema.
 *
 * last_discount_pct/last_discount_period pakai data DPL/DPF (DiskonKontrak,
 * fallback DiskonHistory) sesuai keputusan tim, meski scope aslinya kontrak
 * DPL/DPF bukan standarisasi murni — sama logic resolveDiskonPctWithHistory
 * di LineItemEditor.tsx.
 *
 * Run: npx tsx scripts/exportStandarisasiTargetValue.ts [output-path]
 * Default output: internal/standarisasi_target_value_export.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

function toPeriodeYYYYMM(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function resolveLastDiskon(
  kontrakList: { kodeProduk: string; prdAwal: string; prdAkhir: string; newOnPi: any }[],
  historyList: { kodeProduk: string; maxDiskonPct: any; sourcePeriod: string }[],
  kodeProduk: string,
  periode: string | null
): { pct: number | null; period: string | null } {
  if (periode) {
    const candidates = kontrakList.filter(
      (d) => d.kodeProduk === kodeProduk && d.prdAwal <= periode && d.prdAkhir >= periode && d.newOnPi != null
    );
    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => (Number(b.newOnPi) > Number(a.newOnPi) ? b : a));
      return { pct: Number(best.newOnPi), period: `${best.prdAwal}-${best.prdAkhir}` };
    }
  }
  const fromHistory = historyList.find((d) => d.kodeProduk === kodeProduk);
  if (fromHistory) return { pct: Number(fromHistory.maxDiskonPct), period: fromHistory.sourcePeriod };
  return { pct: null, period: null };
}

async function exportStandarisasiSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet("standarisasi");
  sheet.columns = [
    { header: "period", key: "period" },
    { header: "outlet_code", key: "outlet_code" },
    { header: "outlet_name", key: "outlet_name" },
    { header: "outlet_sector", key: "outlet_sector" },
    { header: "product_code", key: "product_code" },
    { header: "product_name", key: "product_name" },
    { header: "sell_price", key: "sell_price" },
    { header: "last_discount_pct", key: "last_discount_pct" },
    { header: "last_discount_period", key: "last_discount_period" },
    { header: "plan_discount_pct", key: "plan_discount_pct" },
    { header: "plan_net_sell_price", key: "plan_net_sell_price" },
    { header: "competitor_name", key: "competitor_name" },
    { header: "competitor_discount_pct", key: "competitor_discount_pct" },
    { header: "competitor_net_sell_price", key: "competitor_net_sell_price" },
    { header: "competitor_avg_sales", key: "competitor_avg_sales" },
    { header: "memo_count", key: "memo_count" },
    { header: "target_date", key: "target_date" },
  ];

  const produkRows = await prisma.poaStandarisasiProduk.findMany({
    where: { pengajuan: { owner: { role: "MR" } } }, // exclude ADMIN test accounts (2026-09-23)
    include: {
      pengajuan: { include: { outlet: true } },
      product: true,
    },
  });

  const kontrakList = await prisma.diskonKontrak.findMany({
    select: { kodeProduk: true, kodePI: true, prdAwal: true, prdAkhir: true, newOnPi: true },
  });
  const historyList = await prisma.diskonHistory.findMany({
    select: { kodeProduk: true, kodePI: true, maxDiskonPct: true, sourcePeriod: true },
  });

  for (const row of produkRows) {
    const outlet = row.pengajuan.outlet;
    const periode = toPeriodeYYYYMM(row.pengajuan.submittedAt ?? row.pengajuan.createdAt);
    const kontrakForOutlet = kontrakList.filter((d) => d.kodePI === outlet.kodePI);
    const historyForOutlet = historyList.filter((d) => d.kodePI === outlet.kodePI);
    const lastDiskon = resolveLastDiskon(kontrakForOutlet, historyForOutlet, row.kodeProduk, periode);

    const sellPrice = Number(row.product.hna);
    const planDiscountPct = row.estimasiDiskonPct != null ? Number(row.estimasiDiskonPct) : row.finalDiscountPct != null ? Number(row.finalDiscountPct) : null;
    const planNetSellPrice = planDiscountPct != null ? sellPrice * (1 - planDiscountPct / 100) : null;

    sheet.addRow({
      period: periode,
      outlet_code: outlet.kodePI,
      outlet_name: outlet.namaOutlet,
      outlet_sector: outlet.sector,
      product_code: row.kodeProduk,
      product_name: row.product.namaProduk,
      sell_price: sellPrice,
      last_discount_pct: lastDiskon.pct,
      last_discount_period: lastDiskon.period,
      plan_discount_pct: planDiscountPct,
      plan_net_sell_price: planNetSellPrice,
      competitor_name: null,
      competitor_discount_pct: null,
      competitor_net_sell_price: null,
      competitor_avg_sales: null,
      memo_count: null,
      target_date: row.pengajuan.estimasiTimelineSelesai ?? null,
    });
  }
}

async function exportTargetValueSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet("target_value");
  sheet.columns = [
    { header: "period_month", key: "period_month" },
    { header: "territory_code", key: "territory_code" },
    { header: "territory_name", key: "territory_name" },
    { header: "target_month_value", key: "target_month_value" },
  ];

  const rows = await prisma.targetHospitalValue.findMany({
    select: { periode: true, kodeGT: true, namaGT: true, target: true },
  });

  for (const row of rows) {
    sheet.addRow({
      period_month: row.periode,
      territory_code: row.kodeGT,
      territory_name: row.namaGT,
      target_month_value: Number(row.target),
    });
  }
}

async function main() {
  const outputPath = process.argv[2] || "internal/standarisasi_target_value_export.xlsx";
  const workbook = new ExcelJS.Workbook();

  await exportStandarisasiSheet(workbook);
  await exportTargetValueSheet(workbook);

  await workbook.xlsx.writeFile(path.resolve(outputPath));
  console.log(`Written: ${outputPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
