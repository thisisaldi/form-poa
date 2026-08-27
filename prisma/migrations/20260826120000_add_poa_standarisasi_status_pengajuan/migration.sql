-- CreateEnum
CREATE TYPE "StatusPengajuanStandarisasi" AS ENUM ('BARU', 'PERPANJANGAN');

-- AlterTable
ALTER TABLE "PoaStandarisasi" ADD COLUMN     "statusPengajuan" "StatusPengajuanStandarisasi" NOT NULL DEFAULT 'BARU';
