CREATE TYPE "SkemaPembayaranStandarisasi" AS ENUM ('DISKON', 'DP');

ALTER TABLE "PoaStandarisasiProduk" ADD COLUMN "skemaPembayaran" "SkemaPembayaranStandarisasi" NOT NULL DEFAULT 'DISKON';
ALTER TABLE "PoaStandarisasiProduk" ADD COLUMN "estimasiValueDpRp" DECIMAL(18,2);
