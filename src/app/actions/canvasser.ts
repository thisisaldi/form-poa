"use server";

import { getSalesCountersByOutlet } from "@/app/(app)/sc/[id]/_services/getSalesCounters";
import { getSalesCounterProduct } from "@/app/(app)/sc/[id]/_services/getSalesCounterProduct";
import { getScProductMenang } from "@/app/(app)/sc/[id]/_services/getScProductMenang";
import { getScProductWithInsentif } from "@/app/(app)/sc/[id]/_services/getScProductWithInsentif";
import { getScInsentifHistory } from "@/app/(app)/sc/[id]/_services/getScInsentifHistory";
import { getPrincodeProducts } from "@/app/(app)/sc/[id]/_services/getPrincodeProducts";

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

export async function getScInsentifHistoryAction(piCode: string) {
  if (!piCode) return { data: {} };
  const res = await getScInsentifHistory(piCode);
  return res || { data: {} };
}

export async function getPrincodeProductsAction() {
  const data = await getPrincodeProducts();
  return { data };
}
