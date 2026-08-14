-- CreateEnum
CREATE TYPE "PoaStandarisasiPhase" AS ENUM ('PLANNING', 'APPROVAL_ATASAN', 'APPROVAL_USER_DOKTER', 'FINALISASI');

-- CreateEnum
CREATE TYPE "TipeStandarisasi" AS ENUM ('PERIODIC', 'SISIPAN', 'PERMANEN');

-- CreateEnum
CREATE TYPE "StatusApprovalAtasan" AS ENUM ('MENUNGGU', 'DISETUJUI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "DokumenStandarisasiJenis" AS ENUM ('NIE', 'CPOB', 'KFA', 'SP_NON_SALES');

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "jumlahBed" INTEGER;

-- CreateTable
CREATE TABLE "KpdmStandarisasi" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jabatanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpdmStandarisasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JabatanStandarisasi" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JabatanStandarisasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaStandarisasi" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "kpdmId" TEXT NOT NULL,
    "kpdmNamaSnapshot" TEXT NOT NULL,
    "jabatanNamaSnapshot" TEXT,
    "kpdmEntertainEstimasi" DECIMAL(18,2),
    "kpdmEntertainFinal" DECIMAL(18,2),
    "tipeStandarisasi" "TipeStandarisasi" NOT NULL,
    "periodeBulan" INTEGER,
    "jumlahBedRs" INTEGER,
    "estimasiTimelineSelesai" TIMESTAMP(3),
    "currentPhase" "PoaStandarisasiPhase" NOT NULL DEFAULT 'PLANNING',
    "statusApprovalAsm" "StatusApprovalAtasan" NOT NULL DEFAULT 'MENUNGGU',
    "statusApprovalSm" "StatusApprovalAtasan" NOT NULL DEFAULT 'MENUNGGU',
    "tanggalApprovalAsm" TIMESTAMP(3),
    "tanggalApprovalSm" TIMESTAMP(3),
    "jadwalMeetingKft" TIMESTAMP(3),
    "distributorId" TEXT,
    "suratApprovalStandarisasiKftPath" TEXT,
    "suratApprovalStandarisasiKftDriveFileId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaStandarisasiProduk" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "jumlahPasien" INTEGER,
    "resepPerPasienSt" DECIMAL(10,2),
    "estimasiQtyPerBulan" DECIMAL(18,2),
    "estimasiNilaiRpPerBulan" DECIMAL(18,2),
    "estimasiDiskonPct" DECIMAL(10,4),
    "estimasiBiayaListingRp" DECIMAL(18,2),
    "estimasiEntertainRp" DECIMAL(18,2),
    "finalDiscountPct" DECIMAL(10,4),
    "diskonDistributorPct" DECIMAL(10,4),
    "finalBiayaListingRp" DECIMAL(18,2),
    "formApprovalFilePath" TEXT,
    "formApprovalDriveFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiProduk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaStandarisasiDokterApproval" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "wajib" BOOLEAN NOT NULL DEFAULT true,
    "sudahTtd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiDokterApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaStandarisasiDokterUser" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "jumlahPasien" INTEGER,
    "resepPerPasienSt" DECIMAL(10,2),
    "estimasiQtyPerBulan" DECIMAL(18,2),
    "estimasiSalesRpPerBulan" DECIMAL(18,2),
    "entertainRp" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiDokterUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaStandarisasiDokumen" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "jenis" "DokumenStandarisasiJenis" NOT NULL,
    "namaFile" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiDokumen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpdmStandarisasi_nama_key" ON "KpdmStandarisasi"("nama");

-- CreateIndex
CREATE INDEX "KpdmStandarisasi_nama_idx" ON "KpdmStandarisasi"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "JabatanStandarisasi_nama_key" ON "JabatanStandarisasi"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_nama_key" ON "Distributor"("nama");

-- CreateIndex
CREATE INDEX "PoaStandarisasi_ownerId_idx" ON "PoaStandarisasi"("ownerId");

-- CreateIndex
CREATE INDEX "PoaStandarisasi_kodePI_idx" ON "PoaStandarisasi"("kodePI");

-- CreateIndex
CREATE INDEX "PoaStandarisasi_currentPhase_idx" ON "PoaStandarisasi"("currentPhase");

-- CreateIndex
CREATE INDEX "PoaStandarisasiProduk_pengajuanId_idx" ON "PoaStandarisasiProduk"("pengajuanId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaStandarisasiProduk_pengajuanId_kodeProduk_key" ON "PoaStandarisasiProduk"("pengajuanId", "kodeProduk");

-- CreateIndex
CREATE INDEX "PoaStandarisasiDokterApproval_produkId_idx" ON "PoaStandarisasiDokterApproval"("produkId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaStandarisasiDokterApproval_produkId_customerId_key" ON "PoaStandarisasiDokterApproval"("produkId", "customerId");

-- CreateIndex
CREATE INDEX "PoaStandarisasiDokterUser_produkId_idx" ON "PoaStandarisasiDokterUser"("produkId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaStandarisasiDokterUser_produkId_customerId_key" ON "PoaStandarisasiDokterUser"("produkId", "customerId");

-- CreateIndex
CREATE INDEX "PoaStandarisasiDokumen_produkId_idx" ON "PoaStandarisasiDokumen"("produkId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaStandarisasiDokumen_produkId_jenis_key" ON "PoaStandarisasiDokumen"("produkId", "jenis");

-- AddForeignKey
ALTER TABLE "KpdmStandarisasi" ADD CONSTRAINT "KpdmStandarisasi_jabatanId_fkey" FOREIGN KEY ("jabatanId") REFERENCES "JabatanStandarisasi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasi" ADD CONSTRAINT "PoaStandarisasi_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasi" ADD CONSTRAINT "PoaStandarisasi_kodePI_fkey" FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasi" ADD CONSTRAINT "PoaStandarisasi_kpdmId_fkey" FOREIGN KEY ("kpdmId") REFERENCES "KpdmStandarisasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasi" ADD CONSTRAINT "PoaStandarisasi_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiProduk" ADD CONSTRAINT "PoaStandarisasiProduk_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiProduk" ADD CONSTRAINT "PoaStandarisasiProduk_kodeProduk_fkey" FOREIGN KEY ("kodeProduk") REFERENCES "Product"("kodeProduk") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiDokterApproval" ADD CONSTRAINT "PoaStandarisasiDokterApproval_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiDokterApproval" ADD CONSTRAINT "PoaStandarisasiDokterApproval_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiDokterUser" ADD CONSTRAINT "PoaStandarisasiDokterUser_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiDokterUser" ADD CONSTRAINT "PoaStandarisasiDokterUser_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaStandarisasiDokumen" ADD CONSTRAINT "PoaStandarisasiDokumen_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

