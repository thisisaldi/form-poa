-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "exodusOutletId" INTEGER;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "exodusCustomerId" INTEGER,
ADD COLUMN     "customerCodeExodus" TEXT;
