import { google } from "googleapis";
import { Readable } from "stream";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Google Drive upload client for "Input Data Survey" (see
 * docs/survey-pasien-features/) — MR uploads an Excel file from the
 * browser, this forwards it to a shared drive folder via a service
 * account. Optional feature: degrades to a clear "belum dikonfigurasi"
 * error (never a generic 500) when GOOGLE_SERVICE_ACCOUNT_KEY / the
 * destination folder aren't set for this environment — same degradation
 * philosophy as src/lib/exodusApi.ts, except this feature has no fallback
 * "return null" shape (an upload either genuinely succeeds or the caller
 * needs to know it failed), so it throws instead.
 *
 * GOOGLE_SERVICE_ACCOUNT_KEY is the RAW service account JSON key file
 * (paste the whole downloaded .json as-is), not base64-encoded — decided
 * 2026-08-27 (user request) after a base64 mis-encode on staging produced
 * garbled JSON.parse errors; raw JSON is one less encode/decode step to
 * get wrong.
 *
 * The destination folder id is DB-backed (GoogleDriveConfig, singleton row
 * id=1), not GOOGLE_DRIVE_SURVEY_FOLDER_ID env var (retired 2026-08-27, user
 * request) — an ADMIN sets/changes it from the Admin page without a
 * redeploy, same pattern as PoaDoctorsApiCredential. Only the credential
 * itself stays an env var — that's a real secret, unlike a folder id.
 */

export const isGoogleDriveConfigured = !!env.GOOGLE_SERVICE_ACCOUNT_KEY;

/**
 * SAFE-to-log config diagnostics — deliberately never includes the actual
 * credential/private key content, only shape/metadata, so this can be
 * console.error'd from a route without leaking a secret that grants write
 * access to the shared Drive into log aggregators (2026-08-27, user asked
 * to log the raw key — declined that, this is the safe alternative).
 */
export function describeGoogleDriveConfig(): {
  keySet: boolean;
  keyLength: number;
  keyRepairApplied: ReturnType<typeof parseServiceAccountKey>["repairApplied"] | "none";
  keyParsesAsJson: boolean;
  keyParseError: string | null;
  clientEmail: string | null;
  projectId: string | null;
  // Structural facts about private_key ONLY — never its content. A valid PEM
  // block needs real newline characters between header/body/footer; if the
  // JSON's `\n` escape got double-escaped somewhere upstream (`\\n` instead
  // of `\n`), JSON.parse still succeeds (produces a literal 2-char "\n" in
  // the string) but the PEM has zero real line breaks — that's exactly what
  // these 3 fields catch, safely, without exposing the key itself.
  privateKeySet: boolean;
  privateKeyLength: number;
  privateKeyRealNewlineCount: number;
  privateKeyHasLiteralBackslashN: boolean;
  privateKeyStartsWithPemHeader: boolean;
  privateKeyEndsWithPemFooter: boolean;
} {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "";
  let clientEmail: string | null = null;
  let projectId: string | null = null;
  let keyParsesAsJson = false;
  let keyRepairApplied: ReturnType<typeof parseServiceAccountKey>["repairApplied"] | "none" = "none";
  let keyParseError: string | null = null;
  let privateKeySet = false;
  let privateKeyLength = 0;
  let privateKeyRealNewlineCount = 0;
  let privateKeyHasLiteralBackslashN = false;
  let privateKeyStartsWithPemHeader = false;
  let privateKeyEndsWithPemFooter = false;
  if (raw) {
    try {
      const parsed = parseServiceAccountKey(raw);
      keyParsesAsJson = true;
      keyRepairApplied = parsed.repairApplied;
      clientEmail = typeof parsed.credentials.client_email === "string" ? parsed.credentials.client_email : null;
      projectId = typeof parsed.credentials.project_id === "string" ? parsed.credentials.project_id : null;
      const pk = parsed.credentials.private_key;
      if (typeof pk === "string") {
        privateKeySet = true;
        privateKeyLength = pk.length;
        privateKeyRealNewlineCount = (pk.match(/\n/g) ?? []).length;
        privateKeyHasLiteralBackslashN = pk.includes("\\n");
        privateKeyStartsWithPemHeader = pk.trimStart().startsWith("-----BEGIN");
        privateKeyEndsWithPemFooter = pk.trimEnd().endsWith("-----");
      }
    } catch (e) {
      // keyParsesAsJson stays false — the message itself is safe (JSON
      // syntax errors only ever quote surrounding punctuation/position, the
      // credential library never puts secret content in a parse error).
      keyParseError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    keySet: !!raw, keyLength: raw.length, keyRepairApplied, keyParsesAsJson, keyParseError, clientEmail, projectId,
    privateKeySet, privateKeyLength, privateKeyRealNewlineCount, privateKeyHasLiteralBackslashN,
    privateKeyStartsWithPemHeader, privateKeyEndsWithPemFooter,
  };
}

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

/**
 * Trims stray whitespace, then parses GOOGLE_SERVICE_ACCOUNT_KEY as JSON —
 * handling three real, deterministically-recoverable corruption modes seen
 * in practice (2026-08-27 bug reports), tried in order:
 *
 * 1. Double-JSON-encoded: the whole credential JSON got JSON.stringify'd
 *    AGAIN somewhere in the pipeline (e.g. a PowerShell
 *    `Get-Content -Raw | ConvertTo-Json` instead of
 *    `ConvertFrom-Json | ConvertTo-Json` when minifying it to one line) — the
 *    value is then a JSON STRING whose content is the real JSON, escaped.
 *    Plain JSON.parse on that correctly yields a plain string (not an
 *    object); if so, parse once more to unwrap it.
 * 2. Single-quoted (JS object literal syntax, not valid JSON — e.g.
 *    `{'type': 'service_account', ...}`): replacing every `'` with `"` and
 *    reparsing is safe specifically for this credential's known schema — no
 *    field in a GCP service account JSON (type/project_id/private_key/
 *    client_email/etc.) can legitimately contain an apostrophe, and
 *    private_key's base64 PEM body can't either.
 * 3. Escaped-but-unwrapped: the value has `\"` throughout like a JSON
 *    string's CONTENT, but is missing the pair of outer `"..."` quotes that
 *    would make it one (e.g. someone copied case 1's already-double-encoded
 *    value but only the *inside*, not the surrounding quotes — confirmed the
 *    real cause in production via `diag.keyLength`/`keyParseError`).
 *    Wrapping it in one added pair of quotes and parsing AS a JSON string
 *    reproduces exactly what case 1 already unwraps, so it reuses that same
 *    "parse resolves to a string → parse once more" step.
 *
 * This does NOT attempt to guess-repair genuinely malformed JSON beyond
 * these three known, safe, verified transforms — an earlier version of this
 * function naively stripped a leading/trailing quote character, which
 * actively corrupted the double-encoded case instead of fixing it; that
 * approach was wrong and has been removed.
 */
function parseServiceAccountKey(raw: string): { credentials: Record<string, unknown>; repairApplied: "none" | "double-encoded" | "single-quoted" | "escaped-unwrapped" } {
  const trimmed = raw.trim();

  let parsed: unknown;
  let repairApplied: "none" | "double-encoded" | "single-quoted" | "escaped-unwrapped" = "none";
  try {
    parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
      repairApplied = "double-encoded";
    }
  } catch (firstErr) {
    try {
      parsed = JSON.parse(trimmed.replace(/'/g, '"'));
      repairApplied = "single-quoted";
    } catch {
      try {
        const wrapped = JSON.parse(`"${trimmed}"`);
        if (typeof wrapped !== "string") throw new Error("wrap did not yield a string");
        parsed = JSON.parse(wrapped);
        repairApplied = "escaped-unwrapped";
      } catch {
        // None of the 3 known repairs parsed — surface the ORIGINAL error, it's the more meaningful one.
        throw firstErr;
      }
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY tidak berbentuk objek JSON yang valid.");
  }
  return { credentials: normalizePrivateKey(parsed as Record<string, unknown>), repairApplied };
}

/**
 * Rebuilds private_key into a canonical PEM (standard 64-char-wrapped base64
 * body, single header/footer, no stray whitespace) — 2026-08-28 bug report:
 * "error:1E08010C:DECODER routines::unsupported" from Node's OpenSSL 3.x PEM
 * decoder, root cause narrowed down (via a real repro against the exact
 * staging image, node:20-alpine, in Docker) to irregular whitespace INSIDE
 * the base64 body — confirmed an extra blank line alone reproduces the exact
 * error, while re-decoding the base64 (stripping ALL whitespace first, so
 * line width/blank lines/CRLF/trailing spaces don't matter) and re-wrapping
 * it into a standard PEM makes it decode fine again. Verified this doesn't
 * silently corrupt a valid key either — round-tripped sign+verify against
 * several deliberately-mangled variants, all matched a normal key's
 * behavior. Only rewrites what's between the BEGIN/END markers; if
 * private_key isn't PEM-shaped at all, left untouched (caller's error
 * surfaces normally instead of this masking a different, real problem).
 */
function normalizePrivateKey(credentials: Record<string, unknown>): Record<string, unknown> {
  const pk = credentials.private_key;
  if (typeof pk !== "string") return credentials;
  const match = pk.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return credentials;
  const [, type, body] = match;
  const base64 = body.replace(/\s+/g, "");
  const wrapped = (base64.match(/.{1,64}/g) ?? []).join("\n");
  const normalized = `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----\n`;
  if (normalized === pk) return credentials;
  return { ...credentials, private_key: normalized };
}

function getAuth() {
  if (cachedAuth) return cachedAuth;
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY belum dikonfigurasi.");
  }
  const { credentials } = parseServiceAccountKey(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return cachedAuth;
}

async function getSurveyFolderId(): Promise<string | null> {
  const row = await prisma.googleDriveConfig.findUnique({ where: { id: 1 } });
  return row?.surveyFolderId || null;
}

/**
 * Uploads a file buffer to the configured shared drive folder, named exactly
 * as given (caller is responsible for the "[YYYYMMDDHHMM] - Data Survey
 * [Nama RS] Periode [Periode] oleh [Pengaju]" format — see
 * docs/survey-pasien-features/01-business-rules.md §3a). Returns the new
 * file's Drive ID.
 *
 * Throws (never returns null) on failure — an upload the MR believes
 * succeeded must never silently not-exist, so callers must catch and show a
 * real error rather than swallowing it.
 */
export async function uploadFileToSurveyDrive(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<{ driveFileId: string }> {
  if (!isGoogleDriveConfigured) {
    throw new Error("Fitur upload survey belum dikonfigurasi.");
  }
  const folderId = await getSurveyFolderId();
  if (!folderId) {
    throw new Error("Folder Drive tujuan upload belum diset — set di halaman Admin.");
  }

  const drive = google.drive({ version: "v3", auth: getAuth() });
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  if (!res.data.id) {
    throw new Error("Upload ke Google Drive gagal — tidak ada file ID di response.");
  }
  return { driveFileId: res.data.id };
}

/**
 * Fetches a file's bytes from Drive by id — used by the authenticated
 * download proxy for confidential POA Standarisasi documents (NIE/COA/CPOB/
 * Flyer, Bukti TTD, dll — see /api/poa-standarisasi/dokumen/[id]/route.ts).
 * Files are always downloaded through this proxy rather than a raw Drive
 * link so access can be gated by the app's own authz AND logged (2026-08-27,
 * user: dokumen-dokumen ini confidential). "drive.file" scope (same as
 * upload) already covers reading back files this service account created.
 */
export async function downloadFileFromDrive(driveFileId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  if (!isGoogleDriveConfigured) {
    throw new Error("Fitur download belum dikonfigurasi.");
  }

  const drive = google.drive({ version: "v3", auth: getAuth() });
  const meta = await drive.files.get({ fileId: driveFileId, fields: "mimeType,name", supportsAllDrives: true });
  const res = await drive.files.get(
    { fileId: driveFileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType ?? "application/octet-stream",
    fileName: meta.data.name ?? driveFileId,
  };
}
