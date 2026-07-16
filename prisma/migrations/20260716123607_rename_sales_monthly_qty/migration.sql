-- AlterTable
ALTER TABLE "OutletSalesMonthly" DROP COLUMN "value",
ADD COLUMN     "qty" DECIMAL(18,2) NOT NULL;

