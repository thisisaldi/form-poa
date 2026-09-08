"use server";

import { getSalesCountersByOutlet } from "@/app/(app)/sc/[id]/_services/getSalesCounters";
import { getSalesCounterProduct } from "@/app/(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScProductMenang } from "@/app/(app)/sc/[id]/_services/getScProductMenang";
import { getScProductWithInsentif } from "@/app/(app)/sc/[id]/_services/getScProductWithInsentif";
import { getScInsentifHistory } from "@/app/(app)/sc/[id]/_services/getScInsentifHistory";
import { getPrincodeProducts } from "@/app/(app)/sc/[id]/_services/getPrincodeProducts";
import { getScCashbackPoa } from "@/app/(app)/sc/[id]/_services/getScCashbackPoa";
import { getScOutletB3Sales } from "@/app/(app)/sc/[id]/_services/getScOutletB3Sales";
import { getRekomendasiProduk } from "@/app/(app)/sc/[id]/_services/getRekomendasiProduk";
import { getHistorySales } from "@/app/(app)/sc/[id]/_services/getHistorySales";
import { postHistorySales } from "@/app/(app)/sc/[id]/_services/postHistorySales";
import { getSalesOnline } from "@/app/(app)/sc/[id]/_services/getSalesOnline";
import { getSalesApotekOnline } from "@/app/(app)/sc/[id]/_services/getSalesApotekOnline";
import { getApotekOnline } from "@/app/(app)/sc/[id]/_services/getApotekOnline";
import { getBlastInData } from "@/app/(app)/sc/[id]/_services/getBlastInData";
import { prisma } from "@/lib/prisma";

export async function getSalesCountersAction(piCode: string) {
  if (!piCode) return null;
  return await getSalesCountersByOutlet(piCode);
}

export async function getSalesCounterProductsAction(piCode: string) {
  if (!piCode) return null;
  return await getSalesCounterProduct(piCode);
}

export async function getScProductMenangAction(piCode: string) {
  if (!piCode) return { data: [] };
  const res = await getScProductMenang(piCode);
  return res || { data: [] };
}

export async function getScProductWithInsentifAction(piCode: string) {
  if (!piCode) return { data: [] };
  const res = await getScProductWithInsentif(piCode);
  return res || { data: [] };
}

export async function getScInsentifHistoryAction(piCode: string, period?: string) {
  if (!piCode) return { data: {} };
  const res = await getScInsentifHistory(piCode, period);
  return res || { data: {} };
}

export async function getPrincodeProductsAction() {
  const data = await getPrincodeProducts();
  return { data };
}

export async function getScCashbackPoaAction(piCode?: string) {
  const res = await getScCashbackPoa(piCode);
  return res ?? { status: false, message: "Gudang Tidak Ditemukan", matrix: [] };
}

export async function getScOutletB3SalesAction(period: number, piCode: string, proCodes: string[]) {
  if (!piCode || !proCodes || proCodes.length === 0) return { data: [] };
  const data = await getScOutletB3Sales(period, piCode, proCodes);
  return { data };
}

export async function getHistorySalesAction(piCode: string, agg: boolean = true) {
  if (!piCode) return { data: [] };
  const res = await getHistorySales(piCode, agg);
  return res || { data: [] };
}

export async function postHistorySalesAction(
  piCodes: string[],
  period?: (number | string)[],
  proCodes?: string[]
) {
  if (!piCodes || piCodes.length === 0) return { data: null };
  const res = await postHistorySales({
    piCodes,
    period,
    agg: true,
    proCodes,
  });
  return res || { data: null };
}

export async function getSalesOnlineAction(piCode: string) {
  if (!piCode) return { data: [] };
  const res = await getSalesOnline(piCode);
  return res || { data: [] };
}

export async function getSalesApotekOnlineAction(period: string | number, piCode: string) {
  if (!piCode) return null;
  const res = await getSalesApotekOnline(period, piCode);
  return res;
}

export async function getApotekOnlineAction(nip: string, position: string = "MR") {
  if (!nip) return [];
  return await getApotekOnline(nip, position);
}

export async function getRekomendasiProdukAction(piCode: string) {
  if (!piCode) return { data: [] };
  const res = await getRekomendasiProduk(piCode);
  return res || { data: [] };
}

export async function getLossSalesAnalysisAction(
  period: number,
  piCode: string,
  codes: string[]
) {
  if (!piCode || !codes || codes.length === 0) {
    return { status: false, data: [] };
  }
  try {
    const res = await fetch(
      "https://staging-izmo.chc.pharmalink.id/healthcare-productdetection/api/loss-sales-analysis/post-retrieve-product-sales",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          pi_code: piCode,
          code: codes,
        }),
        cache: "no-store",
      }
    );
    if (!res.ok) return { status: false, data: [] };
    const json = await res.json();
    return json;
  } catch (err) {
    console.error("Failed to fetch loss sales analysis:", err);
    return { status: false, data: [] };
  }
}

export async function getRecommendedProCodesAction(sourceProCodes?: string[]): Promise<string[]> {
  try {
    const cleanSourceCodes = (sourceProCodes || []).filter(Boolean);
    if (cleanSourceCodes.length === 0) {
      return [];
    }

    const rows = await prisma.productSwitchMapping.findMany({
      where: {
        sourceProCode: { in: cleanSourceCodes },
        recommendedProCode: { notIn: cleanSourceCodes },
      },
      select: { recommendedProCode: true },
      distinct: ["recommendedProCode"],
    });

    const uniqueCodes: string[] = Array.from(
      new Set(rows.map((r: { recommendedProCode: string }) => r.recommendedProCode).filter(Boolean))
    );
    return uniqueCodes;
  } catch (err) {
    console.error("Error fetching recommended pro codes from DB:", err);
    return [];
  }
}

import { getExodusOutletBudgets } from "@/lib/exodusApi";

export async function getBlastInDataAction(outletId: string, year?: number) {
  if (!outletId) return null;
  return await getBlastInData(outletId, year);
}

export async function getHistoryEntertainAction(
  outletCode: string,
  params?: { structurePeriod?: string; period?: string | number }
): Promise<number | null> {
  if (!outletCode) return null;
  return await getExodusOutletBudgets(outletCode, params);
}
