-- Monthly Rupiah sales target per territory (GT) for the non-hospital (OMEGA) team — see Prisma schema doc comment.
CREATE TABLE "TargetNonHospitalValue" (
    "id" TEXT NOT NULL,
    "namaGT" TEXT NOT NULL,
    "divisi" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "target" DECIMAL(18,2) NOT NULL,
    "nipMR" TEXT,
    "namaMR" TEXT NOT NULL,
    "nipSM" TEXT,
    "namaSM" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetNonHospitalValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TargetNonHospitalValue_namaGT_periode_key" ON "TargetNonHospitalValue"("namaGT", "periode");
CREATE INDEX "TargetNonHospitalValue_periode_idx" ON "TargetNonHospitalValue"("periode");
CREATE INDEX "TargetNonHospitalValue_nipMR_idx" ON "TargetNonHospitalValue"("nipMR");
CREATE INDEX "TargetNonHospitalValue_divisi_idx" ON "TargetNonHospitalValue"("divisi");
