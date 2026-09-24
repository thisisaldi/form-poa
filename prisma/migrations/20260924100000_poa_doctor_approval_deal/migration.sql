-- AlterTable
ALTER TABLE "PoaDoctorApproval"
  ADD COLUMN "dealAt" TIMESTAMP(3),
  ADD COLUMN "dealByNip" TEXT;

-- Grandfather: dokter yang SUDAH fully approved sebelum tombol Deal ada tetap
-- muncul di GET /api/poa-doctors (tanpa ini, mereka mendadak hilang dari API
-- Exodus sampai owner klik Deal). dealByNip sengaja dibiarkan NULL.
UPDATE "PoaDoctorApproval" SET "dealAt" = NOW() WHERE "status"::text LIKE 'APPROVED_BY_%';
