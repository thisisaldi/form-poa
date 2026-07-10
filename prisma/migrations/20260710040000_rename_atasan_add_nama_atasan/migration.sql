-- Migration:
--   1. User: rename reportsToId → nipAtasan, add namaAtasan
--   2. MrOutletAssignment: rename userId → nipMR, add periode column

-- ── User: rename & add ────────────────────────────────────────────────────────

ALTER TABLE "User" DROP CONSTRAINT "User_reportsToId_fkey";
DROP INDEX "User_reportsToId_idx";

ALTER TABLE "User" RENAME COLUMN "reportsToId" TO "nipAtasan";

ALTER TABLE "User" ADD COLUMN "namaAtasan" TEXT;
UPDATE "User" child
SET "namaAtasan" = parent."name"
FROM "User" parent
WHERE child."nipAtasan" = parent."nip";

CREATE INDEX "User_nipAtasan_idx" ON "User"("nipAtasan");
ALTER TABLE "User" ADD CONSTRAINT "User_nipAtasan_fkey"
  FOREIGN KEY ("nipAtasan") REFERENCES "User"("nip") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── MrOutletAssignment: rename & add ─────────────────────────────────────────

DROP INDEX "MrOutletAssignment_userId_kodePI_key";
DROP INDEX "MrOutletAssignment_userId_idx";
ALTER TABLE "MrOutletAssignment" DROP CONSTRAINT "MrOutletAssignment_userId_fkey";

ALTER TABLE "MrOutletAssignment" RENAME COLUMN "userId" TO "nipMR";

ALTER TABLE "MrOutletAssignment" ADD COLUMN "periode" INTEGER;
UPDATE "MrOutletAssignment"
SET "periode" = EXTRACT(YEAR FROM NOW())::INTEGER * 100 + EXTRACT(MONTH FROM NOW())::INTEGER;
ALTER TABLE "MrOutletAssignment" ALTER COLUMN "periode" SET NOT NULL;

CREATE UNIQUE INDEX "MrOutletAssignment_nipMR_kodePI_periode_key" ON "MrOutletAssignment"("nipMR", "kodePI", "periode");
CREATE INDEX "MrOutletAssignment_nipMR_idx" ON "MrOutletAssignment"("nipMR");
CREATE INDEX "MrOutletAssignment_periode_idx" ON "MrOutletAssignment"("periode");

ALTER TABLE "MrOutletAssignment" ADD CONSTRAINT "MrOutletAssignment_nipMR_fkey"
  FOREIGN KEY ("nipMR") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;
