import { z } from "zod";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const isMock = process.env.USE_MOCK_DB === "true";

const envSchema = z.object({
  // DB vars are optional in mock mode
  DATABASE_URL: isMock
    ? z.string().optional().default("mock")
    : z.string().min(1, "DATABASE_URL is required"),
  MSSQL_CONNECTION_STRING: isMock
    ? z.string().optional().default("mock")
    : z.string().min(1, "MSSQL_CONNECTION_STRING is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  // Optional — email provider credentials, added when provider is chosen
  EMAIL_FROM: z.string().optional().default("noreply@example.com"),
  RESEND_API_KEY: z.string().optional(),
  // Optional — Exodus external API (Pharos), visit history (see
  // src/lib/exodusApi.ts). Different client_secret/URLs per environment
  // (develop/staging/production) — set via Vault per deployment, not baked
  // into the image. Feature degrades to "no data" when unset, same as
  // RESEND_API_KEY above, rather than failing env validation.
  EXODUS_AUTH_URL: z.string().optional(),
  EXODUS_AUTH_CLIENT_ID: z.string().optional(),
  EXODUS_AUTH_CLIENT_SECRET: z.string().optional(),
  EXODUS_API_BASE_URL: z.string().optional(),
  // Optional — Google Drive upload for "Input Data Survey" + POA
  // Standarisasi (see docs/survey-pasien-features/, src/lib/googleDrive.ts).
  // Two ways to provide the service account credential, either is fine
  // (GOOGLE_SERVICE_ACCOUNT_KEY_FILE checked first if both are set):
  //   - GOOGLE_SERVICE_ACCOUNT_KEY_FILE: path to the mounted .json key file
  //     (2026-08-28, preferred — sidesteps every env-var-transport encoding
  //     bug this app hit: base64 mis-encode, double-JSON-encode, single-quote
  //     JS-object-literal, escaped-but-unwrapped, whitespace-mangled PEM body
  //     — a mounted file is read as raw bytes, no string transport involved).
  //   - GOOGLE_SERVICE_ACCOUNT_KEY: the RAW service account JSON, RAW (not
  //     base64-encoded — see googleDrive.ts's doc comment) — kept as a
  //     fallback for deployments that don't support mounting a secret file.
  // Set via Vault per deployment, not baked into the image. Feature degrades
  // to a clear "belum dikonfigurasi" error when neither is set, same pattern
  // as EXODUS_* above. Destination folder id is NOT here — moved to the
  // DB-backed GoogleDriveConfig table (2026-08-27, ADMIN-settable, admin.ts).
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  // Optional — Nexus API (api-nexus.pharos.id) now requires HTTP Basic Auth
  // (2026-08-18) — used by outletSync.ts's per-NIP outlet fetch (customer.ts's
  // dokter/customer lookup moved to Exodus 2026-08-27, no longer uses this).
  // Same degrade-gracefully pattern as
  // EXODUS_*/GOOGLE_* above: unset means requests go out unauthenticated
  // (will just get 401'd by Nexus, treated as "no data" by the existing
  // try/catch — never a hard failure), not an env validation error.
  NEXUS_API_USERNAME: z.string().optional(),
  NEXUS_API_PASSWORD: z.string().optional(),
  // Optional — SIPP (Trade Marketing) external API, HR attendance/leave data
  // (see "API - Trade Marketing Documentation.pdf", API Doc. Ver. 1.0.2026;
  // src/lib/sippApi.ts). Feeds the Kepatuhan Absensi pillar of KPI Monitoring
  // (docs/kpi-monitoring/01-business-rules.md §2d) — same degrade-gracefully
  // pattern as EXODUS_*/NEXUS_* above: unset means the sync job skips and
  // absensi stays manual-input-only, never a hard failure.
  SIPP_BASE_URL: z.string().optional(),
  SIPP_CLIENT_ID: z.string().optional(),
  SIPP_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // `next build`'s "Collecting page data" step imports every route module
    // (via Turbopack) to determine static/dynamic behavior — including this
    // file, transitively, even from pages that never touch the DB. Real
    // secrets only exist at container RUNTIME (Vault Agent writes
    // .env.$NAMESPACE, sourced by scripts/start.sh right before the server
    // process starts) — the build image itself never has them. Throwing here
    // broke every production build once a new import chain (customer.ts ->
    // exodusApi.ts -> env.ts) became reachable from page-data collection
    // (2026-08-05 incident: "Environment validation failed: DATABASE_URL/
    // MSSQL_CONNECTION_STRING/SESSION_SECRET ... received undefined" during
    // "Collecting page data", not at actual server startup). Placeholder
    // values here are never used for real I/O — no page does real DB/session
    // work during the build phase, only at request time once the server is
    // actually running (when NEXT_PHASE is no longer phase-production-build
    // and this validation is fully enforced again).
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      return {
        DATABASE_URL: "build-phase-placeholder",
        MSSQL_CONNECTION_STRING: "build-phase-placeholder",
        SESSION_SECRET: "build-phase-placeholder-not-a-real-secret-00",
        EMAIL_FROM: "noreply@example.com",
        RESEND_API_KEY: undefined,
        EXODUS_AUTH_URL: undefined,
        EXODUS_AUTH_CLIENT_ID: undefined,
        EXODUS_AUTH_CLIENT_SECRET: undefined,
        EXODUS_API_BASE_URL: undefined,
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: undefined,
        GOOGLE_SERVICE_ACCOUNT_KEY: undefined,
        NEXUS_API_USERNAME: undefined,
        NEXUS_API_PASSWORD: undefined,
        SIPP_BASE_URL: undefined,
        SIPP_CLIENT_ID: undefined,
        SIPP_CLIENT_SECRET: undefined,
        NODE_ENV: (process.env.NODE_ENV as Env["NODE_ENV"]) ?? "production",
      };
    }
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}

// Validate once at module load. In Next.js dev, this runs each cold start.
export const env = validateEnv();
