-- CreateTable
CREATE TABLE "PoaStandarisasiKpdm" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "namaSnapshot" TEXT NOT NULL,
    "jabatanSnapshot" TEXT,
    "entertainEstimasi" DECIMAL(18,2),
    "entertainFinal" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiKpdm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaStandarisasiKpdm_pengajuanId_idx" ON "PoaStandarisasiKpdm"("pengajuanId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaStandarisasiKpdm_pengajuanId_customerId_key" ON "PoaStandarisasiKpdm"("pengajuanId", "customerId");

-- AddForeignKey
ALTER TABLE "PoaStandarisasiKpdm" ADD CONSTRAINT "PoaStandarisasiKpdm_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiKpdm" ADD CONSTRAINT "PoaStandarisasiKpdm_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: carry existing single-KPDM pengajuan over into the new child
-- table before dropping the old columns, instead of discarding real test
-- work (kpdmId nullable already handles pengajuan with no KPDM set).
INSERT INTO "PoaStandarisasiKpdm" ("id", "pengajuanId", "customerId", "namaSnapshot", "jabatanSnapshot", "entertainEstimasi", "entertainFinal", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "kpdmId", "kpdmNamaSnapshot", "jabatanNamaSnapshot", "kpdmEntertainEstimasi", "kpdmEntertainFinal", now(), now()
FROM "PoaStandarisasi"
WHERE "kpdmId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "PoaStandarisasi" DROP CONSTRAINT "PoaStandarisasi_kpdmId_fkey";

-- AlterTable
ALTER TABLE "PoaStandarisasi" DROP COLUMN "jabatanNamaSnapshot",
DROP COLUMN "kpdmEntertainEstimasi",
DROP COLUMN "kpdmEntertainFinal",
DROP COLUMN "kpdmId",
DROP COLUMN "kpdmNamaSnapshot";
