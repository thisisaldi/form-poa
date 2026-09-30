-- Approval level dinamis per produk POA Standarisasi (level dari Disc PI).
CREATE TYPE "ApprovalLevelStandarisasi" AS ENUM ('ASM', 'SM', 'NSM', 'ASD', 'SD');

CREATE TABLE "PoaStandarisasiProdukApproval" (
    "id" TEXT NOT NULL,
    "produkId" TEXT NOT NULL,
    "level" "ApprovalLevelStandarisasi" NOT NULL,
    "diskonPctSnapshot" DECIMAL(10,4) NOT NULL,
    "status" "StatusApprovalAtasan" NOT NULL DEFAULT 'MENUNGGU',
    "decidedByNip" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PoaStandarisasiProdukApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PoaStandarisasiProdukApproval_produkId_level_key" ON "PoaStandarisasiProdukApproval"("produkId", "level");
CREATE INDEX "PoaStandarisasiProdukApproval_produkId_idx" ON "PoaStandarisasiProdukApproval"("produkId");

ALTER TABLE "PoaStandarisasiProdukApproval" ADD CONSTRAINT "PoaStandarisasiProdukApproval_produkId_fkey" FOREIGN KEY ("produkId") REFERENCES "PoaStandarisasiProduk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
