import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  await destroySession();
  const base = new URL("/login", req.nextUrl.origin);
  return NextResponse.redirect(base);
}

// GET is used when the layout detects a stale/invalid session and needs to
// clear the cookie — layouts can't modify cookies directly.
export async function GET(req: NextRequest) {
  await destroySession();
  const base = new URL("/login", req.nextUrl.origin);
  return NextResponse.redirect(base);
}
