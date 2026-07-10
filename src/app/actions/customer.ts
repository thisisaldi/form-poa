"use server";

import { prisma } from "@/lib/prisma";

export interface CustomerOption {
  id: string;
  kodeCustomer: string | null;
  namaCustomer: string;
  spesialisasi: string;
  isFokus: boolean;
}

/** Distinct spesialisasi for all doctors at a given outlet (fokus first, then rest). */
export async function getSpesialisasiByOutlet(kodePI: string): Promise<string[]> {
  const rows = await prisma.customerOutlet.findMany({
    where: { kodePI },
    select: { customer: { select: { spesialisasi: true } }, isFokus: true },
    distinct: ["customerId"],
  });

  // Put spesialisasi that have fokus doctors first
  const fokusSpecs = new Set<string>();
  const allSpecs = new Set<string>();
  for (const r of rows as { isFokus: boolean; customer: { spesialisasi: string } }[]) {
    if (r.isFokus) fokusSpecs.add(r.customer.spesialisasi);
    allSpecs.add(r.customer.spesialisasi);
  }
  const sorted = [
    ...[...fokusSpecs].sort(),
    ...[...allSpecs].filter((s) => !fokusSpecs.has(s)).sort(),
  ];
  return sorted;
}

/** Focused doctors at a given outlet+spesialisasi, non-focused ones appended after. */
export async function getCustomersByOutletSpesialisasi(
  kodePI: string,
  spesialisasi: string
): Promise<CustomerOption[]> {
  const rows = await prisma.customerOutlet.findMany({
    where: { kodePI, customer: { spesialisasi } },
    include: { customer: true },
    orderBy: [{ isFokus: "desc" }, { customer: { namaCustomer: "asc" } }],
  });

  return rows.map((r: { isFokus: boolean; customer: { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string } }) => ({
    id: r.customer.id,
    kodeCustomer: r.customer.kodeCustomer,
    namaCustomer: r.customer.namaCustomer,
    spesialisasi: r.customer.spesialisasi,
    isFokus: r.isFokus,
  }));
}
