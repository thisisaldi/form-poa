-- Pengaturan fitur yang bisa diubah ADMIN tanpa deploy (src/lib/appSettingsRegistry.ts). Tanpa seed: default ada di kode.
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
