/**
 * HTTP Basic Auth header for the Nexus API (api-nexus.pharos.id) — required
 * as of 2026-08-18. Used by every direct Nexus fetch call: customer.ts's
 * fetchNexusCustomersByOutlet, outletSync.ts's per-NIP outlet fetch, and the
 * scripts/*NexusVsStrukturBaru.ts / checkCustomerFullApiGap.ts diagnostics.
 *
 * Reads process.env directly (not the Zod-validated `env` singleton in
 * env.ts) so this also works from standalone scripts that only load env via
 * `import "dotenv/config"`, not the full Next.js app env pipeline. Degrades
 * gracefully — same philosophy as the other optional external-API vars in
 * env.ts (EXODUS_ / GOOGLE_ prefixed): missing credentials just mean
 * requests go out unauthenticated (Nexus 401s them, callers already treat
 * that as "no data" via their existing try/catch), never a hard startup failure.
 */
export function nexusAuthHeaders(): Record<string, string> {
  const user = process.env.NEXUS_API_USERNAME;
  const pass = process.env.NEXUS_API_PASSWORD;
  if (!user || !pass) return {};
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}
