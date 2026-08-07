-- Doctor-level survey result (MR's own count of daily patients from a
-- physical survey), duplicated across all of one doctor's product rows —
-- same pattern as rencanaVisitMinggu. Existing rows backfilled to 0.
ALTER TABLE "PoaLineItem" ADD COLUMN "surveyPasienHarian" INTEGER NOT NULL DEFAULT 0;
