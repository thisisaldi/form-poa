-- Non-Hospital (OMG1) monthly outlet sales, twin of OutletSalesValueMonthly.
CREATE TABLE "OutletSalesValueMonthlyOmega" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "valueSales" DECIMAL(18,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSalesValueMonthlyOmega_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutletSalesValueMonthlyOmega_kodePI_periode_key" ON "OutletSalesValueMonthlyOmega"("kodePI", "periode");
CREATE INDEX "OutletSalesValueMonthlyOmega_kodePI_idx" ON "OutletSalesValueMonthlyOmega"("kodePI");
CREATE INDEX "OutletSalesValueMonthlyOmega_periode_idx" ON "OutletSalesValueMonthlyOmega"("periode");
