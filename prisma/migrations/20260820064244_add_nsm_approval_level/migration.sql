-- AlterTable
ALTER TABLE "PoaStandarisasi" ADD COLUMN     "statusApprovalNsm" "StatusApprovalAtasan" NOT NULL DEFAULT 'MENUNGGU',
ADD COLUMN     "tanggalApprovalNsm" TIMESTAMP(3);
