/**
 * GET /api/sc/[id]/export
 *
 * Returns a single-POA Sales Counter (SC) Excel workbook using ExcelJS.
 * Export uses ACTUAL raw numbers (no /1,000,000 denominator division).
 */

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { PoaStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { getScSubordinateIdsUnder } from "@/lib/authz";
import { getSalesCounterProduct } from "../../../../(app)/sc/[id]/_services/getSalesCounterProduct";

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ownerIdParam = _req.nextUrl.searchParams.get("ownerId");

  let targetOwnerId = ownerIdParam || session.userId;
  let targetPeriod = id;

  // Check if id is a specific PoaScForm.id (UUID)
  const formById = await prisma.poaScForm.findUnique({
    where: { id },
    select: { ownerId: true, period: true, status: true, currentHolderId: true },
  });

  if (formById) {
    targetOwnerId = formById.ownerId;
    targetPeriod = formById.period;
  }

  // Authorization check
  const isSelf = targetOwnerId === session.userId;
  const isSpecialRole = (["ADMIN", "GM", "SFE", "VIEWER"] as string[]).includes(session.role);

  let hasAccess = false;
  if (isSelf || isSpecialRole) {
    hasAccess = true;
  } else {
    const depthByRole: Record<string, number> = { ASM: 1, SM: 2, NSM: 3 };
    const depth = depthByRole[session.role] ?? 1;
    const subIds = await getScSubordinateIdsUnder(session.userId, depth);
    if (subIds.includes(targetOwnerId)) {
      const submittedCount = await prisma.poaScForm.count({
        where: {
          ownerId: targetOwnerId,
          period: targetPeriod,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = submittedCount > 0;
    } else {
      const holderCount = await prisma.poaScForm.count({
        where: {
          ownerId: targetOwnerId,
          period: targetPeriod,
          currentHolderId: session.userId,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = holderCount > 0;
    }
  }

  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const draftsWhere: any = { ownerId: targetOwnerId, period: targetPeriod };
  if (!isSelf && !isSpecialRole) {
    draftsWhere.status = { not: PoaStatus.DRAFT };
  }

  // Optional filter: only export specific outlet form IDs
  const outletIdsParam = _req.nextUrl.searchParams.get("outletIds");
  if (outletIdsParam) {
    const outletIds = outletIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (outletIds.length > 0) {
      draftsWhere.id = { in: outletIds };
    }
  }

  const drafts = await prisma.poaScForm.findMany({
    where: draftsWhere,
    include: {
      owner: true,
      currentHolder: true,
      products: true,
      persons: true,
      entertainItems: true,
      auditLogs: {
        include: { actor: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (drafts.length === 0) {
    return NextResponse.json({ error: "No SC POA drafts found for this period" }, { status: 404 });
  }


  const first = drafts[0];
  const owner = first.owner;

  // Fetch product master details for all products in drafts
  const allProductCodes = Array.from(
    new Set(drafts.flatMap((d: any) => d.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts: MasterProductItem[] = await prisma.product.findMany({
    where: { kodeProduk: { in: allProductCodes } },
    select: {
      kodeProduk: true,
      namaProduk: true,
      hna: true,
      konversiPembagi: true,
      satuanTerkecil: true,
      satuan: true,
    },
  });

  const masterMap = new Map<string, MasterProductItem>(
    masterProducts.map((p: MasterProductItem) => [p.kodeProduk, p])
  );

  const outletCodes = Array.from(new Set(drafts.map((d: any) => d.kodePI).filter(Boolean))) as string[];
  const canvasserProductMap = new Map<string, { sales_counter_value: number; sales_counter_minimum: number }>();
  const outletScProductCodesMap = new Map<string, Set<string>>();

  await Promise.all(
    outletCodes.map(async (kodePI: string) => {
      try {
        const res = await getSalesCounterProduct(kodePI);
        if (res?.data) {
          const scSet = new Set<string>();
          for (const cp of res.data) {
            canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
              sales_counter_value: cp.sales_counter_value || 0,
              sales_counter_minimum: cp.sales_counter_minimum || 0,
            });
            if (cp.pro_code) scSet.add(cp.pro_code);
          }
          outletScProductCodesMap.set(kodePI, scSet);
        }
      } catch (err) {
        console.error(`Error fetching SC products for ${kodePI}:`, err);
      }
    })
  );

  // Build ExcelJS Workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "POA Sales Counter System";
  wb.created = new Date();

  const BLUE = "FF0063A0";
  const WHITE = "FFFFFFFF";
  const RP_FMT = "#,##0";
  const PCT_FMT = "0.0%";

  // ─── Sheet 1: DATA INPUT POA (Detail per Bulan) ───────────────────────────
  const formSheet = wb.addWorksheet("DATA INPUT POA");
  formSheet.columns = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode", key: "periode", width: 14 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Qty ST / Bulan", key: "qtyPerBulan", width: 16 },
    { header: "Estimasi Sales / Bln (Rp)", key: "estSalesBulan", width: 22 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Insentif SC / Bln (Rp)", key: "nilaiScBulan", width: 20 },
    { header: "% Diskon SC", key: "persenDiskon", width: 14 },
    { header: "Diskon SC / Bln (Rp)", key: "diskonBulan", width: 22 },
    { header: "% Cashback SC", key: "persenCashback", width: 14 },
    { header: "Cashback SC / Bln (Rp)", key: "cashbackBulan", width: 22 },
    { header: "Total Rencana Biaya SC (Rp)", key: "rencanaTotalBiaya", width: 24 },
    { header: "Status", key: "status", width: 16 },
  ];

  formSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  formSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  formSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  // ─── Sheet 2: DATA POA PER PERIODE (Rekap Akumulasi per Periode) ───────────
  const periodSheet = wb.addWorksheet("DATA POA PER PERIODE");
  periodSheet.columns = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "Periode", key: "periode", width: 14 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Total Qty ST", key: "totalQty", width: 16 },
    { header: "Total Estimasi Sales (Rp)", key: "totalEstSales", width: 24 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Total Insentif SC (Rp)", key: "totalNilaiSc", width: 22 },
    { header: "% Diskon SC", key: "persenDiskon", width: 14 },
    { header: "Total Diskon SC (Rp)", key: "totalDiskon", width: 22 },
    { header: "% Cashback SC", key: "persenCashback", width: 14 },
    { header: "Total Cashback SC (Rp)", key: "totalCashback", width: 22 },
    { header: "Total Rencana Biaya SC (Rp)", key: "totalRencanaBiaya", width: 24 },
    { header: "Status", key: "status", width: 16 },
  ];

  periodSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  periodSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  periodSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  let formCounter = 1;
  for (const draft of drafts) {
    const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
    const scCodes = outletScProductCodesMap.get(draft.kodePI);

    const validProducts = draft.products.filter((p: any) => {
      if (!p.kodeProduk) return false;
      if (scCodes && scCodes.size > 0 && !scCodes.has(p.kodeProduk) && !scCodes.has(p.kodeProduk.replace(/^0+/, ""))) {
        return false;
      }
      return true;
    });

    // Sort products by kodeProduk then periodeMonth
    validProducts.sort((a: any, b: any) =>
      a.kodeProduk.localeCompare(b.kodeProduk) || (a.periodeMonth || "").localeCompare(b.periodeMonth || "")
    );

    // Populate Sheet 1: Detail per Bulan
    for (const p of validProducts) {
      const mp = masterMap.get(p.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const qty = p.qtyPerBulan || 0;
      const estSalesBulan = qty * hnaST;
      const pctMatriks = (parseFloat(p.persenMatriksSc.toString()) || 0) / 100;
      const cp = canvasserProductMap.get(`${draft.kodePI}_${p.kodeProduk}`);
      const qtySjBln = konv > 0 ? qty / konv : 0;
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

      let nilaiScBulan = 0;
      if (scVal != null && scVal > 0) {
        nilaiScBulan = qtySjBln >= scMin ? qtySjBln * scVal : 0;
      } else {
        nilaiScBulan = estSalesBulan * pctMatriks;
      }

      const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
      const diskonBulan = estSalesBulan * pctDiskon;

      const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;
      const cashbackBulan = estSalesBulan * pctCashback;

      const totalBiayaProduk =
        parseFloat(p.rencanaTotalBiaya.toString()) || (nilaiScBulan + diskonBulan + cashbackBulan);

      formSheet.addRow({
        formNo: formCounter,
        nipMr: owner.nip,
        namaMr: owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        periode: p.periodeMonth || draft.period || draft.periodeAwal || targetPeriod,
        scPersonNames: scPersonStr,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        produkKompetitor: p.produkKompetitor || "-",
        qtyPerBulan: qty,
        estSalesBulan: Math.round(estSalesBulan),
        persenMatriksSc: pctMatriks,
        nilaiScBulan: Math.round(nilaiScBulan),
        persenDiskon: pctDiskon,
        diskonBulan: Math.round(diskonBulan),
        persenCashback: pctCashback,
        cashbackBulan: Math.round(cashbackBulan),
        rencanaTotalBiaya: Math.round(totalBiayaProduk),
        status: draft.status.replace(/_/g, " "),
      });
    }

    // Populate Sheet 2: Rekap / Sum per Produk untuk Satu Periode
    const productGroups = new Map<string, typeof validProducts>();
    for (const p of validProducts) {
      if (!productGroups.has(p.kodeProduk)) {
        productGroups.set(p.kodeProduk, []);
      }
      productGroups.get(p.kodeProduk)!.push(p);
    }

    for (const [, items] of productGroups.entries()) {
      const primary = items[0];
      const mp = masterMap.get(primary.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;
      const pctMatriks = (parseFloat(primary.persenMatriksSc.toString()) || 0) / 100;
      const pctDiskon = (parseFloat(primary.persenDiskon.toString()) || 0) / 100;
      const pctCashback = (parseFloat(primary.persenCashback.toString()) || 0) / 100;

      const cp = canvasserProductMap.get(`${draft.kodePI}_${primary.kodeProduk}`);
      const scVal = cp?.sales_counter_value;
      const scMin = cp?.sales_counter_minimum || 0;

      let totalQty = 0;
      let totalEstSales = 0;
      let totalNilaiSc = 0;
      let totalDiskon = 0;
      let totalCashback = 0;
      let totalBiaya = 0;

      for (const it of items) {
        const q = it.qtyPerBulan || 0;
        const estMonth = q * hnaST;
        const qtySj = konv > 0 ? q / konv : 0;

        let scMonth = 0;
        if (scVal != null && scVal > 0) {
          scMonth = qtySj >= scMin ? qtySj * scVal : 0;
        } else {
          scMonth = estMonth * pctMatriks;
        }

        const dMonth = estMonth * pctDiskon;
        const cbMonth = estMonth * pctCashback;
        const bMonth = parseFloat(it.rencanaTotalBiaya.toString()) || (scMonth + dMonth + cbMonth);

        totalQty += q;
        totalEstSales += estMonth;
        totalNilaiSc += scMonth;
        totalDiskon += dMonth;
        totalCashback += cbMonth;
        totalBiaya += bMonth;
      }

      periodSheet.addRow({
        formNo: formCounter,
        nipMr: owner.nip,
        namaMr: owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        periode: draft.period || targetPeriod,
        scPersonNames: scPersonStr,
        kodeProduk: primary.kodeProduk,
        namaProduk: primary.namaProduk,
        produkKompetitor: primary.produkKompetitor || "-",
        totalQty,
        totalEstSales: Math.round(totalEstSales),
        persenMatriksSc: pctMatriks,
        totalNilaiSc: Math.round(totalNilaiSc),
        persenDiskon: pctDiskon,
        totalDiskon: Math.round(totalDiskon),
        persenCashback: pctCashback,
        totalCashback: Math.round(totalCashback),
        totalRencanaBiaya: Math.round(totalBiaya),
        status: draft.status.replace(/_/g, " "),
      });
    }

    formCounter++;
  }

  // Format Sheet 1
  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    formSheet.getColumn(k).numFmt = PCT_FMT;
  });

  [
    "estSalesBulan",
    "nilaiScBulan",
    "diskonBulan",
    "cashbackBulan",
    "rencanaTotalBiaya",
  ].forEach((k) => {
    formSheet.getColumn(k).numFmt = RP_FMT;
  });

  // Format Sheet 2
  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    periodSheet.getColumn(k).numFmt = PCT_FMT;
  });

  [
    "totalEstSales",
    "totalNilaiSc",
    "totalDiskon",
    "totalCashback",
    "totalRencanaBiaya",
  ].forEach((k) => {
    periodSheet.getColumn(k).numFmt = RP_FMT;
  });

  // ─── Sheet 2: BIAYA ENTERTAIN OUTLET (Jika ada data entertain) ───────────
  const hasEntertain = drafts.some((d: any) => d.entertainItems && d.entertainItems.length > 0);
  if (hasEntertain) {
    const entertainSheet = wb.addWorksheet("BIAYA ENTERTAIN OUTLET");
    entertainSheet.columns = [
      { header: "No. Form SC", key: "formNo", width: 12 },
      { header: "KodePI Outlet", key: "kodePI", width: 14 },
      { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
      { header: "Periode Bulan", key: "periodeMonth", width: 16 },
      { header: "Biaya Entertain (Rp)", key: "biayaEntertain", width: 22 },
    ];
    entertainSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
    entertainSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    entertainSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

    let fNum = 1;
    for (const draft of drafts) {
      for (const ent of draft.entertainItems) {
        entertainSheet.addRow({
          formNo: fNum,
          kodePI: draft.kodePI,
          namaOutlet: draft.namaOutlet || draft.kodePI,
          periodeMonth: ent.periodeMonth,
          biayaEntertain: parseFloat(ent.biayaEntertain.toString()) || 0,
        });
      }
      fNum++;
    }
    entertainSheet.getColumn("biayaEntertain").numFmt = RP_FMT;
  }

  // ─── Sheet 2: Audit Log SC ───────────────────────────────────────────────
  const auditSheet = wb.addWorksheet("Audit Log SC");
  auditSheet.columns = [
    { header: "Date", key: "date", width: 22 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Action", key: "action", width: 14 },
    { header: "From Status", key: "from", width: 22 },
    { header: "To Status", key: "to", width: 22 },
  ];
  auditSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  auditSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };

  const allLogs = drafts
    .flatMap((d: any) => d.auditLogs)
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const log of allLogs) {
    auditSheet.addRow({
      date: log.createdAt.toISOString(),
      actor: `${log.actor.name} (${log.actor.nip})`,
      action: log.action,
      from: log.fromStatus ?? "-",
      to: log.toStatus ?? "-",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="POA_SC_${targetPeriod}_${owner.nip}.xlsx"`,
    },
  });
}
