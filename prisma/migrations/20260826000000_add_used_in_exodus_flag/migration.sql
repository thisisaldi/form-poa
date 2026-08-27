-- AlterTable
ALTER TABLE "PoaDoctorApproval" ADD COLUMN     "usedInExodus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usedInExodusAt" TIMESTAMP(3);
