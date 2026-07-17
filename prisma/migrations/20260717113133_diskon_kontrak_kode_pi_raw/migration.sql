-- Fresh re-import required: kodePI semantics changed (now areaPi+kodePIRaw)
TRUNCATE TABLE "DiskonKontrak";

-- AlterTable
ALTER TABLE "DiskonKontrak" ADD COLUMN     "kodePIRaw" TEXT NOT NULL;
