-- CreateTable
CREATE TABLE "PsspKontrak" (
    "id" TEXT NOT NULL,
    "kdCust" TEXT NOT NULL,
    "nmCust" TEXT NOT NULL,
    "cUrut" TEXT NOT NULL,
    "kdSpc" TEXT,
    "nmSpc" TEXT,
    "role" TEXT,
    "nDivisi" INTEGER,
    "divKode" TEXT,
    "biaya" DECIMAL(18,2) NOT NULL,
    "prdAwal" TEXT NOT NULL,
    "prdAkhir" TEXT NOT NULL,
    "nipUsul" TEXT,
    "nmUsul" TEXT,
    "kdOutlet" TEXT,
    "nmOutlet" TEXT,
    "divProd" TEXT,
    "kdProduk" TEXT,
    "nmProduk" TEXT,
    "estBaris" DECIMAL(18,2),
    "bmBaris" DECIMAL(18,2),
    "totalEst" DECIMAL(18,2),
    "totalBm" DECIMAL(18,2),
    "totalLunas" DECIMAL(18,2),
    "estByPeriod" JSONB NOT NULL DEFAULT '{}',
    "bmByPeriod" JSONB NOT NULL DEFAULT '{}',
    "lunasByPeriod" JSONB NOT NULL DEFAULT '{}',
    "snapshotDate" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsspKontrak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PsspKontrak_kdCust_idx" ON "PsspKontrak"("kdCust");

-- CreateIndex
CREATE INDEX "PsspKontrak_kdOutlet_idx" ON "PsspKontrak"("kdOutlet");

-- CreateIndex
CREATE INDEX "PsspKontrak_prdAwal_prdAkhir_idx" ON "PsspKontrak"("prdAwal", "prdAkhir");

-- CreateIndex
CREATE UNIQUE INDEX "PsspKontrak_cUrut_kdProduk_key" ON "PsspKontrak"("cUrut", "kdProduk");
