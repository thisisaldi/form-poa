import { NextResponse, type NextRequest } from "next/server";

// Users kept bookmarking/opening the staging URL out of habit after
// production went live (2026-08-04) — redirect every staging PAGE NAVIGATION
// to the same path on production instead of relying on everyone to update
// their bookmarks manually. /api/health excluded so k8s liveness/readiness
// probes (which hit the pod directly, not through this hostname) are
// unaffected either way.
//
// GET/HEAD only (2026-08-04 fix — "redirect dari staging ke production malah
// gabisa klik login"): Server Actions (e.g. the login form's `action={...}`)
// POST back to the page's own URL, and each Next.js build embeds action IDs
// specific to THAT build. If staging and production are different builds/
// deployments, a POST redirected mid-flight from staging to production
// carries an action ID production's server doesn't recognize — it fails
// silently client-side (looks like the button does nothing). Restricting the
// redirect to GET/HEAD means only the initial page load ever crosses
// deployments; once the browser is on production, every subsequent POST
// (login, any other Server Action) both originates AND stays there.
const STAGING_HOST = "staging-form-poa.chc.pharmalink.id";
const PRODUCTION_HOST = "form-poa.chc.pharmalink.id";

// Redirect disabled (2026-08-20) — needed staging reachable directly again
// for testing. Logic kept below, not deleted, in case it needs to come back.
const STAGING_REDIRECT_ENABLED = false;

export function middleware(req: NextRequest) {
  if (!STAGING_REDIRECT_ENABLED) return NextResponse.next();
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

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
