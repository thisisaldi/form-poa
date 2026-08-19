/**
 * Inbound HTTP Basic Auth for API routes called by external systems that
 * can't carry a session cookie — counterpart to nexusAuth.ts's OUTBOUND Basic
 * Auth header builder for calls we make to Nexus. Session auth (getCurrentUser)
 * stays the primary path for the app's own browser calls; this is only an
 * alternate credential check for routes that opt into it (e.g. /api/poa-doctors,
 * 2026-08-19). Credential is DB-backed (PoaDoctorsApiCredential, admin-managed
 * via /admin — see setPoaDoctorsApiCredentialAction), not an env var, so it can
 * be rotated without a redeploy.
 */

import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { verifySecret } from "@/lib/secretHash";

export interface BasicAuthCredential {
  username: string;
  passwordHash: string;
  passwordSalt: string;
}

/**
 * Verifies the request's `Authorization: Basic ...` header against the given
 * credential. Returns false (never throws) for a missing/malformed header or
 * when no credential is configured (null) — an unconfigured route must fail
 * closed, not accept anything.
 */
export function verifyBasicAuth(req: NextRequest, credential: BasicAuthCredential | null): boolean {
  if (!credential) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return constantTimeStringEqual(username, credential.username)
    && verifySecret(password, credential.passwordHash, credential.passwordSalt);
}

// Hash both sides to a fixed-length digest before comparing — timingSafeEqual
// itself throws on mismatched-length inputs, and short-circuiting on length
// first would leak the expected value's length via response timing. Only for
// the username here — the password itself is compared via verifySecret
// (scrypt hash), never handled as plaintext beyond this point.
function constantTimeStringEqual(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}
