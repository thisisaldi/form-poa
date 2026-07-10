-- Migration: Use NIP as User primary key instead of UUID.
-- Drops UUID id column from User. Migrates all FK columns that referenced
-- User.id (UUID) to store User.nip instead, then recreates FK constraints.

-- Step 1: Drop all FK constraints referencing User.id
ALTER TABLE "MrOutletAssignment" DROP CONSTRAINT "MrOutletAssignment_userId_fkey";
ALTER TABLE "PoaAuditLog" DROP CONSTRAINT "PoaAuditLog_actorId_fkey";
ALTER TABLE "PoaForm" DROP CONSTRAINT "PoaForm_currentHolderId_fkey";
ALTER TABLE "PoaForm" DROP CONSTRAINT "PoaForm_ownerId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_reportsToId_fkey";

-- Step 2: Migrate FK data — convert UUID values → NIP values
-- User.reportsToId
UPDATE "User" child
SET "reportsToId" = parent."nip"
FROM "User" parent
WHERE child."reportsToId" = parent."id";

-- MrOutletAssignment.userId
UPDATE "MrOutletAssignment" ma
SET "userId" = u."nip"
FROM "User" u
WHERE ma."userId" = u."id";

-- PoaForm.ownerId and currentHolderId
UPDATE "PoaForm" poa
SET "ownerId" = u."nip"
FROM "User" u
WHERE poa."ownerId" = u."id";

UPDATE "PoaForm" poa
SET "currentHolderId" = u."nip"
FROM "User" u
WHERE poa."currentHolderId" = u."id";

-- PoaAuditLog.actorId
UPDATE "PoaAuditLog" log
SET "actorId" = u."nip"
FROM "User" u
WHERE log."actorId" = u."id";

-- Step 3: Drop old unique index on nip (will become PK unique automatically)
DROP INDEX IF EXISTS "User_nip_key";

-- Step 4: Swap PK from id → nip
ALTER TABLE "User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "User" DROP COLUMN "id";
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("nip");

-- Step 5: Recreate all FK constraints pointing to User.nip
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey"
  FOREIGN KEY ("reportsToId") REFERENCES "User"("nip") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_currentHolderId_fkey"
  FOREIGN KEY ("currentHolderId") REFERENCES "User"("nip") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PoaAuditLog" ADD CONSTRAINT "PoaAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MrOutletAssignment" ADD CONSTRAINT "MrOutletAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;
