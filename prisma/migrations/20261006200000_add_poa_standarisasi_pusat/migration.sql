-- POA Standarisasi Pusat (Hospital Key Account) — docs/poa-standarisasi-pusat/
ALTER TABLE "User" ADD COLUMN "isHka" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Outlet" ADD COLUMN "hkaGroup" TEXT;
CREATE INDEX "Outlet_hkaGroup_idx" ON "Outlet"("hkaGroup");

CREATE TYPE "PoaStandarisasiPusatPhase" AS ENUM ('APPROVAL_ATASAN', 'APPROVAL_USER_DOKTER', 'FINALISASI');

CREATE TABLE "PoaStandarisasiPusat" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "hkaGroup" TEXT NOT NULL,
    "tipeStandarisasi" "TipeStandarisasi" NOT NULL,
    "periodeBulan" INTEGER,
    "currentPhase" "PoaStandarisasiPusatPhase" NOT NULL DEFAULT 'APPROVAL_ATASAN',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaStandarisasiPusat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PoaStandarisasiPusat_hkaGroup_submittedAt_idx" ON "PoaStandarisasiPusat"("hkaGroup", "submittedAt");
CREATE INDEX "PoaStandarisasiPusat_ownerId_idx" ON "PoaStandarisasiPusat"("ownerId");
CREATE INDEX "PoaStandarisasiPusat_currentPhase_idx" ON "PoaStandarisasiPusat"("currentPhase");

CREATE TABLE "PoaStandarisasiPusatProduk" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "skemaPembayaran" "SkemaPembayaranStandarisasi" NOT NULL DEFAULT 'DISKON',
    "estimasiDiskonPct" DECIMAL(10,4),
    "estimasiDiskonDistributorPct" DECIMAL(10,4),
    "estimasiValueDpRp" DECIMAL(18,2),
    "catatan" TEXT,

    CONSTRAINT "PoaStandarisasiPusatProduk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PoaStandarisasiPusatProduk_pengajuanId_kodeProduk_key" ON "PoaStandarisasiPusatProduk"("pengajuanId", "kodeProduk");
CREATE INDEX "PoaStandarisasiPusatProduk_pengajuanId_idx" ON "PoaStandarisasiPusatProduk"("pengajuanId");

CREATE TABLE "PoaStandarisasiPusatProdukApproval" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "level" "ApprovalLevelStandarisasi" NOT NULL,
    "status" "StatusApprovalAtasan" NOT NULL DEFAULT 'MENUNGGU',
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "decidedByNip" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PoaStandarisasiPusatProdukApproval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PoaStandarisasiPusatProdukApproval_produkId_level_key" ON "PoaStandarisasiPusatProdukApproval"("produkId", "level");
CREATE INDEX "PoaStandarisasiPusatProdukApproval_produkId_idx" ON "PoaStandarisasiPusatProdukApproval"("produkId");

CREATE TABLE "PoaStandarisasiPusatDokter" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "wajib" BOOLEAN NOT NULL DEFAULT true,
    "sudahTtd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiPusatDokter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PoaStandarisasiPusatDokter_produkId_customerId_key" ON "PoaStandarisasiPusatDokter"("produkId", "customerId");
CREATE INDEX "PoaStandarisasiPusatDokter_produkId_idx" ON "PoaStandarisasiPusatDokter"("produkId");

ALTER TABLE "PoaStandarisasiPusat" ADD CONSTRAINT "PoaStandarisasiPusat_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatProduk" ADD CONSTRAINT "PoaStandarisasiPusatProduk_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasiPusat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatProduk" ADD CONSTRAINT "PoaStandarisasiPusatProduk_kodeProduk_fkey" FOREIGN KEY ("kodeProduk") REFERENCES "Product"("kodeProduk") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatProdukApproval" ADD CONSTRAINT "PoaStandarisasiPusatProdukApproval_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiPusatProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatDokter" ADD CONSTRAINT "PoaStandarisasiPusatDokter_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiPusatProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiPusatDokter" ADD CONSTRAINT "PoaStandarisasiPusatDokter_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
