import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

function getPublicOrigin(req: NextRequest): string {
  // Cloud Run (and most reverse proxies) pass the original host in X-Forwarded-Host.
  // Falling back to req.nextUrl.origin would use the container's internal address.
  const fwdHost  = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return req.nextUrl.origin;
}

async function handleLogout(req: NextRequest) {
  try {
    await destroySession();
  } catch {
    // If session destruction fails (e.g. missing env vars in mock mode),
    // still redirect to login — the cookie will expire naturally.
  }
  const base = new URL("/login", getPublicOrigin(req));
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
