ALTER TABLE "PoaStandarisasiProduk" ADD COLUMN "spNonSalesJumlahBox" DECIMAL(18,2);

ALTER TABLE "PoaStandarisasi" ADD COLUMN "spNonSalesSubmittedAt" TIMESTAMP(3);

ALTER TABLE "GoogleDriveConfig" ADD COLUMN "spNonSalesFolderId" TEXT;

CREATE TABLE "PoaStandarisasiSpNonSalesDocument" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "uploadedByNip" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiSpNonSalesDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PoaStandarisasiSpNonSalesDocument_pengajuanId_idx" ON "PoaStandarisasiSpNonSalesDocument"("pengajuanId");

ALTER TABLE "PoaStandarisasiSpNonSalesDocument" ADD CONSTRAINT "PoaStandarisasiSpNonSalesDocument_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiSpNonSalesDocument" ADD CONSTRAINT "PoaStandarisasiSpNonSalesDocument_uploadedByNip_fkey" FOREIGN KEY ("uploadedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
