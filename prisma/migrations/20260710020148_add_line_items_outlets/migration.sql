/*
  Warnings:

  - You are about to drop the column `data` on the `PoaForm` table. All the data in the column will be lost.
  - You are about to drop the `MasterDataRecord` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "StatusStandarisasi" AS ENUM ('SUDAH_STANDARISASI', 'PROSES_PENGAJUAN', 'BELUM_STANDARISASI');

-- AlterTable
ALTER TABLE "PoaAuditLog" ALTER COLUMN "snapshot" SET DEFAULT '{}';

-- AlterTable
ALTER TABLE "PoaForm" DROP COLUMN "data";

-- DropTable
DROP TABLE "MasterDataRecord";

-- CreateTable
CREATE TABLE "PoaLineItem" (
    "id" TEXT NOT NULL,
    "poaId" TEXT NOT NULL,
    "kodeRequest" TEXT NOT NULL,
    "kodeCust" TEXT NOT NULL,
    "namaCust" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "spesialisasi" TEXT NOT NULL,
    "historisPSSP" TEXT,
    "kodePI" TEXT,
    "namaOutlet" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "namaProduk" TEXT NOT NULL,
    "kategoriProdukFokus" TEXT NOT NULL,
    "itemKode" TEXT NOT NULL,
    "satuanTerkecil" TEXT NOT NULL,
    "produkKompetitor" TEXT,
    "statusStandarisasi" "StatusStandarisasi",
    "hariKerjaBulan" INTEGER,
    "jumlahPasienHari" INTEGER,
    "jumlahResepHari" INTEGER,
    "qtyProdukResep" INTEGER,
    "lamaPeriode" INTEGER NOT NULL,
    "periodeAwal" TEXT NOT NULL,
    "rencanaTotalBiaya" DECIMAL(18,2) NOT NULL,
    "rencanaVisitMinggu" INTEGER NOT NULL,
    "nilaiR" DECIMAL(18,2),
    "historySales3Bln" DECIMAL(18,2),
    "avgDiskon" DECIMAL(18,4),
    "hargaSatuanTerkecil" DECIMAL(18,2),
    "estimasiPSSPBulan" DECIMAL(18,2),
    "totalEstimasiPSSPBulan" DECIMAL(18,2),
    "pengaliNilaiR" DECIMAL(18,4),
    "rekomendasiBiayaBulan" DECIMAL(18,2),
    "totalRekomendasiBiayaBulan" DECIMAL(18,2),
    "estimasiPSSPPeriode" DECIMAL(18,2),
    "totalEstimasiPSSPPeriode" DECIMAL(18,2),
    "rekomendasiBiayaPeriode" DECIMAL(18,2),
    "totalRekomendasiBiayaPeriode" DECIMAL(18,2),
    "rasioRekomenEstimasi" DECIMAL(18,4),
    "rasioRencanaBiayaEstimasi" DECIMAL(18,4),
    "totalPersenBudget" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "kodePI" TEXT NOT NULL,
    "namaOutlet" TEXT NOT NULL,
    "outCode" TEXT,
    "statusOutlet" TEXT,
    "namaChannel" TEXT,
    "sector" TEXT,
    "subSektor" TEXT,
    "kota" TEXT,
    "propinsi" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("kodePI")
);

-- CreateTable
CREATE TABLE "MrOutletAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MrOutletAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaLineItem_poaId_idx" ON "PoaLineItem"("poaId");

-- CreateIndex
CREATE INDEX "PoaLineItem_kodeRequest_idx" ON "PoaLineItem"("kodeRequest");

-- CreateIndex
CREATE INDEX "Outlet_statusOutlet_idx" ON "Outlet"("statusOutlet");

-- CreateIndex
CREATE INDEX "Outlet_sector_idx" ON "Outlet"("sector");

-- CreateIndex
CREATE INDEX "MrOutletAssignment_userId_idx" ON "MrOutletAssignment"("userId");

-- CreateIndex
CREATE INDEX "MrOutletAssignment_kodePI_idx" ON "MrOutletAssignment"("kodePI");

-- CreateIndex
CREATE UNIQUE INDEX "MrOutletAssignment_userId_kodePI_key" ON "MrOutletAssignment"("userId", "kodePI");

-- AddForeignKey
ALTER TABLE "PoaLineItem" ADD CONSTRAINT "PoaLineItem_poaId_fkey" FOREIGN KEY ("poaId") REFERENCES "PoaForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrOutletAssignment" ADD CONSTRAINT "MrOutletAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrOutletAssignment" ADD CONSTRAINT "MrOutletAssignment_kodePI_fkey" FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE CASCADE ON UPDATE CASCADE;
