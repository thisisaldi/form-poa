-- CreateTable
CREATE TABLE "PoaStandarisasiFileAccessLog" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accessedByNip" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiFileAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaStandarisasiFileAccessLog_pengajuanId_idx" ON "PoaStandarisasiFileAccessLog"("pengajuanId");

-- CreateIndex
CREATE INDEX "PoaStandarisasiFileAccessLog_driveFileId_idx" ON "PoaStandarisasiFileAccessLog"("driveFileId");

-- AddForeignKey
ALTER TABLE "PoaStandarisasiFileAccessLog" ADD CONSTRAINT "PoaStandarisasiFileAccessLog_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiFileAccessLog" ADD CONSTRAINT "PoaStandarisasiFileAccessLog_accessedByNip_fkey" FOREIGN KEY ("accessedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
