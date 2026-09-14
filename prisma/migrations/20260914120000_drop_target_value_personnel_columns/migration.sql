-- GT-based only now (user: "udah gaada personil mr -> nsm lagi cuma ada target by gt") — see schema doc comments on both models.
-- DROP COLUMN implicitly drops any index defined solely on that column, no separate DROP INDEX needed.
ALTER TABLE "TargetHospitalValue"
  DROP COLUMN "nipMR",
  DROP COLUMN "namaMR",
  DROP COLUMN "nipASM",
  DROP COLUMN "namaASM",
  DROP COLUMN "nipSM",
  DROP COLUMN "namaSM",
  DROP COLUMN "nipNSM",
  DROP COLUMN "namaNSM";

ALTER TABLE "TargetNonHospitalValue"
  DROP COLUMN "nipMR",
  DROP COLUMN "namaMR",
  DROP COLUMN "nipSM",
  DROP COLUMN "namaSM";
