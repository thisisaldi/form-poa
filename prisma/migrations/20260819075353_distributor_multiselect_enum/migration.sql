/*
  Warnings:

  - You are about to drop the column `distributorId` on the `PoaStandarisasi` table. All the data in the column will be lost.
  - You are about to drop the `Distributor` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DistributorPilihan" AS ENUM ('AMS', 'PPG', 'MPI');

-- DropForeignKey
ALTER TABLE "PoaStandarisasi" DROP CONSTRAINT "PoaStandarisasi_distributorId_fkey";

-- AlterTable
ALTER TABLE "PoaStandarisasi" DROP COLUMN "distributorId",
ADD COLUMN     "distributors" "DistributorPilihan"[] DEFAULT ARRAY[]::"DistributorPilihan"[];

-- DropTable
DROP TABLE "Distributor";
