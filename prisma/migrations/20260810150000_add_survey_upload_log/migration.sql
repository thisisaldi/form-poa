-- Audit trail for "Input Data Survey" (docs/survey-pasien-features/, item #10
-- dari daftar 13 task 2026-08-10) — MR upload file Excel, diteruskan ke
-- shared Google Drive via service account. App tidak parse isi file, cuma
-- jadi perantara upload + catat siapa-upload-apa-kapan.
CREATE TABLE "SurveyUploadLog" (
    "id" TEXT NOT NULL,
    "uploaderNip" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "namaFile" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyUploadLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SurveyUploadLog_uploaderNip_idx" ON "SurveyUploadLog"("uploaderNip");

CREATE INDEX "SurveyUploadLog_kodePI_idx" ON "SurveyUploadLog"("kodePI");

CREATE INDEX "SurveyUploadLog_periode_idx" ON "SurveyUploadLog"("periode");

ALTER TABLE "SurveyUploadLog" ADD CONSTRAINT "SurveyUploadLog_uploaderNip_fkey" FOREIGN KEY ("uploaderNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SurveyUploadLog" ADD CONSTRAINT "SurveyUploadLog_kodePI_fkey" FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE RESTRICT ON UPDATE CASCADE;
