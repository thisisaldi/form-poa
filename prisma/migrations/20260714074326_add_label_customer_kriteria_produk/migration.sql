-- AlterEnum
ALTER TYPE "StatusStandarisasi" ADD VALUE 'TIDAK_TAHU';

-- AlterTable
ALTER TABLE "PoaLineItem" ADD COLUMN     "kriteriaProduk" TEXT,
ADD COLUMN     "labelCustomer" TEXT;
