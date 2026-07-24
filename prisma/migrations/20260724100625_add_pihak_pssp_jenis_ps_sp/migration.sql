-- CreateEnum
CREATE TYPE "PihakPssp" AS ENUM ('USER', 'KPDM');

-- CreateEnum
CREATE TYPE "PsSp" AS ENUM ('PS', 'SP');

-- AlterTable
ALTER TABLE "PoaLineItem" ADD COLUMN     "jenisPsSp" "PsSp",
ADD COLUMN     "pihakPssp" "PihakPssp" NOT NULL DEFAULT 'USER';
