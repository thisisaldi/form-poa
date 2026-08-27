/**
 * Temporary kill switch for POA Standarisasi file uploads (Upload Memo,
 * Surat Approval Standarisasi KFT, Form Approval Standarisasi) — 2026-08-27
 * user request: GOOGLE_SERVICE_ACCOUNT_KEY on staging doesn't match the code
 * yet (still base64, code now expects raw JSON), every upload attempt fails.
 * Rather than let users keep hitting a broken upload, disable the feature
 * client- and server-side until the env var is fixed. Flip back to false
 * once staging's credential is corrected — no other cleanup needed.
 */
export const POA_STANDARISASI_UPLOAD_DISABLED = true;
export const POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE =
  "Upload dokumen sedang dinonaktifkan sementara (konfigurasi Google Drive belum siap) — coba lagi nanti.";
