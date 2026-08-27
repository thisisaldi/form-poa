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
  keyWasQuoteWrapped: boolean;
  keyParsesAsJson: boolean;
  clientEmail: string | null;
  projectId: string | null;
} {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "";
  const cleaned = raw ? cleanServiceAccountKeyRaw(raw) : "";
  let clientEmail: string | null = null;
  let projectId: string | null = null;
  let keyParsesAsJson = false;
  if (cleaned) {
    try {
      const parsed = JSON.parse(cleaned);
      keyParsesAsJson = true;
      clientEmail = typeof parsed.client_email === "string" ? parsed.client_email : null;
      projectId = typeof parsed.project_id === "string" ? parsed.project_id : null;
    } catch {
      // leave keyParsesAsJson false — that alone is the useful signal
    }
  }
  return { keySet: !!raw, keyLength: raw.length, keyWasQuoteWrapped: cleaned !== raw.trim(), keyParsesAsJson, clientEmail, projectId };
}

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

/**
 * Trims stray whitespace and strips one layer of wrapping quotes some secret
 * managers add when a value gets exported/pasted (e.g. `"{...}"` instead of
 * `{...}`) — deterministic cleanup only, never guesses at repairing actually
 * malformed JSON, so this can't silently produce a wrong/corrupted credential.
 */
function cleanServiceAccountKeyRaw(raw: string): string {
  const trimmed = raw.trim();
  const wrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return wrapped ? trimmed.slice(1, -1) : trimmed;
}

function getAuth() {
  if (cachedAuth) return cachedAuth;
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY belum dikonfigurasi.");
  }
  const credentials = JSON.parse(cleanServiceAccountKeyRaw(env.GOOGLE_SERVICE_ACCOUNT_KEY));
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
