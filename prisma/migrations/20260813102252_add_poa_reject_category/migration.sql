-- CreateEnum
CREATE TYPE "PoaRejectCategory" AS ENUM ('PRODUK', 'OUTLET', 'USER', 'PERIODE', 'KALKULASI_PSSP', 'ALASAN_LAIN');

-- AlterTable
ALTER TABLE "PoaAuditLog" ADD COLUMN     "rejectCategory" "PoaRejectCategory";

