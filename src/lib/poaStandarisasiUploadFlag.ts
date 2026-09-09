/**
 * Temporary kill switch for POA Standarisasi file uploads (Upload Memo,
 * Surat Approval Standarisasi KFT, Form Approval Standarisasi) — added
 * 2026-08-27 while GOOGLE_SERVICE_ACCOUNT_KEY on staging was misconfigured.
 * Re-enabled 2026-08-27 (same day) after staging's env vars were fixed.
 * Disabled again 2026-08-28 (user request) — upload still erroring, disabled
 * so the rest of the wizard flow can be checked without it blocking Phase
 * progression. Re-enabled 2026-09-09 (user request) — destination folders
 * are now admin-settable (GoogleDriveConfig.kftApprovalFolderId/
 * formApprovalFolderId/spNonSalesFolderId, see googleDrive.ts and
 * GoogleDriveConfigPanel.tsx), an admin just needs to fill those in.
 */
export const POA_STANDARISASI_UPLOAD_DISABLED = false;
export const POA_STANDARISASI_UPLOAD_DISABLED_MESSAGE =
  "Upload dokumen sedang dinonaktifkan sementara — coba lagi nanti.";
