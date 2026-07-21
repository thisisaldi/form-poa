/**
 * GET /api/outlets/[kodePI]/customers[?spesialisasi=...]
 *
 * Customers (doctors) linked to a given outlet, fokus ones first. Optional
 * `spesialisasi` query param narrows to one spesialisasi — same shape as
 * getCustomersByOutletSpesialisasi() in app/actions/customer.ts, exposed here
 * as a plain HTTP endpoint for callers outside the app (server actions can't
 * be invoked directly over HTTP).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kodePI: string }> }
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kodePI } = await params;
  const spesialisasi = req.nextUrl.searchParams.get("spesialisasi");

  const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { kodePI: true } });
  if (!outlet) return NextResponse.json({ error: "Outlet tidak ditemukan." }, { status: 404 });

  const rows = await prisma.customerOutlet.findMany({
    where: { kodePI, ...(spesialisasi ? { customer: { spesialisasi } } : {}) },
    include: { customer: true },
    orderBy: [{ isFokus: "desc" }, { customer: { namaCustomer: "asc" } }],
  });

  const customers = rows.map((r: { isFokus: boolean; customer: { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string } }) => ({
    id: r.customer.id,
    kodeCustomer: r.customer.kodeCustomer,
    namaCustomer: r.customer.namaCustomer,
    spesialisasi: r.customer.spesialisasi,
    isFokus: r.isFokus,
  }));

  return NextResponse.json(customers);
}
