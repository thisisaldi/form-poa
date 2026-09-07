import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

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

// Re-enabled 2026-09-07 with a per-nip exemption below (was fully disabled
// 2026-08-20 for testing) — one MR (Lucco Boer, L090657) needs staging
// reachable directly, so their whole approval chain up to NSM is exempted
// too (P060213 ASM, L090111 SM, 995338 NSM — resolved via nipAtasan, see
// docs/form-poa's org structure) instead of just the one nip, otherwise
// their own submissions would never show up for approval on staging.
const STAGING_REDIRECT_ENABLED = true;
const STAGING_REDIRECT_EXEMPT_NIPS = new Set(["L090657", "P060213", "L090111", "995338"]);

export async function middleware(req: NextRequest) {
  if (!STAGING_REDIRECT_ENABLED) return NextResponse.next();
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

  const host = req.headers.get("host");
  if (host !== STAGING_HOST) return NextResponse.next();

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
