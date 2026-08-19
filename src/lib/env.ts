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
  // Optional — Google Drive upload for "Input Data Survey" (see
  // docs/survey-pasien-features/, src/lib/googleDrive.ts). Service account
  // credential JSON, base64-encoded (avoids private-key newline escaping
  // issues in env vars) — set via Vault per deployment, not baked into the
  // image. Feature degrades to a clear "belum dikonfigurasi" error when
  // unset, same pattern as EXODUS_* above.
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  GOOGLE_DRIVE_SURVEY_FOLDER_ID: z.string().optional(),
  // Optional — Nexus API (api-nexus.pharos.id) now requires HTTP Basic Auth
  // (2026-08-18) — used by fetchNexusCustomersByOutlet (customer.ts) and
  // outletSync.ts's per-NIP outlet fetch. Same degrade-gracefully pattern as
  // EXODUS_*/GOOGLE_* above: unset means requests go out unauthenticated
  // (will just get 401'd by Nexus, treated as "no data" by the existing
  // try/catch — never a hard failure), not an env validation error.
  NEXUS_API_USERNAME: z.string().optional(),
  NEXUS_API_PASSWORD: z.string().optional(),
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
        GOOGLE_SERVICE_ACCOUNT_KEY: undefined,
        GOOGLE_DRIVE_SURVEY_FOLDER_ID: undefined,
        NEXUS_API_USERNAME: undefined,
        NEXUS_API_PASSWORD: undefined,
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
