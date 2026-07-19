-- CreateEnum
CREATE TYPE "JenisPssp" AS ENUM ('PSSP', 'PSSP_RETENSI', 'PSSP_PEREMAJAAN', 'PSSP_PERPANJANGAN');

-- AlterTable
ALTER TABLE "PoaLineItem" ADD COLUMN     "jenisPssp" "JenisPssp";
