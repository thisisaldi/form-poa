-- POA Standarisasi Pusat — Finalisasi sama dengan cabang: dokter yang akan menjadi user + estimasi, biaya final, entertain KPDM final. Hanya kolom nullable dan satu tabel baru.
ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "finalDiscountPct" DECIMAL(10,4);
ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "diskonDistributorPct" DECIMAL(10,4);
ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "finalBiayaListingRp" DECIMAL(18,2);
ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "finalValueDpRp" DECIMAL(18,2);

ALTER TABLE "PoaStandarisasiPusatKpdm" ADD COLUMN "entertainFinal" DECIMAL(18,2);

CREATE TABLE "PoaStandarisasiPusatDokterUser" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "jumlahPasien" INTEGER,
    "jumlahHariPraktekPerBulan" INTEGER,
    "resepPerPasienSt" DECIMAL(10,2),
    "estimasiQtyPerBulan" DECIMAL(18,2),
    "estimasiQtyUbPerBulan" INTEGER,
    "estimasiSalesRpPerBulan" DECIMAL(18,2),
    "entertainRp" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiPusatDokterUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PoaStandarisasiPusatDokterUser_produkId_customerId_key" ON "PoaStandarisasiPusatDokterUser"("produkId", "customerId");
CREATE INDEX "PoaStandarisasiPusatDokterUser_produkId_idx" ON "PoaStandarisasiPusatDokterUser"("produkId");
ALTER TABLE "PoaStandarisasiPusatDokterUser" ADD CONSTRAINT "PoaStandarisasiPusatDokterUser_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiPusatProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatDokterUser" ADD CONSTRAINT "PoaStandarisasiPusatDokterUser_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
