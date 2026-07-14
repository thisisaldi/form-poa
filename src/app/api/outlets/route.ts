import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const outlets = await prisma.outlet.findMany({
    where: { statusOutlet: "A" },
    select: { kodePI: true, namaOutlet: true },
    orderBy: { namaOutlet: "asc" },
  });
  return NextResponse.json(outlets);
}
