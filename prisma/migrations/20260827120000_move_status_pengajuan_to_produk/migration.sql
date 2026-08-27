-- AlterTable: add statusPengajuan to PoaStandarisasiProduk (per-produk, was per-pengajuan)
ALTER TABLE "PoaStandarisasiProduk" ADD COLUMN     "statusPengajuan" "StatusPengajuanStandarisasi" NOT NULL DEFAULT 'BARU';

-- Backfill: carry each pengajuan's old value down to its own produk rows before dropping it
UPDATE "PoaStandarisasiProduk" p
SET "statusPengajuan" = pi."statusPengajuan"
FROM "PoaStandarisasi" pi
WHERE p."pengajuanId" = pi.id;

-- AlterTable: drop the now-superseded pengajuan-level column
ALTER TABLE "PoaStandarisasi" DROP COLUMN "statusPengajuan";
