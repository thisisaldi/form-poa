-- POA Standarisasi Pusat — kesamaan layout dengan cabang (docs/poa-standarisasi-pusat/04-layout-parity.md). Hanya kolom/tabel baru, semua nullable atau ber-default.
ALTER TABLE "PoaStandarisasiPusat" ADD COLUMN "estimasiTimelineSelesai" TIMESTAMP(3);

ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "estimasiBiayaListingRp" DECIMAL(18,2);
ALTER TABLE "PoaStandarisasiPusatProduk" ADD COLUMN "statusPengajuan" "StatusPengajuanStandarisasi" NOT NULL DEFAULT 'BARU';

ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "jumlahPasien" INTEGER;
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "jumlahHariPraktekPerBulan" INTEGER;
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "resepPerPasienSt" DECIMAL(10,2);
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "estimasiQtyPerBulan" DECIMAL(18,2);
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "estimasiQtyUbPerBulan" INTEGER;
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "estimasiNilaiRpPerBulan" DECIMAL(18,2);
ALTER TABLE "PoaStandarisasiPusatDokter" ADD COLUMN "entertainRp" DECIMAL(18,2);

CREATE TABLE "PoaStandarisasiPusatKpdm" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "namaSnapshot" TEXT NOT NULL,
    "jabatanSnapshot" TEXT,
    "entertainEstimasi" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiPusatKpdm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PoaStandarisasiPusatKpdm_pengajuanId_customerId_key" ON "PoaStandarisasiPusatKpdm"("pengajuanId", "customerId");
CREATE INDEX "PoaStandarisasiPusatKpdm_pengajuanId_idx" ON "PoaStandarisasiPusatKpdm"("pengajuanId");
ALTER TABLE "PoaStandarisasiPusatKpdm" ADD CONSTRAINT "PoaStandarisasiPusatKpdm_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasiPusat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatKpdm" ADD CONSTRAINT "PoaStandarisasiPusatKpdm_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
