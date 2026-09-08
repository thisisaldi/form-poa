-- advanceToFinalisasiAction's seed only copied {produkId, customerId} into
-- PoaStandarisasiDokterUser, leaving jumlahPasien/resepPerPasienSt/estimasi*/
-- entertainRp null — Finalisasi showed 0 instead of the Planning values
-- (2026-09-08 bug report). Backfill existing rows still at that blank seeded
-- state (all three untouched-since-seed columns null) from the matching
-- PoaStandarisasiDokterApproval row. Rows a user has already edited in
-- Finalisasi (any of the three non-null) are left alone.
UPDATE "PoaStandarisasiDokterUser" du
SET
  "jumlahPasien" = da."jumlahPasien",
  "resepPerPasienSt" = da."resepPerPasienSt",
  "estimasiQtyPerBulan" = da."estimasiQtyPerBulan",
  "estimasiSalesRpPerBulan" = da."estimasiNilaiRpPerBulan",
  "entertainRp" = da."entertainRp"
FROM "PoaStandarisasiDokterApproval" da
WHERE du."produkId" = da."produkId"
  AND du."customerId" = da."customerId"
  AND du."jumlahPasien" IS NULL
  AND du."resepPerPasienSt" IS NULL
  AND du."entertainRp" IS NULL;
