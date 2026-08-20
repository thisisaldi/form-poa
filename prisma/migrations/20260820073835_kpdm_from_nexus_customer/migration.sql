/*
  Warnings:

  - You are about to drop the `JabatanStandarisasi` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `KpdmStandarisasi` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "KpdmStandarisasi" DROP CONSTRAINT "KpdmStandarisasi_jabatanId_fkey";

-- DropForeignKey
ALTER TABLE "PoaStandarisasi" DROP CONSTRAINT "PoaStandarisasi_kpdmId_fkey";

-- AlterTable
ALTER TABLE "PoaStandarisasi" ALTER COLUMN "kpdmId" DROP NOT NULL;

-- DropTable
DROP TABLE "JabatanStandarisasi";

-- DropTable
DROP TABLE "KpdmStandarisasi";

-- DataFixup: existing kpdmId values point to the now-dropped KpdmStandarisasi
-- table, not Customer — null them out so the new FK below doesn't fail on
-- orphaned references. kpdmNamaSnapshot/jabatanNamaSnapshot (untouched)
-- still preserve what was displayed at the time, so this is a display-neutral
-- change (the live kpdm relation was never rendered, only the snapshots).
UPDATE "PoaStandarisasi" SET "kpdmId" = NULL WHERE "kpdmId" IS NOT NULL AND "kpdmId" NOT IN (SELECT "id" FROM "Customer");

-- AddForeignKey
ALTER TABLE "PoaStandarisasi" ADD CONSTRAINT "PoaStandarisasi_kpdmId_fkey" FOREIGN KEY ("kpdmId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
