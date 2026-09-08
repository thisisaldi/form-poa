CREATE TABLE "PoaStandarisasiDokterReassignLog" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "oldCustomerId" TEXT NOT NULL,
    "oldNamaSnapshot" TEXT NOT NULL,
    "newCustomerId" TEXT NOT NULL,
    "newNamaSnapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorNip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiDokterReassignLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PoaStandarisasiDokterReassignLog_produkId_idx" ON "PoaStandarisasiDokterReassignLog"("produkId");

ALTER TABLE "PoaStandarisasiDokterReassignLog" ADD CONSTRAINT "PoaStandarisasiDokterReassignLog_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiDokterReassignLog" ADD CONSTRAINT "PoaStandarisasiDokterReassignLog_actorNip_fkey" FOREIGN KEY ("actorNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
