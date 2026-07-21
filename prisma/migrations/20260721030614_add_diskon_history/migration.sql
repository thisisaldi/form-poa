-- CreateTable
CREATE TABLE "DiskonHistory" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "avgDiskonPct" DECIMAL(10,4) NOT NULL,
    "sourcePeriod" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiskonHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiskonHistory_kodePI_idx" ON "DiskonHistory"("kodePI");

-- CreateIndex
CREATE UNIQUE INDEX "DiskonHistory_kodePI_kodeProduk_key" ON "DiskonHistory"("kodePI", "kodeProduk");
