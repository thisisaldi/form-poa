-- AlterTable
ALTER TABLE "PoaStandarisasi"
  ADD COLUMN "spNonSalesMemoNomor" TEXT,
  ADD COLUMN "spNonSalesMemoAlasan" TEXT,
  ADD COLUMN "spNonSalesMemoNoSp" TEXT,
  ADD COLUMN "spNonSalesMemoGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "spNonSalesMemoDriveFileId" TEXT,
  ADD COLUMN "spNonSalesSignedAt" TIMESTAMP(3),
  ADD COLUMN "spNonSalesSignedByNip" TEXT;

-- AlterTable
ALTER TABLE "GoogleDriveConfig"
  ADD COLUMN "spNonSalesMemoSignerHormatKami" TEXT,
  ADD COLUMN "spNonSalesMemoSignerMenyetujui" TEXT;

-- CreateTable
CREATE TABLE "SpNonSalesMemoCounter" (
    "periode" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SpNonSalesMemoCounter_pkey" PRIMARY KEY ("periode")
);
