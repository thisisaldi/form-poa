-- CreateTable
CREATE TABLE "ProductTargetAllocation" (
    "id" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "qty" DECIMAL(18,2) NOT NULL,
    "setBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTargetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductTargetAllocation_kodeProduk_quarter_idx" ON "ProductTargetAllocation"("kodeProduk", "quarter");

-- CreateIndex
CREATE INDEX "ProductTargetAllocation_nip_idx" ON "ProductTargetAllocation"("nip");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTargetAllocation_kodeProduk_quarter_nip_key" ON "ProductTargetAllocation"("kodeProduk", "quarter", "nip");
