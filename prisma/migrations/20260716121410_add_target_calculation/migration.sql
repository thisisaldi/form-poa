-- CreateTable
CREATE TABLE "OutletSalesMonthly" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "itemKode" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSalesMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTargetInput" (
    "id" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "monthlyRamp" DECIMAL(18,2) NOT NULL,
    "setBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTargetInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletSalesMonthly_kodePI_idx" ON "OutletSalesMonthly"("kodePI");

-- CreateIndex
CREATE INDEX "OutletSalesMonthly_itemKode_idx" ON "OutletSalesMonthly"("itemKode");

-- CreateIndex
CREATE INDEX "OutletSalesMonthly_periode_idx" ON "OutletSalesMonthly"("periode");

-- CreateIndex
CREATE UNIQUE INDEX "OutletSalesMonthly_kodePI_itemKode_periode_key" ON "OutletSalesMonthly"("kodePI", "itemKode", "periode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTargetInput_kodeProduk_quarter_key" ON "ProductTargetInput"("kodeProduk", "quarter");

