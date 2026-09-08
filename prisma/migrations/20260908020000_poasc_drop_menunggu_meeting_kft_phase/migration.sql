-- "Menunggu Meeting KFT" removed from the wizard flow (2026-09-08, user
-- request) — Approval User/Dokter now advances straight to Finalisasi.
-- Any pengajuan currently parked at MENUNGGU_MEETING_KFT needs to move
-- forward too, doing the same dokterUser-seed step advanceToFinalisasiAction
-- does in code (see poaStandarisasi.ts) so their Finalisasi dokter list
-- isn't left empty.

INSERT INTO "PoaStandarisasiDokterUser" ("id", "produkId", "customerId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), da."produkId", da."customerId", now(), now()
FROM "PoaStandarisasiDokterApproval" da
JOIN "PoaStandarisasiProduk" pp ON pp.id = da."produkId"
JOIN "PoaStandarisasi" ps ON ps.id = pp."pengajuanId"
WHERE da."sudahTtd" = true AND ps."currentPhase" = 'MENUNGGU_MEETING_KFT'
ON CONFLICT ("produkId", "customerId") DO NOTHING;

UPDATE "PoaStandarisasi" SET "currentPhase" = 'FINALISASI' WHERE "currentPhase" = 'MENUNGGU_MEETING_KFT';
