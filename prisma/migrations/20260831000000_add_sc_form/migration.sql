-- AlterTable
ALTER TABLE "PoaScForm" 
ADD COLUMN     "persenResepDokter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "jumlahKaryawan" INTEGER,
ADD COLUMN     "jumlahPasien" INTEGER,
ADD COLUMN     "jumlahPasienResep" INTEGER,
ADD COLUMN     "jumlahPasienNonResep" INTEGER;