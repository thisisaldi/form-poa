import { NextRequest, NextResponse } from "next/server";

// Tim Exodus (exodus.pharos.id) manggil /api/poa-doctors dkk langsung dari
// browser mereka — butuh CORS di semua /api/* biar preflight-nya lolos.
// Origin tunggal, di-hardcode (sama pola dengan allowedDevOrigins di
// next.config.ts) — bukan config multi-origin, cuma satu consumer eksternal.
const ALLOWED_ORIGIN = "https://exodus.pharos.id";

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  const isAllowed = origin === ALLOWED_ORIGIN;

  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: isAllowed
        ? {
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
          }
        : {},
    });
  }

  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
