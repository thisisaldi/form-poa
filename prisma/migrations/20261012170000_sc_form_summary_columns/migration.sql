-- DropIndex
DROP INDEX "PoaScForm_currentHolderId_idx";

-- AlterTable
ALTER TABLE "PoaScForm" ADD COLUMN     "countEkstensifikasi" INTEGER,
ADD COLUMN     "countIntensifikasi" INTEGER,
ADD COLUMN     "countPenurunan" INTEGER,
ADD COLUMN     "countTetap" INTEGER,
ADD COLUMN     "historyPeriodEnd" INTEGER,
ADD COLUMN     "historySalesQuarter" DECIMAL(18,2),
ADD COLUMN     "monthlyBreakdown" JSONB,
ADD COLUMN     "scProductCodes" TEXT[],
ADD COLUMN     "sumBudgetSc" DECIMAL(18,2),
ADD COLUMN     "sumCashback" DECIMAL(18,2),
ADD COLUMN     "sumDiskon" DECIMAL(18,2),
ADD COLUMN     "sumEntertain" DECIMAL(18,2),
ADD COLUMN     "sumEstimasiSales" DECIMAL(18,2),
ADD COLUMN     "sumNilaiSc" DECIMAL(18,2),
ADD COLUMN     "summaryComputedAt" TIMESTAMP(3),
ADD COLUMN     "summaryVersion" INTEGER,
ADD COLUMN     "tercacahEstimasiSales" DECIMAL(18,2),
ADD COLUMN     "tercacahNilaiSc" DECIMAL(18,2),
ADD COLUMN     "totalScProducts" INTEGER;

-- AlterTable
ALTER TABLE "PoaScProductItem" ADD COLUMN     "cashbackSnapshot" DECIMAL(18,2),
ADD COLUMN     "historySalesB3" DECIMAL(18,2),
ADD COLUMN     "hnaSnapshot" DECIMAL(18,2),
ADD COLUMN     "salesCounterMinimum" INTEGER,
ADD COLUMN     "salesCounterValue" DECIMAL(18,2);

-- CreateIndex
CREATE INDEX "PoaScForm_currentHolderId_period_idx" ON "PoaScForm"("currentHolderId", "period");

