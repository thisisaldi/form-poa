-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MR', 'ASM', 'SM', 'NSM', 'ADMIN');

-- CreateEnum
CREATE TYPE "PoaStatus" AS ENUM ('DRAFT', 'SUBMITTED_TO_ASM', 'APPROVED_BY_ASM', 'SUBMITTED_TO_SM', 'APPROVED_BY_SM', 'SUBMITTED_TO_NSM', 'APPROVED_BY_NSM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'APPROVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reportsToId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaForm" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PoaStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currentHolderId" TEXT,

    CONSTRAINT "PoaForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaAuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "fromStatus" "PoaStatus",
    "toStatus" "PoaStatus",
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "poaId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "PoaAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterDataRecord" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterDataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_nip_key" ON "User"("nip");

-- CreateIndex
CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "PoaForm_ownerId_idx" ON "PoaForm"("ownerId");

-- CreateIndex
CREATE INDEX "PoaForm_currentHolderId_idx" ON "PoaForm"("currentHolderId");

-- CreateIndex
CREATE INDEX "PoaForm_status_idx" ON "PoaForm"("status");

-- CreateIndex
CREATE INDEX "PoaAuditLog_poaId_idx" ON "PoaAuditLog"("poaId");

-- CreateIndex
CREATE INDEX "PoaAuditLog_actorId_idx" ON "PoaAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "MasterDataRecord_sourceKey_idx" ON "MasterDataRecord"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "MasterDataRecord_sourceKey_externalId_key" ON "MasterDataRecord"("sourceKey", "externalId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaAuditLog" ADD CONSTRAINT "PoaAuditLog_poaId_fkey" FOREIGN KEY ("poaId") REFERENCES "PoaForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaAuditLog" ADD CONSTRAINT "PoaAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
