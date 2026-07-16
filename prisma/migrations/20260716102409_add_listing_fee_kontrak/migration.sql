-- CreateTable
CREATE TABLE "ListingFeeKontrak" (
    "id" TEXT NOT NULL,
    "noreq" TEXT NOT NULL,
    "div" TEXT,
    "jenis" TEXT,
    "tglApprove" TIMESTAMP(3),
    "tglPpud" TIMESTAMP(3),
    "noOr" TEXT,
    "kdCust" TEXT NOT NULL,
    "nmCust" TEXT NOT NULL,
    "kdOutlet" TEXT,
    "nmOutlet" TEXT,
    "prdAwal" TEXT NOT NULL,
    "prdAkhir" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "targetSales" DECIMAL(18,2),
    "kdProduk" TEXT,
    "nmProduk" TEXT,
    "nsm" TEXT,
    "bmByPeriod" JSONB NOT NULL DEFAULT '{}',
    "pctListingByPeriod" JSONB NOT NULL DEFAULT '{}',
    "snapshotDate" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingFeeKontrak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingFeeKontrak_kdCust_idx" ON "ListingFeeKontrak"("kdCust");

-- CreateIndex
CREATE INDEX "ListingFeeKontrak_kdOutlet_idx" ON "ListingFeeKontrak"("kdOutlet");

-- CreateIndex
CREATE INDEX "ListingFeeKontrak_prdAwal_prdAkhir_idx" ON "ListingFeeKontrak"("prdAwal", "prdAkhir");

-- CreateIndex
CREATE UNIQUE INDEX "ListingFeeKontrak_noreq_kdProduk_key" ON "ListingFeeKontrak"("noreq", "kdProduk");

