-- CreateTable
CREATE TABLE "DiskonKontrak" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "nmAreaPi" TEXT,
    "areaPi" TEXT,
    "kodePI" TEXT NOT NULL,
    "namaOutlet" TEXT,
    "bumn" TEXT,
    "divisi" TEXT,
    "prdAwal" TEXT NOT NULL,
    "prdAkhir" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "namaProduk" TEXT,
    "onPi" DECIMAL(10,4),
    "offPi" DECIMAL(10,4),
    "onDist" DECIMAL(10,4),
    "offDist" DECIMAL(10,4),
    "qtyBon" DECIMAL(10,2),
    "qtyBuy" DECIMAL(10,2),
    "newOnPi" DECIMAL(10,4),
    "snapshotDate" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiskonKontrak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiskonKontrak_kodePI_idx" ON "DiskonKontrak"("kodePI");

-- CreateIndex
CREATE INDEX "DiskonKontrak_kodeProduk_idx" ON "DiskonKontrak"("kodeProduk");

-- CreateIndex
CREATE INDEX "DiskonKontrak_prdAwal_prdAkhir_idx" ON "DiskonKontrak"("prdAwal", "prdAkhir");

-- CreateIndex
CREATE UNIQUE INDEX "DiskonKontrak_nomor_kodeProduk_key" ON "DiskonKontrak"("nomor", "kodeProduk");

