import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { STAGING_HOST, PRODUCTION_HOST, STAGING_REDIRECT_EXEMPT_NIPS } from "@/lib/stagingAccess";

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
// Re-enabled 2026-09-07 with a per-nip exemption (STAGING_REDIRECT_EXEMPT_NIPS,
// see lib/stagingAccess.ts — shared with actions/auth.ts's own staging bounce)
// — was fully disabled 2026-08-20 for testing.
const STAGING_REDIRECT_ENABLED = true;

export async function middleware(req: NextRequest) {
  if (!STAGING_REDIRECT_ENABLED) return NextResponse.next();
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

  const host = req.headers.get("host");
  if (host !== STAGING_HOST) return NextResponse.next();

  // Exempt nip check below needs a session cookie to already exist, but that
  // cookie is only set AFTER logging in — without this, /login itself gets
  // redirected to production before the exempt nip ever gets a chance to log
  // in on staging at all (2026-09-07 bug report: L090657 stuck bouncing to
  // prod, could never reach the staging login page in the first place).
  if (req.nextUrl.pathname === "/login") return NextResponse.next();

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (session.isLoggedIn && STAGING_REDIRECT_EXEMPT_NIPS.has(session.nip)) return res;

  const url = new URL(req.url);
  url.protocol = "https:";
  url.host = PRODUCTION_HOST;
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!api/health).*)"],
};
