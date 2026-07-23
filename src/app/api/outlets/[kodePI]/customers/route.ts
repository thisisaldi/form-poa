/**
 * GET /api/outlets/[kodePI]/customers[?spesialisasi=...]
 *
 * Customers (doctors) linked to a given outlet, fokus ones first, merged with
 * live Nexus master-data results the same way the POA form's customer picker
 * does (see getCustomersByOutlet in app/actions/customer.ts) — so a doctor
 * known to Nexus but not yet synced into our local Customer table still shows
 * up here. Optional `spesialisasi` query param narrows to one spesialisasi.
 * Exposed as a plain HTTP endpoint for callers outside the app (server
 * actions can't be invoked directly over HTTP).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getCustomersByOutlet } from "@/app/actions/customer";

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

  const customers = await getCustomersByOutlet(kodePI);

  return NextResponse.json(
    spesialisasi ? customers.filter((c) => c.spesialisasi === spesialisasi) : customers
  );
}
