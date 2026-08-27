import { google } from "googleapis";
import { Readable } from "stream";
import { env } from "@/lib/env";

/**
 * Google Drive upload client for "Input Data Survey" (see
 * docs/survey-pasien-features/) — MR uploads an Excel file from the
 * browser, this forwards it to a shared drive folder via a service
 * account. Optional feature: degrades to a clear "belum dikonfigurasi"
 * error (never a generic 500) when GOOGLE_SERVICE_ACCOUNT_KEY /
 * GOOGLE_DRIVE_SURVEY_FOLDER_ID aren't set for this environment — same
 * degradation philosophy as src/lib/exodusApi.ts, except this feature has
 * no fallback "return null" shape (an upload either genuinely succeeds or
 * the caller needs to know it failed), so it throws instead.
 */

export const isGoogleDriveConfigured =
  !!env.GOOGLE_SERVICE_ACCOUNT_KEY && !!env.GOOGLE_DRIVE_SURVEY_FOLDER_ID;

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY belum dikonfigurasi.");
  }
  const credentialsJson = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY, "base64").toString("utf-8");
  const credentials = JSON.parse(credentialsJson);
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return cachedAuth;
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

  const drive = google.drive({ version: "v3", auth: getAuth() });
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [env.GOOGLE_DRIVE_SURVEY_FOLDER_ID!],
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
