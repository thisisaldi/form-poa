import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

async function handleLogout(req: NextRequest) {
  try {
    await destroySession();
  } catch {
    // If session destruction fails (e.g. missing env vars in mock mode),
    // still redirect to login — the cookie will expire naturally.
  }
  const base = new URL("/login", req.nextUrl.origin);
  return NextResponse.redirect(base);
}

export async function POST(req: NextRequest) {
  return handleLogout(req);
}

// GET is used when the layout detects a stale/invalid session and needs to
// clear the cookie — layouts can't modify cookies directly.
export async function GET(req: NextRequest) {
  return handleLogout(req);
}
