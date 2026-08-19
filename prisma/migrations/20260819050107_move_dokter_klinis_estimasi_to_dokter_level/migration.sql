/*
  Warnings:

  - You are about to drop the column `estimasiEntertainRp` on the `PoaStandarisasiProduk` table. All the data in the column will be lost.
  - You are about to drop the column `estimasiNilaiRpPerBulan` on the `PoaStandarisasiProduk` table. All the data in the column will be lost.
  - You are about to drop the column `estimasiQtyPerBulan` on the `PoaStandarisasiProduk` table. All the data in the column will be lost.
  - You are about to drop the column `jumlahPasien` on the `PoaStandarisasiProduk` table. All the data in the column will be lost.
  - You are about to drop the column `resepPerPasienSt` on the `PoaStandarisasiProduk` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PoaStandarisasiDokterApproval" ADD COLUMN     "entertainRp" DECIMAL(18,2),
ADD COLUMN     "estimasiNilaiRpPerBulan" DECIMAL(18,2),
ADD COLUMN     "estimasiQtyPerBulan" DECIMAL(18,2),
ADD COLUMN     "jumlahPasien" INTEGER,
ADD COLUMN     "resepPerPasienSt" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PoaStandarisasiProduk" DROP COLUMN "estimasiEntertainRp",
DROP COLUMN "estimasiNilaiRpPerBulan",
DROP COLUMN "estimasiQtyPerBulan",
DROP COLUMN "jumlahPasien",
DROP COLUMN "resepPerPasienSt";
