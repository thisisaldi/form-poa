-- CreateTable
CREATE TABLE "GoogleDriveConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "surveyFolderId" TEXT NOT NULL,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveConfig_pkey" PRIMARY KEY ("id")
);

-- Seed row 1 with the current GOOGLE_DRIVE_SURVEY_FOLDER_ID env value so this
-- migration doesn't regress the feature — env var is being retired in favor
-- of this ADMIN-settable table (2026-08-27, user request), not a secret.
INSERT INTO "GoogleDriveConfig" ("id", "surveyFolderId", "updatedAt")
VALUES (1, '0AJOb8OaV5DWvUk9PVA', CURRENT_TIMESTAMP);
