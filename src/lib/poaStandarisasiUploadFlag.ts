/**
 * Temporary kill switch for POA Standarisasi file uploads (Upload Memo,
 * Surat Approval Standarisasi KFT, Form Approval Standarisasi) — added
 * 2026-08-27 while GOOGLE_SERVICE_ACCOUNT_KEY on staging was misconfigured.
 * Re-enabled 2026-08-27 (same day) after staging's env vars were fixed.
 */
export const POA_STANDARISASI_UPLOAD_DISABLED = false;
export const POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE =
  "Upload dokumen sedang dinonaktifkan sementara (konfigurasi Google Drive belum siap) — coba lagi nanti.";
