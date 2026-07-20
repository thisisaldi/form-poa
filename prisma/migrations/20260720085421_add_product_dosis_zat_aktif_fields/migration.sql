-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "dosisKekuatanSediaan" TEXT,
ADD COLUMN     "qtyPerRxPasien" DECIMAL(10,2),
ADD COLUMN     "lamaPemberianHari" INTEGER,
ADD COLUMN     "jumlahPemberianPerHari" DECIMAL(10,2),
ADD COLUMN     "bentukSediaan" TEXT,
ADD COLUMN     "packing" TEXT,
ADD COLUMN     "indikasi" TEXT;
