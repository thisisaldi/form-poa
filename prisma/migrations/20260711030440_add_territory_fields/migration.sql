-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "kodeArea" TEXT,
ADD COLUMN     "kodeGT" TEXT,
ADD COLUMN     "kodeReg" TEXT,
ADD COLUMN     "kodeSub" TEXT,
ADD COLUMN     "namaArea" TEXT,
ADD COLUMN     "namaGT" TEXT,
ADD COLUMN     "namaReg" TEXT,
ADD COLUMN     "namaSub" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kodeWilayah" TEXT,
ADD COLUMN     "namaWilayah" TEXT;
