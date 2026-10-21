-- Faktur diskon kompetitor (opsional) per produk POA Standarisasi.
ALTER TABLE "PoaStandarisasiProduk"
    ADD COLUMN "diskonKompetitorFakturPath" TEXT,
    ADD COLUMN "diskonKompetitorFakturDriveFileId" TEXT;
