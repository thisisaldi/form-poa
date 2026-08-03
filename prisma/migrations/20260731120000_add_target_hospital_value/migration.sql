-- Monthly Rupiah sales target per territory (GT) — see Prisma schema doc comment.
CREATE TABLE "TargetHospitalValue" (
    "id" TEXT NOT NULL,
    "namaGT" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "target" DECIMAL(18,2) NOT NULL,
    "nipMR" TEXT,
    "namaMR" TEXT NOT NULL,
    "nipASM" TEXT,
    "namaASM" TEXT NOT NULL,
    "nipSM" TEXT,
    "namaSM" TEXT NOT NULL,
    "nipNSM" TEXT,
    "namaNSM" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetHospitalValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TargetHospitalValue_namaGT_periode_key" ON "TargetHospitalValue"("namaGT", "periode");
CREATE INDEX "TargetHospitalValue_periode_idx" ON "TargetHospitalValue"("periode");
CREATE INDEX "TargetHospitalValue_nipMR_idx" ON "TargetHospitalValue"("nipMR");
CREATE INDEX "TargetHospitalValue_nipASM_idx" ON "TargetHospitalValue"("nipASM");
CREATE INDEX "TargetHospitalValue_nipSM_idx" ON "TargetHospitalValue"("nipSM");
CREATE INDEX "TargetHospitalValue_nipNSM_idx" ON "TargetHospitalValue"("nipNSM");
