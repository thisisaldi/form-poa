-- EMERGENCY STOPGAP (2026-09-14): re-add the personnel columns dropped in
-- 20260914120000 so the OLD (still-deployed) app build stops erroring on
-- every TargetHospitalValue/TargetNonHospitalValue query while the new
-- build (commit 1eee51b+, no longer needs these columns) gets deployed.
-- All columns nullable, no data backfilled (old snapshot data is gone, not
-- restorable, and no longer needed by the new code) — this only exists to
-- make old code's SELECT/column references stop failing.
-- Deliberately NOT reflected in schema.prisma (current schema state matches
-- the DROP, i.e. the intended end state) — meant to be reverted (dropped
-- again) once the new build is confirmed live. See docs/target-non-hospital-value/README.md.
ALTER TABLE "TargetHospitalValue"
  ADD COLUMN "nipMR" TEXT,
  ADD COLUMN "namaMR" TEXT,
  ADD COLUMN "nipASM" TEXT,
  ADD COLUMN "namaASM" TEXT,
  ADD COLUMN "nipSM" TEXT,
  ADD COLUMN "namaSM" TEXT,
  ADD COLUMN "nipNSM" TEXT,
  ADD COLUMN "namaNSM" TEXT;

ALTER TABLE "TargetNonHospitalValue"
  ADD COLUMN "nipMR" TEXT,
  ADD COLUMN "namaMR" TEXT,
  ADD COLUMN "nipSM" TEXT,
  ADD COLUMN "namaSM" TEXT;
