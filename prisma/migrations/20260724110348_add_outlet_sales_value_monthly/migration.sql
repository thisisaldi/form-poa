-- CreateTable
CREATE TABLE "OutletSalesValueMonthly" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "valueSales" DECIMAL(18,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSalesValueMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletSalesValueMonthly_kodePI_idx" ON "OutletSalesValueMonthly"("kodePI");

-- CreateIndex
CREATE INDEX "OutletSalesValueMonthly_periode_idx" ON "OutletSalesValueMonthly"("periode");

-- CreateIndex
CREATE UNIQUE INDEX "OutletSalesValueMonthly_kodePI_periode_key" ON "OutletSalesValueMonthly"("kodePI", "periode");
