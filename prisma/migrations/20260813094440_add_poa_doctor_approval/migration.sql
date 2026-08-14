-- AlterTable
ALTER TABLE "PoaAuditLog" ADD COLUMN     "doctorApprovalId" TEXT;

-- CreateTable
CREATE TABLE "PoaDoctorApproval" (
    "id" TEXT NOT NULL,
    "poaId" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "namaCust" TEXT NOT NULL,
    "status" "PoaStatus" NOT NULL DEFAULT 'SUBMITTED_TO_ASM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentHolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaDoctorApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaDoctorApproval_poaId_idx" ON "PoaDoctorApproval"("poaId");

-- CreateIndex
CREATE INDEX "PoaDoctorApproval_currentHolderId_idx" ON "PoaDoctorApproval"("currentHolderId");

-- CreateIndex
CREATE INDEX "PoaDoctorApproval_status_idx" ON "PoaDoctorApproval"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PoaDoctorApproval_poaId_kodePI_namaCust_key" ON "PoaDoctorApproval"("poaId", "kodePI", "namaCust");

-- CreateIndex
CREATE INDEX "PoaAuditLog_doctorApprovalId_idx" ON "PoaAuditLog"("doctorApprovalId");

-- AddForeignKey
ALTER TABLE "PoaDoctorApproval" ADD CONSTRAINT "PoaDoctorApproval_poaId_fkey" FOREIGN KEY ("poaId") REFERENCES "PoaForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaDoctorApproval" ADD CONSTRAINT "PoaDoctorApproval_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "User"("nip") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaAuditLog" ADD CONSTRAINT "PoaAuditLog_doctorApprovalId_fkey" FOREIGN KEY ("doctorApprovalId") REFERENCES "PoaDoctorApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

