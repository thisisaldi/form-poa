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

  const [drafts, actor] = await Promise.all([
    prisma.poaScForm.findMany({
      where: { ownerId: session.userId, period: id },
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
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (drafts.length === 0) {
    return NextResponse.json({ error: "No SC POA drafts found for this period" }, { status: 404 });
  }

  const first = drafts[0];
  const owner = first.owner;

  // Authorization check
  const isOwner = owner.nip === session.userId;
  const isSpecialRole = (["ADMIN", "GM", "SFE", "VIEWER"] as string[]).includes(session.role);
  const isSuperior = (["ASM", "SM", "NSM"] as string[]).includes(session.role);

  let hasAccess = false;
  if (isOwner || isSpecialRole) {
    hasAccess = true;
  } else if (isSuperior) {
    hasAccess = first.status !== PoaStatus.DRAFT;
  }

  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  await Promise.all(
    outletCodes.map(async (kodePI: string) => {
      try {
        const res = await getSalesCounterProduct(kodePI);
        if (res?.data) {
          for (const cp of res.data) {
            canvasserProductMap.set(`${kodePI}_${cp.pro_code}`, {
              sales_counter_value: cp.sales_counter_value || 0,
              sales_counter_minimum: cp.sales_counter_minimum || 0,
            });
          }
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

  // ─── Sheet 1: DATA INPUT POA ─────────────────────────────────────────────
  const formSheet = wb.addWorksheet("DATA INPUT POA");
  formSheet.columns = [
    { header: "No. Form SC", key: "formNo", width: 12 },
    { header: "NIP MR", key: "nipMr", width: 14 },
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "KodePI Outlet", key: "kodePI", width: 14 },
    { header: "Nama Outlet SC", key: "namaOutlet", width: 30 },
    { header: "% Resep Dokter", key: "persenResepDokter", width: 16 },
    { header: "Sales Counter", key: "scPersonNames", width: 32 },
    { header: "Kode Produk", key: "kodeProduk", width: 14 },
    { header: "Nama Produk SC", key: "namaProduk", width: 30 },
    { header: "Produk Kompetitor", key: "produkKompetitor", width: 22 },
    { header: "Qty ST / Bulan", key: "qtyPerBulan", width: 16 },
    { header: "Estimasi Sales / Bln (Rp)", key: "estSalesBulan", width: 22 },
    { header: "Estimasi Sales / Periode (Rp)", key: "estSalesPeriode", width: 24 },
    { header: "% Matriks SC (Insentif)", key: "persenMatriksSc", width: 18 },
    { header: "Insentif SC / Bln (Rp)", key: "nilaiScBulan", width: 20 },
    { header: "Insentif SC / Periode (Rp)", key: "nilaiScPeriode", width: 22 },
    { header: "% Diskon SC", key: "persenDiskon", width: 14 },
    { header: "Diskon SC / Periode (Rp)", key: "diskonPeriode", width: 22 },
    { header: "% Cashback SC", key: "persenCashback", width: 14 },
    { header: "Cashback SC / Periode (Rp)", key: "cashbackPeriode", width: 22 },
    { header: "Entertain SC / Periode (Rp)", key: "entertainPeriode", width: 22 },
    { header: "Total Rencana Biaya SC (Rp)", key: "rencanaTotalBiaya", width: 24 },
    { header: "Periode Awal", key: "periodeAwal", width: 14 },
    { header: "Lama Periode (Bulan)", key: "lamaPeriode", width: 16 },
    { header: "Status", key: "status", width: 16 },
  ];

  formSheet.getRow(1).font = { bold: true, color: { argb: WHITE } };
  formSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  formSheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  let formCounter = 1;
  for (const draft of drafts) {
    const lama = draft.lamaPeriode || 3;
    const scPersonStr = draft.persons.map((p: any) => `${p.personName} (${p.positionName})`).join(", ") || "-";
    const draftEntertain = draft.entertainItems.reduce((s: number, e: any) => s + (parseFloat(e.biayaEntertain.toString()) || 0), 0);

    for (const p of draft.products) {
      if (!p.kodeProduk) continue;

      const mp = masterMap.get(p.kodeProduk);
      const hnaSJ = mp ? parseFloat(mp.hna.toString()) : 0;
      const konv = mp?.konversiPembagi ? parseFloat(mp.konversiPembagi.toString()) : 1;
      const hnaST = hnaSJ / konv;

      const qty = p.qtyPerBulan || 0;

      const estSalesBulan = qty * hnaST;
      const estSalesPeriode = estSalesBulan * lama;
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
      const nilaiScPeriode = nilaiScBulan * lama;

      const pctDiskon = (parseFloat(p.persenDiskon.toString()) || 0) / 100;
      const diskonPeriode = estSalesPeriode * pctDiskon;

      const pctCashback = (parseFloat(p.persenCashback.toString()) || 0) / 100;
      const cashbackPeriode = estSalesPeriode * pctCashback;

      const totalBiayaProduk = parseFloat(p.rencanaTotalBiaya.toString()) || (nilaiScPeriode + diskonPeriode + cashbackPeriode);

      formSheet.addRow({
        formNo: formCounter,
        nipMr: owner.nip,
        namaMr: owner.name,
        kodePI: draft.kodePI,
        namaOutlet: draft.namaOutlet || draft.kodePI,
        persenResepDokter: draft.persenResepDokter || 0,
        scPersonNames: scPersonStr,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        produkKompetitor: p.produkKompetitor || "-",
        qtyPerBulan: qty,
        estSalesBulan: Math.round(estSalesBulan),
        estSalesPeriode: Math.round(estSalesPeriode),
        persenMatriksSc: pctMatriks,
        nilaiScBulan: Math.round(nilaiScBulan),
        nilaiScPeriode: Math.round(nilaiScPeriode),
        persenDiskon: pctDiskon,
        diskonPeriode: Math.round(diskonPeriode),
        persenCashback: pctCashback,
        cashbackPeriode: Math.round(cashbackPeriode),
        entertainPeriode: Math.round(draftEntertain),
        rencanaTotalBiaya: Math.round(totalBiayaProduk + draftEntertain),
        periodeAwal: draft.periodeAwal,
        lamaPeriode: lama,
        status: draft.status.replace(/_/g, " "),
      });
    }
    formCounter++;
  }

  ["persenMatriksSc", "persenDiskon", "persenCashback"].forEach((k) => {
    formSheet.getColumn(k).numFmt = PCT_FMT;
  });

  [
    "estSalesBulan",
    "estSalesPeriode",
    "nilaiScBulan",
    "nilaiScPeriode",
    "diskonPeriode",
    "cashbackPeriode",
    "entertainPeriode",
    "rencanaTotalBiaya",
  ].forEach((k) => {
    formSheet.getColumn(k).numFmt = RP_FMT;
  });

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
      "Content-Disposition": `attachment; filename="POA_SC_${id}_${owner.nip}.xlsx"`,
    },
  });
}
