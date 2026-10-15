-- MCL (docs/mcl-rekomendasi-dokter/): status listing outlet x produk + rekomendasi dokter dari Excel internal.
-- Dua tabel baru, diisi sekali oleh scripts/importMclRekomendasi.ts. Tidak ada FK keras (baris Excel tetap tampil walau dokter/produk belum terdaftar).
CREATE TYPE "ListingStatusExcel" AS ENUM ('SUDAH_LISTING', 'BELUM_LISTING', 'PRODUK_TIDAK_ADA', 'OUTLET_TIDAK_ADA');

CREATE TABLE "OutletProdukListing" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "status" "ListingStatusExcel" NOT NULL,
    "importBatch" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletProdukListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutletProdukListing_kodePI_kodeProduk_key" ON "OutletProdukListing"("kodePI", "kodeProduk");
CREATE INDEX "OutletProdukListing_kodePI_idx" ON "OutletProdukListing"("kodePI");

CREATE TABLE "MclRekomendasiDokter" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "namaDokter" TEXT NOT NULL,
    "namaNormalized" TEXT NOT NULL,
    "spesialis" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "keterangan" TEXT,
    "estimasiAktif" DECIMAL(18,2),
    "pelunasan" DECIMAL(18,2),
    "customerId" TEXT,
    "matchTier" TEXT NOT NULL,
    "importBatch" TEXT NOT NULL,

    CONSTRAINT "MclRekomendasiDokter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MclRekomendasiDokter_kodePI_namaNormalized_spesialis_kodeProduk_key" ON "MclRekomendasiDokter"("kodePI", "namaNormalized", "spesialis", "kodeProduk");
CREATE INDEX "MclRekomendasiDokter_kodePI_idx" ON "MclRekomendasiDokter"("kodePI");
