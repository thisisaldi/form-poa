-- CreateTable
CREATE TABLE "OutletSalesHistory" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "itemKode" TEXT NOT NULL,
    "totalSales12Bln" DECIMAL(18,2) NOT NULL,
    "periodeFrom" TEXT NOT NULL,
    "periodeTo" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSalesHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletSalesHistory_kodePI_idx" ON "OutletSalesHistory"("kodePI");

-- CreateIndex
CREATE INDEX "OutletSalesHistory_itemKode_idx" ON "OutletSalesHistory"("itemKode");

-- CreateIndex
CREATE UNIQUE INDEX "OutletSalesHistory_kodePI_itemKode_key" ON "OutletSalesHistory"("kodePI", "itemKode");
