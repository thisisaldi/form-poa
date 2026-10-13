-- AlterTable
ALTER TABLE "PoaScForm" DROP COLUMN "scProductCodes",
ADD COLUMN     "scProductListId" TEXT;

-- CreateTable
CREATE TABLE "PoaScProductList" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "proCodes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaScProductList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoaScProductList_period_hash_key" ON "PoaScProductList"("period", "hash");

-- AddForeignKey
ALTER TABLE "PoaScForm" ADD CONSTRAINT "PoaScForm_scProductListId_fkey" FOREIGN KEY ("scProductListId") REFERENCES "PoaScProductList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
