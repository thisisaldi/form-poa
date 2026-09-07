// Shared between middleware.ts (page-navigation redirect) and
// actions/auth.ts (post-login redirect) — both bounce staging to production
// for everyone except this exempt set, so the nip list must stay identical
// in both places or an exempt user passes one gate and gets caught by the
// other (2026-09-07 bug: L090657 exempted in middleware.ts but not here yet,
// still got bounced to production right after logging in on staging).
export const STAGING_HOST = "staging-form-poa.chc.pharmalink.id";
export const PRODUCTION_HOST = "form-poa.chc.pharmalink.id";

// One MR (Lucco Boer, L090657) needs staging reachable directly, so their
// whole approval chain up to NSM is exempted too (P060213 ASM, L090111 SM,
// 995338 NSM — resolved via nipAtasan) instead of just the one nip,
// otherwise their own submissions would never show up for approval on
// staging.
export const STAGING_REDIRECT_EXEMPT_NIPS = new Set(["L090657", "P060213", "L090111", "995338"]);
