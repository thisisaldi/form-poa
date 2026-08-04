import { NextResponse, type NextRequest } from "next/server";

// Users kept bookmarking/opening the staging URL out of habit after
// production went live (2026-08-04) — redirect every staging request to the
// same path on production instead of relying on everyone to update their
// bookmarks manually. /api/health excluded so k8s liveness/readiness probes
// (which hit the pod directly, not through this hostname) are unaffected
// either way.
const STAGING_HOST = "staging-form-poa.chc.pharmalink.id";
const PRODUCTION_HOST = "form-poa.chc.pharmalink.id";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (host === STAGING_HOST) {
    const url = new URL(req.url);
    url.protocol = "https:";
    url.host = PRODUCTION_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/health).*)"],
};
