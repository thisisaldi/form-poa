-- Unused PoaScForm columns. hariKerjaBulan / rencanaVisitMinggu /
-- surveyPasienHarian were added in 20260819085323_add_sc_form_fields and
-- already removed from schema.prisma without a drop; persenResepDokter had no
-- UI input and was always saved as 0.
ALTER TABLE "PoaScForm" DROP COLUMN IF EXISTS "hariKerjaBulan",
DROP COLUMN IF EXISTS "rencanaVisitMinggu",
DROP COLUMN IF EXISTS "surveyPasienHarian",
DROP COLUMN IF EXISTS "persenResepDokter";
